package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// graphGate is layer 2 (C-11 §6.2): every node the SQL filter admitted is
// read again the way its module reads it before it reaches the caller. Task,
// meeting and project use the module's own decision — the row exists in the
// caller's organization and its workspace is one the caller belongs to
// (TaskService.authorizeActor, MeetingService.authorize, TaskService.GetProject);
// the workspace set comes from ListWorkspaces once per request instead of one
// RequireMember per node. Chat rooms go through authorizeRoomRead itself.
type graphGate struct {
	s           *GraphService
	userID      string
	workspaceID string
	orgID       string
	member      map[string]bool
	seen        map[string]bool
}

func (g *graphGate) allow(ctx context.Context, nodeType, sourceID, nodeWorkspaceID string) (bool, error) {
	key := nodeType + ":" + sourceID
	if ok, done := g.seen[key]; done {
		return ok, nil
	}
	ok, err := g.check(ctx, nodeType, sourceID, nodeWorkspaceID)
	if err != nil {
		return false, err
	}
	g.seen[key] = ok
	if !ok && g.s.metrics != nil {
		g.s.metrics.IncGraphLayer2Dropped(nodeType)
	}
	return ok, nil
}

func (g *graphGate) check(ctx context.Context, nodeType, sourceID, nodeWorkspaceID string) (bool, error) {
	switch graph.NodeType(nodeType) {
	case graph.NodeTask:
		t, err := g.s.q.GetTask(ctx, sourceID)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return t.OrganizationID == g.orgID && g.member[t.WorkspaceID], nil
	case graph.NodeMeeting:
		m, err := g.s.q.GetMeeting(ctx, sourceID)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return m.OrganizationID == g.orgID && g.member[m.WorkspaceID], nil
	case graph.NodeProject:
		if !g.member[nodeWorkspaceID] {
			return false, nil
		}
		_, err := g.s.q.GetProject(ctx, db.GetProjectParams{ID: sourceID, OrganizationID: g.orgID, WorkspaceID: nodeWorkspaceID})
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return err == nil, err
	case graph.NodeThread:
		ws := nodeWorkspaceID
		if ws == "" || !g.member[ws] {
			ws = g.workspaceID
		}
		_, err := g.s.chat.authorizeRoomRead(ctx, g.userID, ws, sourceID)
		if err == nil {
			return true, nil
		}
		if graphRefusal(err) {
			return false, nil
		}
		return false, err
	case graph.NodeActor, graph.NodeTeam:
		// Organization-wide; the caller's membership was checked on entry.
		return true, nil
	}
	return false, nil
}

func graphRefusal(err error) bool {
	if isGateRefusal(err) {
		return true
	}
	var ce CodedError
	return errors.As(err, &ce) && (ce.Status == http.StatusForbidden || ce.Status == http.StatusNotFound)
}
