package notification

import (
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// actionItem inserts one MANUAL item on meetingID, linked to taskID when it
// is not empty.
func (f *fixture) actionItem(t *testing.T, id, meetingID, taskID string, dismissed bool) {
	t.Helper()
	var task any
	if taskID != "" {
		task = taskID
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO meeting_action_items (id, organization_id, workspace_id, meeting_id, source, position, title, task_id, dismissed_at, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, 'MANUAL', 0, $1, $5, CASE WHEN $6 THEN now() END, $7, 'human')`,
		id, f.orgID, f.wsID, meetingID, task, dismissed, f.owner.ID); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) endedAt(t *testing.T, meetingID string, at time.Time) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `UPDATE meetings SET actual_end_at = $2 WHERE id = $1`, meetingID, at); err != nil {
		t.Fatal(err)
	}
}

func kindCount(ns []db.Notification, kind string) int {
	n := 0
	for _, x := range ns {
		if x.Kind == kind {
			n++
		}
	}
	return n
}

// follow-2 (a): a day after a meeting ends with items nobody assigned yet,
// the host and the secretaries hear once how many are left; a fresh
// meeting, or one whose items are all handled, tells nobody.
func TestPendingItemsNudgeOnceADayAfterTheMeeting(t *testing.T) {
	f := newFixture(t)
	now := time.Now()
	meetingID, attendee, _ := f.recapMeeting(t)
	f.actionItem(t, "ai-1", meetingID, "", false)
	f.actionItem(t, "ai-2", meetingID, "", false)
	f.actionItem(t, "ai-3", meetingID, "", true)
	fresh := f.meetingWithSecretary(t, "Vừa họp")
	f.actionItem(t, "ai-fresh", fresh, "", false)
	handled := f.meetingWithSecretary(t, "Đã giao hết")
	f.actionItem(t, "ai-done", handled, "", true)
	f.endedAt(t, meetingID, now.Add(-25*time.Hour))
	f.endedAt(t, fresh, now.Add(-2*time.Hour))
	f.endedAt(t, handled, now.Add(-25*time.Hour))

	r := NewFollowThroughReminder(f.consumer)
	for i := 0; i < 2; i++ {
		if err := r.RunOnce(f.ctx, now); err != nil {
			t.Fatal(err)
		}
		f.readAll(t, f.owner.ID)
	}
	for _, uid := range []string{f.owner.ID, f.member.ID} {
		got := f.inbox(t, uid)
		if len(got) != 1 || got[0].Kind != KindMeetingActionItemsPending || got[0].ResourceID != meetingID ||
			!contains(got[0].Params, `"count":"2"`) || got[0].ActorKind != "system" {
			t.Fatalf("inbox of %s = %+v", uid, got)
		}
		url, err := ResourceURL(f.ctx, f.q, "https://app.test", got[0])
		if err != nil || url != "https://app.test/notif-org/notif-ws/meetings/"+meetingID+"?section=action-items" {
			t.Fatalf("url = %q %v", url, err)
		}
	}
	if n := len(f.inbox(t, attendee.ID)); n != 0 {
		t.Fatalf("attendee nudged %d times", n)
	}
}

// follow-2 (b): a task a meeting handed out reminds its assignee on the day
// it is due and once when it is overdue, never for a closed task.
func TestMeetingTaskDueAndOverdue(t *testing.T) {
	f := newFixture(t)
	meetingID := f.meetingWithSecretary(t, "Giao ban")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET timezone = 'Asia/Ho_Chi_Minh' WHERE id = $1`, f.member.ID); err != nil {
		t.Fatal(err)
	}
	loc, _ := time.LoadLocation("Asia/Ho_Chi_Minh")
	// 09:00 local: past the morning hour the reminders wait for.
	now := time.Date(2026, 10, 23, 9, 0, 0, 0, loc)
	today := now.Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")
	dueToday, overdue, closed, old := f.newTask(t, "Gửi báo cáo"), f.newTask(t, "Chốt ngân sách"), f.newTask(t, "Đã xong"), f.newTask(t, "Quá cũ")
	for _, c := range []struct {
		task db.Task
		due  string
	}{{dueToday, today}, {overdue, yesterday}, {closed, yesterday}, {old, now.AddDate(0, 0, -30).Format("2006-01-02")}} {
		if _, err := f.pool.Exec(f.ctx, `UPDATE tasks SET assignee_id = $2, assignee_kind = 'human', due_date = $3 WHERE id = $1`, c.task.ID, f.member.ID, c.due); err != nil {
			t.Fatal(err)
		}
		f.actionItem(t, "ai-"+c.task.ID, meetingID, c.task.ID, false)
	}
	f.setStatus(t, f.owner.ID, closed.ID, "done")
	if _, err := f.pool.Exec(f.ctx, `DELETE FROM notifications`); err != nil {
		t.Fatal(err)
	}

	r := NewFollowThroughReminder(f.consumer)
	// 07:00 local is too early.
	if err := r.RunOnce(f.ctx, now.Add(-2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if n := kindCount(f.inbox(t, f.member.ID), KindMeetingTaskDue); n != 0 {
		t.Fatalf("reminded before the morning: %d", n)
	}
	for i := 0; i < 2; i++ {
		if err := r.RunOnce(f.ctx, now); err != nil {
			t.Fatal(err)
		}
		f.readAll(t, f.member.ID)
	}
	got := f.inbox(t, f.member.ID)
	byTask := map[string]db.Notification{}
	for _, n := range got {
		if n.Kind == KindMeetingTaskDue {
			byTask[n.ResourceID] = n
		}
	}
	if len(byTask) != 2 || kindCount(got, KindMeetingTaskDue) != 2 {
		t.Fatalf("due notices = %+v", got)
	}
	if n := byTask[dueToday.ID]; n.ResourceType != "task" || !contains(n.Params, `"meeting":"Giao ban"`) || contains(n.Params, `"stage"`) {
		t.Fatalf("due today = %+v", n)
	}
	if n := byTask[overdue.ID]; !contains(n.Params, `"stage":"overdue"`) {
		t.Fatalf("overdue = %+v", n)
	}
	// The next day the due-today task is overdue: one more notice, then none.
	for i := 0; i < 2; i++ {
		if err := r.RunOnce(f.ctx, now.AddDate(0, 0, 1)); err != nil {
			t.Fatal(err)
		}
		f.readAll(t, f.member.ID)
	}
	if n := kindCount(f.inbox(t, f.member.ID), KindMeetingTaskDue); n != 3 {
		t.Fatalf("notices after a day = %d, want 3", n)
	}
	if got := Title("vi", KindMeetingTaskDue, map[string]string{"task": "A", "meeting": "B", "stage": "overdue"}); got != "Việc \"A\" từ cuộc họp \"B\" đã quá hạn" {
		t.Fatalf("vi overdue title = %q", got)
	}
}
