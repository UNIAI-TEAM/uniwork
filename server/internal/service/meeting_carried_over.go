package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// CarriedOverItem is a task an earlier meeting of the same project or series
// handed out that is still open (spec meeting follow-through D8, §6.5).
type CarriedOverItem struct {
	ActionItemID     string
	MeetingID        string
	MeetingTitle     string
	MeetingStartedAt pgtype.Timestamptz
	Task             ActionItemTask
}

// carriedOverLimit is the page the list shows; Total says how many more.
// A variable so a test can page with fewer rows than it seeds.
var carriedOverLimit int32 = 100

// carriedOverWindow bounds how far back the chain reaches (follow-4): a busy
// project or a long series does not hand a meeting last year's tasks.
const carriedOverWindow = 90 * 24 * time.Hour

// CarriedOverList is a page of carried-over items and how many there are.
type CarriedOverList struct {
	Items []CarriedOverItem
	Total int
}

// CarriedOverItems lists, for any member of the workspace, the converted
// items whose task is not done from the other ENDED meetings of this
// meeting's project or series (follow-4) that started before it (its actual
// start once it has one, else its schedule) and within the 90 days before
// that. A meeting with neither has no chain of meetings, so nothing carries
// over.
func (s *MeetingService) CarriedOverItems(ctx context.Context, userID, meetingID string) (CarriedOverList, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return CarriedOverList{}, err
	}
	out := CarriedOverList{Items: []CarriedOverItem{}}
	project := pgtype.Text{String: m.ProjectID.String, Valid: m.ProjectID.Valid && m.ProjectID.String != ""}
	series := pgtype.Text{String: m.SeriesID.String, Valid: m.SeriesID.Valid && m.SeriesID.String != ""}
	if !project.Valid && !series.Valid {
		return out, nil
	}
	before := m.StartsAt
	if m.ActualStartAt.Valid {
		before = m.ActualStartAt
	}
	rows, err := s.q.ListCarriedOverActionItems(ctx, db.ListCarriedOverActionItemsParams{
		OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, ProjectID: project, SeriesID: series,
		MeetingID: m.ID, StartedBefore: before,
		StartedAfter: pgtype.Timestamptz{Time: before.Time.Add(-carriedOverWindow), Valid: true},
		RowLimit:     carriedOverLimit,
	})
	if err != nil {
		return CarriedOverList{}, err
	}
	// Overdue as on the meeting's own action items: due before today in
	// this meeting's timezone. Every task here is open, so none is done.
	today := time.Now().In(meetingLocation(m.Timezone)).Format("2006-01-02")
	for _, r := range rows {
		out.Total = int(r.Total)
		task := ActionItemTask{ID: r.TaskID, Title: r.TaskTitle, Status: r.TaskStatus}
		if r.TaskAssigneeID.Valid {
			task.AssigneeID = &r.TaskAssigneeID.String
		}
		if r.TaskDueDate.Valid {
			due := r.TaskDueDate.Time.Format("2006-01-02")
			task.DueDate = &due
			task.Overdue = due < today
		}
		out.Items = append(out.Items, CarriedOverItem{
			ActionItemID: r.ActionItemID, MeetingID: r.MeetingID, MeetingTitle: r.MeetingTitle,
			MeetingStartedAt: r.MeetingStartedAt, Task: task,
		})
	}
	return out, nil
}
