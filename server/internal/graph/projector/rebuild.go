package projector

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// RebuildOptions: Verify counts drift without writing.
type RebuildOptions struct {
	Verify    bool
	BatchSize int32
}

// Report is one organization's rebuild outcome.
type Report struct {
	OrganizationID string `json:"organization_id"`
	Nodes          int    `json:"nodes"`
	Drift          Drift  `json:"drift"`
}

// Anchors first, so most peers already exist when work items are projected.
var rebuildOrder = []graph.NodeType{graph.NodeTeam, graph.NodeActor, graph.NodeProject, graph.NodeThread, graph.NodeMeeting, graph.NodeTask}

// RebuildOrg runs the projector's reconcile over every source row of one
// organization, plus every live node whose source may be gone. Closed history
// is kept: only open edges and facts are compared (spec §5.4).
func RebuildOrg(ctx context.Context, pool *pgxpool.Pool, q *db.Queries, org string, opts RebuildOptions) (Report, error) {
	if opts.BatchSize <= 0 {
		opts.BatchSize = 500
	}
	rep := Report{OrganizationID: org}
	for _, t := range rebuildOrder {
		ids, err := sourceIDs(ctx, q, org, t, opts.BatchSize)
		if err != nil {
			return rep, err
		}
		for _, id := range ids {
			ref := NodeRef{Type: t, SourceID: id}
			var d Drift
			if opts.Verify {
				d, err = Verify(ctx, q, org, ref)
			} else {
				d, err = projectOne(ctx, pool, q, org, ref)
			}
			if err != nil {
				return rep, err
			}
			rep.Nodes++
			rep.Drift.Add(d)
		}
	}
	return rep, nil
}

// projectOne projects one node in its own transaction, as the worker does:
// Project's advisory lock is transaction-scoped, so it serialises with the
// worker only when q is bound to a transaction.
func projectOne(ctx context.Context, pool *pgxpool.Pool, q *db.Queries, org string, ref NodeRef) (Drift, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Drift{}, err
	}
	defer tx.Rollback(ctx)
	d, err := Project(ctx, q.WithTx(tx), org, ref, EventInfo{EvidenceKind: EvidenceSourceRow})
	if err != nil {
		return d, err
	}
	return d, tx.Commit(ctx)
}

type pageFn func(ctx context.Context, after string, limit int32) ([]string, error)

// sourceIDs is the union of the type's source ids and its live node ids.
func sourceIDs(ctx context.Context, q *db.Queries, org string, t graph.NodeType, batch int32) ([]string, error) {
	var sources []pageFn
	switch t {
	case graph.NodeTask:
		sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
			return q.GraphRebuildTaskIDs(ctx, db.GraphRebuildTaskIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
		})
	case graph.NodeMeeting:
		sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
			return q.GraphRebuildMeetingIDs(ctx, db.GraphRebuildMeetingIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
		})
	case graph.NodeProject:
		sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
			return q.GraphRebuildProjectIDs(ctx, db.GraphRebuildProjectIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
		})
	case graph.NodeActor:
		sources = append(sources,
			func(ctx context.Context, after string, n int32) ([]string, error) {
				return q.GraphRebuildMemberIDs(ctx, db.GraphRebuildMemberIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
			},
			func(ctx context.Context, after string, n int32) ([]string, error) {
				return q.GraphRebuildAgentIDs(ctx, db.GraphRebuildAgentIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
			})
	case graph.NodeTeam:
		sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
			return q.GraphRebuildDepartmentIDs(ctx, db.GraphRebuildDepartmentIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
		})
	case graph.NodeThread:
		sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
			return q.GraphRebuildChatRoomIDs(ctx, db.GraphRebuildChatRoomIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
		})
	}
	sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
		return q.GraphRebuildLiveSources(ctx, db.GraphRebuildLiveSourcesParams{OrganizationID: org, NodeType: string(t), AfterID: after, LimitN: n})
	})
	seen := map[string]bool{}
	var out []string
	for _, page := range sources {
		after := ""
		for {
			ids, err := page(ctx, after, batch)
			if err != nil {
				return nil, err
			}
			for _, id := range ids {
				if !seen[id] {
					seen[id] = true
					out = append(out, id)
				}
			}
			if int32(len(ids)) < batch {
				break
			}
			after = ids[len(ids)-1]
		}
	}
	return out, nil
}
