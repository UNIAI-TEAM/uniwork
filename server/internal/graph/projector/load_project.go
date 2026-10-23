package projector

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func loadProject(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	p, err := q.GraphSourceProject(ctx, db.GraphSourceProjectParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	d := Desired{Node: &NodeState{
		Ref: NodeRef{Type: graph.NodeProject, SourceID: p.ID}, WorkspaceID: p.WorkspaceID,
		Title: p.Title, Status: p.Status, Visibility: graph.VisWorkspace,
		OccurredAt: timeOf(p.CreatedAt), SourceUpdatedAt: timeOf(p.UpdatedAt),
	}}
	if lt := textOf(p.LeadType); lt == "member" || lt == "agent" {
		d.edge(graph.EdgeOwnedBy, true, graph.NodeActor, textOf(p.LeadID))
	}
	d.Facts = []FactWant{{Type: graph.FactStatus, Value: p.Status}}
	return d, nil
}
