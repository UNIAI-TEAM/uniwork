package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// GraphFlags is the flag port; *featureflag.Service satisfies it.
type GraphFlags interface {
	IsEnabled(ctx context.Context, key string, defaultVal bool) bool
}

// GraphMetrics counts layer-2 refusals; internal/metrics.Graph satisfies it.
type GraphMetrics interface {
	IncGraphLayer2Dropped(nodeType string)
}

// GraphService reads the Work Graph for a person (C-11 §6). Layer 1 is SQL
// over the projected visibility and reader_ids; layer 2 (graphGate) reads
// each node again through its module before it leaves, so a permission
// revoked after the projection ran is honoured at once.
type GraphService struct {
	q       *db.Queries
	orgs    *OrganizationService
	ws      *WorkspaceService
	chat    *ChatService
	flags   GraphFlags
	metrics GraphMetrics
}

func NewGraphService(q *db.Queries, orgs *OrganizationService, ws *WorkspaceService, chat *ChatService) *GraphService {
	return &GraphService{q: q, orgs: orgs, ws: ws, chat: chat}
}

// SetFlags wires graph_ui; unwired, the graph reads as turned off.
func (s *GraphService) SetFlags(f GraphFlags) { s.flags = f }

// SetMetrics attaches the layer-2 counter.
func (s *GraphService) SetMetrics(m GraphMetrics) { s.metrics = m }

// GraphNodeView is one node as the API shows it.
type GraphNodeView struct {
	Type, ID, Subtype, Title, Status, WorkspaceID, WorkspaceSlug string
	Deleted                                                      bool
}

// GraphNeighbor is one open edge seen from the root node.
type GraphNeighbor struct {
	EdgeType, Direction, Origin string
	ValidFrom                   time.Time
	Backfilled                  bool
	Node                        GraphNodeView
}

// GraphNeighborsQuery: EdgeTypes empty = all; Direction out|in|both (default
// both); At zero = the database's now; Limit 1..100 (default 50); Cursor from
// NextCursor.
type GraphNeighborsQuery struct {
	EdgeTypes []string
	Direction string
	At        time.Time
	Cursor    string
	Limit     int
}

type GraphNeighborsPage struct {
	Node       GraphNodeView
	Items      []GraphNeighbor
	NextCursor string
}

// GraphHistoryItem is one edge or fact in a node's history.
type GraphHistoryItem struct {
	Kind                         string // edge | fact
	EdgeType, FactType           string
	Direction, Origin            string
	ValidFrom                    time.Time
	ValidTo                      *time.Time
	Value, Previous              string
	Precision, PreviousPrecision string
	Backfilled                   bool
	Node                         *GraphNodeView
}

type GraphHistory struct {
	Node  GraphNodeView
	Items []GraphHistoryItem
}

// historyEdges is what the task timeline shows (spec §6.1).
var historyEdges = []string{
	string(graph.EdgeOwnedBy), string(graph.EdgeOriginatedFrom), string(graph.EdgeDependsOn),
	string(graph.EdgeBelongsTo), string(graph.EdgeParticipatedIn),
}

type graphViewer struct {
	userID, orgID string
	workspaces    []string
	gate          *graphGate
}

func (s *GraphService) viewer(ctx context.Context, userID, workspaceID string) (*graphViewer, error) {
	mem, err := s.ws.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	if !s.uiEnabled(ctx, userID, mem.OrganizationID) {
		return nil, coded(http.StatusNotFound, "feature_disabled", "Work Graph chưa bật cho tổ chức này")
	}
	rows, err := s.orgs.ListWorkspaces(ctx, userID, mem.OrganizationID)
	if err != nil {
		return nil, err
	}
	v := &graphViewer{userID: userID, orgID: mem.OrganizationID}
	member := map[string]bool{}
	for _, r := range rows {
		v.workspaces = append(v.workspaces, r.ID)
		member[r.ID] = true
	}
	v.gate = &graphGate{s: s, userID: userID, workspaceID: workspaceID, orgID: mem.OrganizationID, member: member, seen: map[string]bool{}}
	return v, nil
}

// uiEnabled reads graph_ui for this user and organization with the
// catalogue default, the same call /api/v1/config makes, so the API and the
// page that shows the section never disagree.
func (s *GraphService) uiEnabled(ctx context.Context, userID, orgID string) bool {
	if s.flags == nil {
		return false
	}
	def := false
	if f, ok := featureflags.Lookup("graph_ui"); ok {
		def = f.Default
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: orgID})
	return s.flags.IsEnabled(ctx, "graph_ui", def)
}

// root resolves the node in the path through both layers; anything the
// caller may not see is ErrNotFound, never told apart from a missing node.
func (s *GraphService) root(ctx context.Context, v *graphViewer, nodeType, nodeID string) (db.GraphGetVisibleNodeRow, error) {
	t, ok := graph.ParseNodeType(nodeType)
	if !ok || !graph.Projected[t] {
		return db.GraphGetVisibleNodeRow{}, Invalid("loại node không hợp lệ")
	}
	n, err := s.q.GraphGetVisibleNode(ctx, db.GraphGetVisibleNodeParams{
		OrganizationID: v.orgID, NodeType: string(t), SourceID: nodeID, WorkspaceIds: v.workspaces, UserID: v.userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return n, ErrNotFound
	}
	if err != nil {
		return n, err
	}
	ok, err = v.gate.allow(ctx, n.NodeType, n.SourceID, n.WorkspaceID)
	if err != nil {
		return n, err
	}
	if !ok {
		return n, ErrNotFound
	}
	return n, nil
}

// Neighbors returns the root's one-step neighbors valid at in.At.
func (s *GraphService) Neighbors(ctx context.Context, userID, workspaceID, nodeType, nodeID string, in GraphNeighborsQuery) (GraphNeighborsPage, error) {
	v, err := s.viewer(ctx, userID, workspaceID)
	if err != nil {
		return GraphNeighborsPage{}, err
	}
	n, err := s.root(ctx, v, nodeType, nodeID)
	if err != nil {
		return GraphNeighborsPage{}, err
	}
	dir := in.Direction
	if dir == "" {
		dir = "both"
	}
	if dir != "both" && dir != "out" && dir != "in" {
		return GraphNeighborsPage{}, Invalid("direction phải là out, in hoặc both")
	}
	for _, e := range in.EdgeTypes {
		if _, ok := graph.ParseEdgeType(e); !ok {
			return GraphNeighborsPage{}, Invalid("loại cạnh không hợp lệ: " + e)
		}
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	afterAt, afterID, err := parseGraphCursor(in.Cursor)
	if err != nil {
		return GraphNeighborsPage{}, err
	}
	rows, err := s.q.GraphListNeighbors(ctx, db.GraphListNeighborsParams{
		// No At = the database's now() (graph_read.sql), not this process's clock.
		OrganizationID: v.orgID, NodeID: n.ID, At: optTS(in.At),
		EdgeTypes: nonNil(in.EdgeTypes), Direction: dir, WorkspaceIds: v.workspaces, UserID: v.userID,
		AfterValidFrom: afterAt, AfterID: afterID, LimitN: int32(limit),
	})
	if err != nil {
		return GraphNeighborsPage{}, err
	}
	page := GraphNeighborsPage{Node: rootView(n), Items: []GraphNeighbor{}}
	for _, r := range rows {
		ok, err := v.gate.allow(ctx, r.PeerType, r.PeerSourceID, r.PeerWorkspaceID)
		if err != nil {
			return GraphNeighborsPage{}, err
		}
		if !ok {
			continue
		}
		page.Items = append(page.Items, GraphNeighbor{
			EdgeType: r.EdgeType, Direction: direction(r.Outgoing), Origin: r.Origin,
			ValidFrom: r.ValidFrom.Time, Backfilled: backfilled(r.Attrs),
			Node: GraphNodeView{Type: r.PeerType, ID: r.PeerSourceID, Subtype: r.PeerSubtype, Title: r.PeerTitle,
				Status: r.PeerStatus, WorkspaceID: r.PeerWorkspaceID, WorkspaceSlug: r.PeerWorkspaceSlug},
		})
	}
	if len(rows) == limit {
		last := rows[len(rows)-1]
		page.NextCursor = strconv.FormatInt(last.ValidFrom.Time.UnixMicro(), 10) + "." + last.EdgeID
	}
	return page, nil
}

// History returns the root's edges (open and closed) and facts, oldest first.
func (s *GraphService) History(ctx context.Context, userID, workspaceID, nodeType, nodeID string, from, to time.Time) (GraphHistory, error) {
	v, err := s.viewer(ctx, userID, workspaceID)
	if err != nil {
		return GraphHistory{}, err
	}
	n, err := s.root(ctx, v, nodeType, nodeID)
	if err != nil {
		return GraphHistory{}, err
	}
	edges, err := s.q.GraphListNodeHistoryEdges(ctx, db.GraphListNodeHistoryEdgesParams{
		OrganizationID: v.orgID, NodeID: n.ID, EdgeTypes: historyEdges, WorkspaceIds: v.workspaces, UserID: v.userID,
		FromAt: optTS(from), ToAt: optTS(to),
	})
	if err != nil {
		return GraphHistory{}, err
	}
	facts, err := s.q.GraphListNodeHistoryFacts(ctx, db.GraphListNodeHistoryFactsParams{
		OrganizationID: v.orgID, NodeID: n.ID, FromAt: optTS(from), ToAt: optTS(to),
	})
	if err != nil {
		return GraphHistory{}, err
	}
	out := GraphHistory{Node: rootView(n), Items: []GraphHistoryItem{}}
	for _, r := range edges {
		ok := r.PeerDeleted && (r.PeerType == string(graph.NodeActor) || r.PeerType == string(graph.NodeTeam))
		if !ok {
			if ok, err = v.gate.allow(ctx, r.PeerType, r.PeerSourceID, r.PeerWorkspaceID); err != nil {
				return GraphHistory{}, err
			}
		}
		if !ok {
			continue
		}
		node := GraphNodeView{Type: r.PeerType, ID: r.PeerSourceID, Subtype: r.PeerSubtype, Title: r.PeerTitle,
			Status: r.PeerStatus, WorkspaceID: r.PeerWorkspaceID, WorkspaceSlug: r.PeerWorkspaceSlug, Deleted: r.PeerDeleted}
		out.Items = append(out.Items, GraphHistoryItem{
			Kind: "edge", EdgeType: r.EdgeType, Direction: direction(r.Outgoing), Origin: r.Origin,
			ValidFrom: r.ValidFrom.Time, ValidTo: timePtr(r.ValidTo), Backfilled: backfilled(r.Attrs), Node: &node,
		})
	}
	for _, f := range facts {
		var a struct {
			Precision         string `json:"precision"`
			Previous          string `json:"previous"`
			PreviousPrecision string `json:"previous_precision"`
			Backfill          bool   `json:"backfill"`
		}
		_ = json.Unmarshal(f.Attrs, &a)
		out.Items = append(out.Items, GraphHistoryItem{
			Kind: "fact", FactType: f.FactType, Origin: graph.OriginSystem, ValidFrom: f.ValidFrom.Time, ValidTo: timePtr(f.ValidTo),
			Value: f.Value, Previous: a.Previous, Precision: a.Precision, PreviousPrecision: a.PreviousPrecision, Backfilled: a.Backfill,
		})
	}
	sortHistory(out.Items)
	return out, nil
}

func sortHistory(items []GraphHistoryItem) {
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j].ValidFrom.Before(items[j-1].ValidFrom); j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
}

func rootView(n db.GraphGetVisibleNodeRow) GraphNodeView {
	return GraphNodeView{Type: n.NodeType, ID: n.SourceID, Subtype: n.Subtype, Title: n.Title, Status: n.Status,
		WorkspaceID: n.WorkspaceID, WorkspaceSlug: n.WorkspaceSlug}
}

func direction(outgoing bool) string {
	if outgoing {
		return "out"
	}
	return "in"
}

func backfilled(attrs []byte) bool {
	var a struct {
		Backfill bool `json:"backfill"`
	}
	_ = json.Unmarshal(attrs, &a)
	return a.Backfill
}

func timePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func optTS(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: !t.IsZero()} }

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// parseGraphCursor reads "<unix micros>.<edge id>", the house cursor shape.
func parseGraphCursor(c string) (pgtype.Timestamptz, string, error) {
	if c == "" {
		return pgtype.Timestamptz{}, "", nil
	}
	micros, id, ok := strings.Cut(c, ".")
	n, err := strconv.ParseInt(micros, 10, 64)
	if !ok || err != nil || id == "" {
		return pgtype.Timestamptz{}, "", Invalid("cursor không hợp lệ")
	}
	return pgtype.Timestamptz{Time: time.UnixMicro(n), Valid: true}, id, nil
}
