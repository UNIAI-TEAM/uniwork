package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const maxCalendarRangeDays = 366

// CalendarService reads the workspace calendar feed: tasks with a due date and
// non-canceled meetings overlapping an inclusive [from, to] day range.
type CalendarService struct {
	q  *db.Queries
	ws *WorkspaceService
}

func NewCalendarService(q *db.Queries, ws *WorkspaceService) *CalendarService {
	return &CalendarService{q: q, ws: ws}
}

// CalendarEvent is one grid item for the month hub. IDs are "task:{id}" or
// "meeting:{id}". All-day task ends are exclusive (due + 1 day), matching
// packages/core/calendar/normalize.
type CalendarEvent struct {
	ID        string
	Kind      string
	EntityID  string
	Title     string
	Start     string
	End       *string
	AllDay    bool
	Status    *string
	Priority  *string
	ProjectID *string
}

// ListEvents returns tasks and meetings in [from, to] (inclusive calendar
// days, UTC). Rejects inverted ranges and spans longer than 366 days.
func (s *CalendarService) ListEvents(ctx context.Context, workspaceID, userID string, from, to time.Time, mine bool) ([]CalendarEvent, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	fromDay := truncateUTCDate(from)
	toDay := truncateUTCDate(to)
	if toDay.Before(fromDay) {
		return nil, Invalid("to must be on or after from")
	}
	if fromDay.AddDate(0, 0, maxCalendarRangeDays).Before(toDay) {
		return nil, Invalid("date range may not exceed 366 days")
	}

	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	fromDate := pgtype.Date{Time: fromDay, Valid: true}
	toDate := pgtype.Date{Time: toDay, Valid: true}
	userText := pgtype.Text{String: userID, Valid: true}
	tasks, err := s.q.ListCalendarTasksInRange(ctx, db.ListCalendarTasksInRangeParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    workspaceID,
		FromDate:       fromDate,
		ToDate:         toDate,
		Mine:           mine,
		UserID:         userText,
	})
	if err != nil {
		return nil, err
	}

	fromAt := pgtype.Timestamptz{Time: fromDay, Valid: true}
	toExclusive := pgtype.Timestamptz{Time: toDay.AddDate(0, 0, 1), Valid: true}
	meetings, err := s.q.ListCalendarMeetingsInRange(ctx, db.ListCalendarMeetingsInRangeParams{
		WorkspaceID: workspaceID,
		FromAt:      fromAt,
		ToAt:        toExclusive,
		Mine:        mine,
		UserID:      userID,
	})
	if err != nil {
		return nil, err
	}

	out := make([]CalendarEvent, 0, len(tasks)+len(meetings))
	for _, t := range tasks {
		out = append(out, taskCalendarEvent(t))
	}
	for _, m := range meetings {
		out = append(out, meetingCalendarEvent(m))
	}
	return out, nil
}

func truncateUTCDate(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
}

func taskCalendarEvent(t db.ListCalendarTasksInRangeRow) CalendarEvent {
	due := t.DueDate.Time.Format(time.DateOnly)
	start := due
	if t.StartDate.Valid {
		start = t.StartDate.Time.Format(time.DateOnly)
	}
	end := t.DueDate.Time.AddDate(0, 0, 1).Format(time.DateOnly)
	ev := CalendarEvent{
		ID:       "task:" + t.ID,
		Kind:     "task",
		EntityID: t.ID,
		Title:    t.Title,
		Start:    start,
		End:      &end,
		AllDay:   true,
		Status:   calendarStrPtr(t.Status),
		Priority: calendarStrPtr(t.Priority),
	}
	if pid := util.TextToPtr(t.ProjectID); pid != nil {
		ev.ProjectID = pid
	}
	return ev
}

func meetingCalendarEvent(m db.ListCalendarMeetingsInRangeRow) CalendarEvent {
	start := m.StartsAt.Time.UTC().Format(time.RFC3339)
	end := m.EndsAt.Time.UTC().Format(time.RFC3339)
	return CalendarEvent{
		ID:       "meeting:" + m.ID,
		Kind:     "meeting",
		EntityID: m.ID,
		Title:    m.Title,
		Start:    start,
		End:      &end,
		AllDay:   false,
		Status:   calendarStrPtr(m.Status),
	}
}

func calendarStrPtr(s string) *string {
	if s == "" {
		return nil
	}
	v := s
	return &v
}
