package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type calendarFix struct {
	cal   *CalendarService
	tasks *TaskService
	orgs  *OrganizationService
	ws    *WorkspaceService
	pool  *pgxpool.Pool
	a, b  db.User
	w     db.Workspace
}

func calendarFixture(t *testing.T) calendarFix {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	ua := registerVerified(t, q, as, "cal-a@example.com", "A")
	ub := registerVerified(t, q, as, "cal-b@example.com", "B")
	org, err := orgs.Create(ctx, ua.ID, "Org", "org-cal")
	if err != nil {
		t.Fatal(err)
	}
	v, err := ws.CreateInOrg(ctx, ua.ID, org.ID, "Alpha", "alpha")
	if err != nil {
		t.Fatal(err)
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: v.Workspace.ID, UserID: ub.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	return calendarFix{
		cal:   NewCalendarService(q, ws),
		tasks: NewTaskService(pool, q, ws, newMemStorage()),
		orgs:  orgs,
		ws:    ws,
		pool:  pool,
		a:     ua,
		b:     ub,
		w:     v.Workspace,
	}
}

func (f calendarFix) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func (f calendarFix) task(t *testing.T, title, due string, assignee *string) string {
	t.Helper()
	in := CreateTaskInput{Title: title, DueDate: &due}
	if assignee != nil {
		in.AssigneeID = assignee
	}
	task, err := f.tasks.Create(context.Background(), Human(f.a.ID), f.w.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	return task.ID
}

func (f calendarFix) meeting(t *testing.T, id, host, status string, starts time.Time) {
	t.Helper()
	f.exec(t, `INSERT INTO meetings (id, workspace_id, title, starts_at, ends_at, room_name, created_by, host_user_id, status)
		VALUES ($1, $2, $1, $3, $4, $1, $5, $5, $6)`, id, f.w.ID, starts, starts.Add(30*time.Minute), host, status)
}

func (f calendarFix) participant(t *testing.T, meetingID, userID string, removed bool) {
	t.Helper()
	var removedAt any
	if removed {
		removedAt = time.Now()
	}
	f.exec(t, `INSERT INTO meeting_participants (id, meeting_id, principal_type, user_id, added_by, removed_at)
		VALUES ($1, $2, 'USER', $3, $3, $4)`, meetingID+"-"+userID, meetingID, userID, removedAt)
}

func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func eventIDs(evs []CalendarEvent) string {
	ids := make([]string, 0, len(evs))
	for _, e := range evs {
		ids = append(ids, e.ID)
	}
	return strings.Join(ids, ",")
}

func TestCalendarListEventsInRange(t *testing.T) {
	f := calendarFixture(t)
	ctx := context.Background()
	from, to := day(2026, 9, 1), day(2026, 9, 30)

	inRange := f.task(t, "due-mid", "2026-09-15", &f.a.ID)
	f.task(t, "outside", "2026-10-05", &f.a.ID)
	f.meeting(t, "m-in", f.a.ID, "SCHEDULED", time.Date(2026, 9, 10, 3, 0, 0, 0, time.UTC))
	f.meeting(t, "m-out", f.a.ID, "SCHEDULED", time.Date(2026, 10, 5, 3, 0, 0, 0, time.UTC))
	f.meeting(t, "m-canceled", f.a.ID, "CANCELED", time.Date(2026, 9, 12, 3, 0, 0, 0, time.UTC))

	got, err := f.cal.ListEvents(ctx, f.w.ID, f.a.ID, from, to, false)
	if err != nil {
		t.Fatal(err)
	}
	ids := eventIDs(got)
	if !strings.Contains(ids, "task:"+inRange) {
		t.Fatalf("missing in-range task: %s", ids)
	}
	if !strings.Contains(ids, "meeting:m-in") {
		t.Fatalf("missing in-range meeting: %s", ids)
	}
	if strings.Contains(ids, "outside") || strings.Contains(ids, "m-out") {
		t.Fatalf("out-of-range present: %s", ids)
	}
	if strings.Contains(ids, "m-canceled") {
		t.Fatalf("canceled meeting present: %s", ids)
	}

	var taskEv *CalendarEvent
	for i := range got {
		if got[i].ID == "task:"+inRange {
			taskEv = &got[i]
			break
		}
	}
	if taskEv == nil || !taskEv.AllDay || taskEv.Start != "2026-09-15" || taskEv.End == nil || *taskEv.End != "2026-09-16" {
		t.Fatalf("task event shape: %+v", taskEv)
	}
}

func TestCalendarListEventsIsolatesWorkspaces(t *testing.T) {
	f := calendarFixture(t)
	ctx := context.Background()
	from, to := day(2026, 9, 1), day(2026, 9, 30)

	f.task(t, "in-alpha", "2026-09-15", &f.a.ID)

	org2, err := f.orgs.Create(ctx, f.a.ID, "Org2", "org-cal-2")
	if err != nil {
		t.Fatal(err)
	}
	v2, err := f.ws.CreateInOrg(ctx, f.a.ID, org2.ID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	due := "2026-09-15"
	other, err := f.tasks.Create(ctx, Human(f.a.ID), v2.Workspace.ID, CreateTaskInput{Title: "other-ws", DueDate: &due, AssigneeID: &f.a.ID})
	if err != nil {
		t.Fatal(err)
	}

	got, err := f.cal.ListEvents(ctx, f.w.ID, f.a.ID, from, to, false)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(eventIDs(got), other.ID) {
		t.Fatalf("other workspace task leaked: %s", eventIDs(got))
	}
}

func TestCalendarListEventsMineFilter(t *testing.T) {
	f := calendarFixture(t)
	ctx := context.Background()
	from, to := day(2026, 9, 1), day(2026, 9, 30)

	mine := f.task(t, "mine", "2026-09-15", &f.a.ID)
	theirs := f.task(t, "theirs", "2026-09-16", &f.b.ID)

	meetStart := time.Date(2026, 9, 10, 3, 0, 0, 0, time.UTC)
	f.meeting(t, "m-host", f.a.ID, "SCHEDULED", meetStart)
	f.meeting(t, "m-participant", f.b.ID, "SCHEDULED", meetStart.Add(24*time.Hour))
	f.participant(t, "m-participant", f.a.ID, false)
	f.meeting(t, "m-other", f.b.ID, "SCHEDULED", meetStart.Add(48*time.Hour))
	f.meeting(t, "m-removed", f.b.ID, "SCHEDULED", meetStart.Add(72*time.Hour))
	f.participant(t, "m-removed", f.a.ID, true)

	got, err := f.cal.ListEvents(ctx, f.w.ID, f.a.ID, from, to, true)
	if err != nil {
		t.Fatal(err)
	}
	ids := eventIDs(got)
	if !strings.Contains(ids, "task:"+mine) {
		t.Fatalf("missing mine task: %s", ids)
	}
	if strings.Contains(ids, theirs) {
		t.Fatalf("theirs visible under mine: %s", ids)
	}
	if !strings.Contains(ids, "meeting:m-host") {
		t.Fatalf("missing hosted meeting under mine: %s", ids)
	}
	if !strings.Contains(ids, "meeting:m-participant") {
		t.Fatalf("missing participant meeting under mine: %s", ids)
	}
	if strings.Contains(ids, "meeting:m-other") {
		t.Fatalf("unrelated meeting visible under mine: %s", ids)
	}
	if strings.Contains(ids, "meeting:m-removed") {
		t.Fatalf("removed participant meeting visible under mine: %s", ids)
	}
}

func TestCalendarListEventsRejectsBadRange(t *testing.T) {
	f := calendarFixture(t)
	ctx := context.Background()
	var ve ValidationError

	if _, err := f.cal.ListEvents(ctx, f.w.ID, f.a.ID, day(2026, 9, 30), day(2026, 9, 1), false); !errors.As(err, &ve) {
		t.Fatalf("to < from: %v", err)
	}
	if _, err := f.cal.ListEvents(ctx, f.w.ID, f.a.ID, day(2026, 1, 1), day(2027, 1, 3), false); !errors.As(err, &ve) {
		t.Fatalf("span > 366: %v", err)
	}
}

func TestCalendarListEventsForbiddenForNonMember(t *testing.T) {
	f := calendarFixture(t)
	ctx := context.Background()
	q := db.New(f.pool)
	as := NewAuthService(f.pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	outsider := registerVerified(t, q, as, "cal-outsider@example.com", "Out")
	if _, err := f.cal.ListEvents(ctx, f.w.ID, outsider.ID, day(2026, 9, 1), day(2026, 9, 30), false); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member: %v", err)
	}
}
