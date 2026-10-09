package projector

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func loadTeam(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	dep, err := q.GraphSourceDepartment(ctx, db.GraphSourceDepartmentParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	if dep.ArchivedAt.Valid {
		return Desired{}, nil
	}
	d := Desired{Node: &NodeState{
		Ref: NodeRef{Type: graph.NodeTeam, SourceID: dep.ID}, Title: dep.Name, Status: "active",
		Visibility: graph.VisOrganization, OccurredAt: timeOf(dep.CreatedAt), SourceUpdatedAt: timeOf(dep.UpdatedAt),
	}}
	d.edge(graph.EdgeBelongsTo, true, graph.NodeTeam, textOf(dep.ParentID))
	return d, nil
}
