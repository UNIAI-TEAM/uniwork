package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// CarriedOverItem is a task an earlier meeting of the same project handed
// out that is still open (spec meeting follow-through D8, §6.5).
type CarriedOverItem struct {
	ActionItemID     string
	MeetingID        string
	MeetingTitle     string
	MeetingStartedAt pgtype.Timestamptz
	Task             ActionItemTask
}

// CarriedOverItems lists, for any member of the workspace, the converted
// items whose task is not done from the other ENDED meetings of this
// meeting's project that started before it (its actual start once it has
// one, else its schedule). A meeting without a project has no chain of
// meetings yet, so nothing carries over.
func (s *MeetingService) CarriedOverItems(ctx context.Context, userID, meetingID string) ([]CarriedOverItem, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return nil, err
	}
	out := []CarriedOverItem{}
	if !m.ProjectID.Valid || m.ProjectID.String == "" {
		return out, nil
	}
	before := m.StartsAt
	if m.ActualStartAt.Valid {
		before = m.ActualStartAt
	}
	rows, err := s.q.ListCarriedOverActionItems(ctx, db.ListCarriedOverActionItemsParams{
		OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, ProjectID: m.ProjectID.String,
		MeetingID: m.ID, StartedBefore: before,
	})
	if err != nil {
		return nil, err
	}
	// Overdue as on the meeting's own action items: due before today in
	// this meeting's timezone. Every task here is open, so none is done.
	today := time.Now().In(meetingLocation(m.Timezone)).Format("2006-01-02")
	for _, r := range rows {
		task := ActionItemTask{ID: r.TaskID, Title: r.TaskTitle, Status: r.TaskStatus}
		if r.TaskAssigneeID.Valid {
			task.AssigneeID = &r.TaskAssigneeID.String
		}
		if r.TaskDueDate.Valid {
			due := r.TaskDueDate.Time.Format("2006-01-02")
			task.DueDate = &due
			task.Overdue = due < today
		}
		out = append(out, CarriedOverItem{
			ActionItemID: r.ActionItemID, MeetingID: r.MeetingID, MeetingTitle: r.MeetingTitle,
			MeetingStartedAt: r.MeetingStartedAt, Task: task,
		})
	}
	return out, nil
}
