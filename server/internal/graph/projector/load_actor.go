package projector

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// loadActor: an id is a member of the organization or one of its agents
// (ULIDs never collide). A deactivated member keeps their node with status
// "deactivated" — they still own their work; one who left, and an archived
// agent, are deleted.
func loadActor(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	m, err := q.GraphSourceMember(ctx, db.GraphSourceMemberParams{OrganizationID: org, UserID: id})
	if err == nil {
		status := "active"
		if m.DeactivatedAt.Valid {
			status = "deactivated"
		}
		d := Desired{Node: &NodeState{
			Ref: NodeRef{Type: graph.NodeActor, SourceID: m.UserID}, Subtype: graph.SubtypeMember,
			Title: m.DisplayName, Status: status, Visibility: graph.VisOrganization, OccurredAt: timeOf(m.CreatedAt),
		}}
		d.edge(graph.EdgeBelongsTo, true, graph.NodeTeam, textOf(m.DepartmentID))
		return d, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, err
	}
	a, err := q.GraphSourceAgent(ctx, db.GraphSourceAgentParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	if a.Status == "archived" || a.ArchivedAt.Valid {
		return Desired{}, nil
	}
	return Desired{Node: &NodeState{
		Ref: NodeRef{Type: graph.NodeActor, SourceID: a.ID}, Subtype: graph.SubtypeAgent,
		Title: a.Name, Status: a.Status, Visibility: graph.VisOrganization,
		OccurredAt: timeOf(a.CreatedAt), SourceUpdatedAt: timeOf(a.UpdatedAt),
	}}, nil
}
