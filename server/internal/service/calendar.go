package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	maxCalendarRangeDays      = 366
	maxCalendarSidebarSection = 25
)

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
// CalendarSidebar is one read of the calendar left panel (map A).
type CalendarSidebar struct {
	Priorities   []CalendarSidebarTask
	MeetWith     []CalendarSidebarMeeting
	Assigned     []CalendarSidebarTask
	TodayOverdue []CalendarSidebarTask
	Backlog      []CalendarSidebarTask
}

type CalendarSidebarTask struct {
	ID, Title, Status string
	Priority, DueDate *string
}

type CalendarSidebarMeeting struct {
	ID, Title        string
	StartsAt, EndsAt string
}

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

// WorkspaceICS returns RFC 5545 calendar data for tasks (all-day by due date)
// and timed meetings in [from, to] inclusive calendar days (UTC). Members only.
func (s *CalendarService) WorkspaceICS(ctx context.Context, workspaceID, userID string, from, to time.Time) ([]byte, error) {
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
		Mine:           false,
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
		Mine:        false,
		UserID:      userID,
	})
	if err != nil {
		return nil, err
	}

	return renderWorkspaceICS(tasks, meetings, time.Now()), nil
}

// ListSidebar returns the five planner sections for the workspace calendar
// panel. "Today" for overdue and assigned ordering is the server's local
// wall-calendar date (time.Now in Local), not UTC truncation — so a task due
// "today" in the server's timezone matches sidebar today_overdue boundaries.
func (s *CalendarService) ListSidebar(ctx context.Context, workspaceID, userID string) (CalendarSidebar, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return CalendarSidebar{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return CalendarSidebar{}, err
	}

	now := time.Now()
	today := truncateLocalDate(now)
	limit := int32(maxCalendarSidebarSection)
	orgID := ws.OrganizationID
	todayDate := pgtype.Date{Time: today, Valid: true}
	fromAt := pgtype.Timestamptz{Time: now, Valid: true}
	userText := pgtype.Text{String: userID, Valid: true}

	priorities, err := s.q.ListCalendarSidebarPriorities(ctx, db.ListCalendarSidebarPrioritiesParams{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		LimitN:         limit,
	})
	if err != nil {
		return CalendarSidebar{}, err
	}
	meetWith, err := s.q.ListCalendarSidebarMeetWith(ctx, db.ListCalendarSidebarMeetWithParams{
		WorkspaceID: workspaceID,
		FromAt:      fromAt,
		LimitN:      limit,
	})
	if err != nil {
		return CalendarSidebar{}, err
	}
	assigned, err := s.q.ListCalendarSidebarAssigned(ctx, db.ListCalendarSidebarAssignedParams{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		UserID:         userText,
		Today:          todayDate,
		LimitN:         limit,
	})
	if err != nil {
		return CalendarSidebar{}, err
	}
	todayOverdue, err := s.q.ListCalendarSidebarTodayOverdue(ctx, db.ListCalendarSidebarTodayOverdueParams{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		Today:          todayDate,
		LimitN:         limit,
	})
	if err != nil {
		return CalendarSidebar{}, err
	}
	backlog, err := s.q.ListCalendarSidebarBacklog(ctx, db.ListCalendarSidebarBacklogParams{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		LimitN:         limit,
	})
	if err != nil {
		return CalendarSidebar{}, err
	}

	out := CalendarSidebar{
		Priorities:   mapCalendarSidebarTasks(priorities),
		MeetWith:     mapCalendarSidebarMeetings(meetWith),
		Assigned:     mapCalendarSidebarAssignedTasks(assigned),
		TodayOverdue: mapCalendarSidebarTodayOverdueTasks(todayOverdue),
		Backlog:      mapCalendarSidebarBacklogTasks(backlog),
	}
	return out, nil
}

func mapCalendarSidebarTasks(rows []db.ListCalendarSidebarPrioritiesRow) []CalendarSidebarTask {
	out := make([]CalendarSidebarTask, 0, len(rows))
	for _, r := range rows {
		out = append(out, calendarSidebarTask(r.ID, r.Title, r.Status, r.Priority, r.DueDate))
	}
	return out
}

func mapCalendarSidebarAssignedTasks(rows []db.ListCalendarSidebarAssignedRow) []CalendarSidebarTask {
	out := make([]CalendarSidebarTask, 0, len(rows))
	for _, r := range rows {
		out = append(out, calendarSidebarTask(r.ID, r.Title, r.Status, r.Priority, r.DueDate))
	}
	return out
}

func mapCalendarSidebarTodayOverdueTasks(rows []db.ListCalendarSidebarTodayOverdueRow) []CalendarSidebarTask {
	out := make([]CalendarSidebarTask, 0, len(rows))
	for _, r := range rows {
		out = append(out, calendarSidebarTask(r.ID, r.Title, r.Status, r.Priority, r.DueDate))
	}
	return out
}

func mapCalendarSidebarBacklogTasks(rows []db.ListCalendarSidebarBacklogRow) []CalendarSidebarTask {
	out := make([]CalendarSidebarTask, 0, len(rows))
	for _, r := range rows {
		out = append(out, calendarSidebarTask(r.ID, r.Title, r.Status, r.Priority, r.DueDate))
	}
	return out
}

func calendarSidebarTask(id, title, status, priority string, due pgtype.Date) CalendarSidebarTask {
	return CalendarSidebarTask{
		ID:       id,
		Title:    title,
		Status:   status,
		Priority: calendarStrPtr(priority),
		DueDate:  calendarDatePtr(due),
	}
}

func mapCalendarSidebarMeetings(rows []db.ListCalendarSidebarMeetWithRow) []CalendarSidebarMeeting {
	out := make([]CalendarSidebarMeeting, 0, len(rows))
	for _, m := range rows {
		out = append(out, CalendarSidebarMeeting{
			ID:       m.ID,
			Title:    m.Title,
			StartsAt: m.StartsAt.Time.UTC().Format(time.RFC3339),
			EndsAt:   m.EndsAt.Time.UTC().Format(time.RFC3339),
		})
	}
	return out
}

func calendarDatePtr(d pgtype.Date) *string {
	if !d.Valid {
		return nil
	}
	s := d.Time.Format(time.DateOnly)
	return &s
}

func truncateUTCDate(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
}

// truncateLocalDate is midnight UTC on the Y-M-D of t in the process local zone.
func truncateLocalDate(t time.Time) time.Time {
	return truncateDateIn(t, time.Local)
}

// truncateDateIn is midnight UTC on the Y-M-D of t in loc. Split out so a test
// can exercise the wall-calendar boundary without reassigning time.Local,
// which races with every goroutine that formats a time.
func truncateDateIn(t time.Time, loc *time.Location) time.Time {
	l := t.In(loc)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC)
}

func taskCalendarEvent(t db.ListCalendarTasksInRangeRow) CalendarEvent {
	if t.StartAt.Valid && t.DueAt.Valid {
		start := t.StartAt.Time.UTC().Format(time.RFC3339)
		end := t.DueAt.Time.UTC().Format(time.RFC3339)
		return CalendarEvent{
			ID: "task:" + t.ID, Kind: "task", EntityID: t.ID, Title: t.Title,
			Start: start, End: &end, AllDay: false, Status: calendarStrPtr(t.Status),
			Priority: calendarStrPtr(t.Priority), ProjectID: util.TextToPtr(t.ProjectID),
		}
	}
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
