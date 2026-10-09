package projector

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// loadMeeting: a canceled meeting keeps its node (status CANCELED), because
// meeting.deleted fires on every cancel and the two cannot be told apart.
func loadMeeting(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	m, err := q.GraphSourceMeeting(ctx, db.GraphSourceMeetingParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	d := Desired{Node: &NodeState{
		Ref: NodeRef{Type: graph.NodeMeeting, SourceID: m.ID}, WorkspaceID: m.WorkspaceID,
		Title: m.Title, Status: m.Status, Visibility: graph.VisWorkspace,
		OccurredAt: timeOf(m.StartsAt), SourceUpdatedAt: timeOf(m.UpdatedAt),
	}}
	// '' was how a cleared project used to be stored: no project.
	d.edge(graph.EdgeBelongsTo, true, graph.NodeProject, strings.TrimSpace(textOf(m.ProjectID)))
	users, err := q.GraphSourceMeetingParticipants(ctx, db.GraphSourceMeetingParticipantsParams{OrganizationID: org, MeetingID: m.ID})
	if err != nil {
		return Desired{}, err
	}
	for _, u := range users {
		d.edge(graph.EdgeParticipatedIn, false, graph.NodeActor, u)
	}
	d.Facts = []FactWant{{Type: graph.FactStatus, Value: m.Status}}
	return d, nil
}
