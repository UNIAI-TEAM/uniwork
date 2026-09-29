package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// assigneeFrequencyWindow bounds the audit rows the picker ranking reads:
// audit_events only grows, and older habits say little about who is next.
const assigneeFrequencyWindow = 90 * 24 * time.Hour

// AssigneeFrequency is how often the caller put one assignee on a task.
type AssigneeFrequency struct {
	Kind      string
	ID        string
	Frequency int64
}

// AssigneeFrequency ranks the assignees the actor chose in the workspace over
// the last 90 days, most frequent first, for ordering the assignee picker.
func (s *TaskService) AssigneeFrequency(ctx context.Context, actor Actor, workspaceID string) ([]AssigneeFrequency, error) {
	return s.assigneeFrequencySince(ctx, actor, workspaceID, time.Now().Add(-assigneeFrequencyWindow))
}

func (s *TaskService) assigneeFrequencySince(ctx context.Context, actor Actor, workspaceID string, since time.Time) ([]AssigneeFrequency, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListAssigneeFrequency(ctx, db.ListAssigneeFrequencyParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    workspaceID,
		ActorID:        actor.ID,
		Since:          pgtype.Timestamptz{Time: since, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	out := make([]AssigneeFrequency, 0, len(rows))
	for _, r := range rows {
		out = append(out, AssigneeFrequency{Kind: r.AssigneeKind, ID: r.AssigneeID, Frequency: r.Frequency})
	}
	return out, nil
}
