package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type homeFix struct {
	home  *HomeService
	tasks *TaskService
	pool  *pgxpool.Pool
	a, b  db.User
	w     db.Workspace
}

func homeFixture(t *testing.T, now time.Time) homeFix {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	ua := registerVerified(t, q, as, "home-a@example.com", "A")
	ub := registerVerified(t, q, as, "home-b@example.com", "B")
	org, err := orgs.Create(ctx, ua.ID, "Org", "org-alpha")
	if err != nil {
		t.Fatal(err)
	}
	v, err := ws.CreateInOrg(ctx, ua.ID, org.ID, "Alpha", "alpha")
	if err != nil {
		t.Fatal(err)
	}
	home := NewHomeService(q, ws)
	home.now = func() time.Time { return now }
	return homeFix{home: home, tasks: NewTaskService(pool, q, ws, newMemStorage()), pool: pool, a: ua, b: ub, w: v.Workspace}
}

func (f homeFix) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

// task creates a task assigned to A, then sets the fields a user could have
// reached by editing it later (a past due date, a closed status).
func (f homeFix) task(t *testing.T, title, status, priority, due string, created time.Time) string {
	t.Helper()
	assignee := f.a.ID
	task, err := f.tasks.Create(context.Background(), Human(f.a.ID), f.w.ID, CreateTaskInput{Title: title, AssigneeID: &assignee})
	if err != nil {
		t.Fatal(err)
	}
	var dueArg any
	if due != "" {
		dueArg = due
	}
	f.exec(t, `UPDATE tasks SET status = $2, priority = $3, due_date = $4::date, created_at = $5 WHERE id = $1`,
		task.ID, status, priority, dueArg, created)
	return task.ID
}

func (f homeFix) meeting(t *testing.T, id, host, status string, starts time.Time) {
	t.Helper()
	f.exec(t, `INSERT INTO meetings (id, workspace_id, title, starts_at, ends_at, room_name, created_by, host_user_id, status)
		VALUES ($1, $2, $1, $3, $4, $1, $5, $5, $6)`, id, f.w.ID, starts, starts.Add(30*time.Minute), host, status)
}

func (f homeFix) participant(t *testing.T, meetingID, userID string, removed bool) {
	t.Helper()
	var removedAt any
	if removed {
		removedAt = time.Now()
	}
	f.exec(t, `INSERT INTO meeting_participants (id, meeting_id, principal_type, user_id, added_by, removed_at)
		VALUES ($1, $2, 'USER', $3, $3, $4)`, meetingID+"-"+userID, meetingID, userID, removedAt)
}

func titles(ts []db.Task) string {
	out := make([]string, 0, len(ts))
	for _, t := range ts {
		out = append(out, t.Title)
	}
	return strings.Join(out, ",")
}

func TestHomeSummaryOrdersMyWorkByUrgency(t *testing.T) {
	now := time.Date(2026, 9, 14, 3, 0, 0, 0, time.UTC) // 10:00 in Asia/Ho_Chi_Minh
	f := homeFixture(t, now)
	ctx := context.Background()
	base := now.Add(-48 * time.Hour)

	f.task(t, "later", "todo", "low", "2026-09-20", base)
	f.task(t, "undated", "todo", "urgent", "", base)
	f.task(t, "today-low", "in_progress", "low", "2026-09-14", base)
	f.task(t, "today-urgent", "todo", "urgent", "2026-09-14", base.Add(time.Minute))
	f.task(t, "overdue-old", "todo", "medium", "2026-09-01", base)
	f.task(t, "overdue-new", "blocked", "urgent", "2026-09-10", base)
	f.task(t, "closed-done", "done", "urgent", "2026-09-01", base)
	f.task(t, "closed-cancelled", "cancelled", "urgent", "2026-09-01", base)
	// A custom status in the done category is closed too.
	f.exec(t, `INSERT INTO task_statuses (id, organization_id, workspace_id, key, name, category, color, created_by)
		VALUES ('st-shipped', $1, $2, 'shipped', 'Shipped', 'done', '#00aa00', $3)`, f.w.OrganizationID, f.w.ID, f.a.ID)
	f.task(t, "closed-custom", "shipped", "urgent", "2026-09-01", base)
	other := f.task(t, "for-b", "todo", "urgent", "2026-09-01", base)
	f.exec(t, `UPDATE tasks SET assignee_id = $2 WHERE id = $1`, other, f.b.ID)

	got, err := f.home.Summary(ctx, Human(f.a.ID), f.w.ID, HomeLimits{})
	if err != nil {
		t.Fatal(err)
	}
	if want := "overdue-old,overdue-new,today-urgent,today-low,later,undated"; titles(got.MyWork) != want {
		t.Fatalf("order = %s, want %s", titles(got.MyWork), want)
	}
	if got.Today != "2026-09-14" || got.Timezone != "Asia/Ho_Chi_Minh" {
		t.Fatalf("today = %s %s", got.Today, got.Timezone)
	}
	if got.Counts.Open != 6 || got.Counts.Overdue != 2 || got.Counts.DueToday != 2 {
		t.Fatalf("counts = %+v", got.Counts)
	}
	if len(got.Partial) != 0 {
		t.Fatalf("partial = %v", got.Partial)
	}

	// The list is capped; the counts are not.
	capped, err := f.home.Summary(ctx, Human(f.a.ID), f.w.ID, HomeLimits{Tasks: 3})
	if err != nil {
		t.Fatal(err)
	}
	if titles(capped.MyWork) != "overdue-old,overdue-new,today-urgent" || capped.Counts.Open != 6 {
		t.Fatalf("capped = %s %+v", titles(capped.MyWork), capped.Counts)
	}
}

func TestHomeSummaryCountsFollowUserTimezone(t *testing.T) {
	// 18:30 UTC on the 14th is 01:30 on the 15th in Ho Chi Minh City.
	now := time.Date(2026, 9, 14, 18, 30, 0, 0, time.UTC)
	f := homeFixture(t, now)
	ctx := context.Background()
	f.task(t, "due-15th", "todo", "medium", "2026-09-15", now)

	cases := []struct {
		tz, wantTZ, wantToday string
		dueToday              int64
	}{
		{"Asia/Ho_Chi_Minh", "Asia/Ho_Chi_Minh", "2026-09-15", 1},
		{"UTC", "UTC", "2026-09-14", 0},
		// An unknown zone falls back to the product default, not to UTC.
		{"Mars/Olympus", "Asia/Ho_Chi_Minh", "2026-09-15", 1},
	}
	for _, c := range cases {
		f.exec(t, `UPDATE users SET timezone = $2 WHERE id = $1`, f.a.ID, c.tz)
		got, err := f.home.Summary(ctx, Human(f.a.ID), f.w.ID, HomeLimits{})
		if err != nil {
			t.Fatal(err)
		}
		if got.Timezone != c.wantTZ || got.Today != c.wantToday || got.Counts.DueToday != c.dueToday {
			t.Fatalf("%s: tz=%s today=%s counts=%+v", c.tz, got.Timezone, got.Today, got.Counts)
		}
	}
}

func TestHomeSummaryMeetingsOnlyMineTodayTomorrow(t *testing.T) {
	now := time.Date(2026, 9, 14, 3, 0, 0, 0, time.UTC) // 10:00 on the 14th in Ho Chi Minh City
	f := homeFixture(t, now)
	ctx := context.Background()
	at := func(day, hourUTC int) time.Time { return time.Date(2026, 9, day, hourUTC, 0, 0, 0, time.UTC) }

	f.meeting(t, "m-host", f.a.ID, "SCHEDULED", at(14, 5))
	f.meeting(t, "m-part", f.b.ID, "SCHEDULED", at(15, 2))
	f.participant(t, "m-part", f.a.ID, false)
	f.meeting(t, "m-live", f.b.ID, "IN_PROGRESS", at(10, 2))
	f.participant(t, "m-live", f.a.ID, false)
	f.meeting(t, "m-removed", f.b.ID, "SCHEDULED", at(14, 6))
	f.participant(t, "m-removed", f.a.ID, true)
	f.meeting(t, "m-other", f.b.ID, "SCHEDULED", at(14, 7))
	f.meeting(t, "m-ended", f.a.ID, "ENDED", at(14, 4))
	f.meeting(t, "m-day-after", f.a.ID, "SCHEDULED", at(16, 2))
	f.meeting(t, "m-yesterday-local", f.a.ID, "SCHEDULED", at(13, 16)) // 23:00 on the 13th locally

	got, err := f.home.Summary(ctx, Human(f.a.ID), f.w.ID, HomeLimits{})
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(got.Meetings))
	for _, m := range got.Meetings {
		ids = append(ids, m.ID)
	}
	if strings.Join(ids, ",") != "m-live,m-host,m-part" {
		t.Fatalf("meetings = %v", ids)
	}
	if got.Counts.MeetingsToday != 1 {
		t.Fatalf("meetings today = %d", got.Counts.MeetingsToday)
	}
}

func TestHomeSummaryForbiddenForNonMember(t *testing.T) {
	f := homeFixture(t, time.Now())
	ctx := context.Background()
	isDenied := func(err error) bool { return errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) }

	if _, err := f.home.Summary(ctx, Human(f.b.ID), f.w.ID, HomeLimits{}); !isDenied(err) {
		t.Fatalf("summary for non-member: %v", err)
	}
	if _, err := f.home.GetPreference(ctx, Human(f.b.ID), f.w.ID); !isDenied(err) {
		t.Fatalf("get preference for non-member: %v", err)
	}
	if _, err := f.home.PutPreference(ctx, Human(f.b.ID), f.w.ID, json.RawMessage(`{}`)); !isDenied(err) {
		t.Fatalf("put preference for non-member: %v", err)
	}
}

func TestHomePreferenceRoundTripAndValidation(t *testing.T) {
	f := homeFixture(t, time.Now())
	ctx := context.Background()
	actor := Human(f.a.ID)

	empty, err := f.home.GetPreference(ctx, actor, f.w.ID)
	if err != nil || string(empty.Prefs) != "{}" || empty.UpdatedAt.Valid {
		t.Fatalf("empty = %s %v err=%v", empty.Prefs, empty.UpdatedAt, err)
	}

	put, err := f.home.PutPreference(ctx, actor, f.w.ID, json.RawMessage(`{"layout":"compact"}`))
	if err != nil || !put.UpdatedAt.Valid {
		t.Fatalf("put = %+v err=%v", put, err)
	}
	got, err := f.home.GetPreference(ctx, actor, f.w.ID)
	var decoded map[string]string
	if err != nil || json.Unmarshal(got.Prefs, &decoded) != nil || decoded["layout"] != "compact" {
		t.Fatalf("get after put = %s err=%v", got.Prefs, err)
	}

	var ve ValidationError
	if _, err := f.home.PutPreference(ctx, actor, f.w.ID, json.RawMessage(`[]`)); !errors.As(err, &ve) {
		t.Fatalf("array prefs: %v", err)
	}
	big := json.RawMessage(`{"x":"` + strings.Repeat("a", maxHomePrefsBytes) + `"}`)
	if _, err := f.home.PutPreference(ctx, actor, f.w.ID, big); !errors.As(err, &ve) {
		t.Fatalf("oversized prefs: %v", err)
	}

	agent := Actor{Kind: audit.KindAgent, ID: "agent-1"}
	if _, err := f.home.GetPreference(ctx, agent, f.w.ID); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("agent preference: %v", err)
	}
}
