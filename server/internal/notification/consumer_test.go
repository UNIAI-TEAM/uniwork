package notification

import (
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Assigning a task tells the assignee and nobody else; assigning yourself
// tells nobody.
func TestRuleTaskAssigned(t *testing.T) {
	f := newFixture(t)
	task := f.newTask(t, "Viết spec")

	f.assign(t, task.ID, f.member.ID)
	f.handleLast(t, "task.updated")
	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindTaskAssigned || got[0].TitleKey != "notifications.kind.task_assigned" {
		t.Fatalf("member inbox = %+v", got)
	}
	if got[0].ActorID != f.owner.ID || got[0].ActorKind != "human" || got[0].WorkspaceID.String != f.wsID {
		t.Fatalf("attribution = %+v", got[0])
	}
	if len(f.inbox(t, f.owner.ID)) != 0 {
		t.Fatal("the actor got their own notification")
	}

	f.assign(t, task.ID, f.owner.ID)
	f.handleLast(t, "task.updated")
	if len(f.inbox(t, f.owner.ID)) != 0 {
		t.Fatal("self-assignment produced a notification")
	}
	// The realtime frame carries ids only, on the recipient's user scope.
	created := f.lastEvent(t, TopicCreated)
	if created.Payload != `{"notification_id":"`+got[0].ID+`","user_id":"`+f.member.ID+`"}` {
		t.Fatalf("notification.created payload = %s", created.Payload)
	}
}

// Two status changes on one task before the member looks are one row with
// count = 2. Once read, the next change starts a new row.
func TestMergeWithinWindow(t *testing.T) {
	f := newFixture(t)
	task := f.newTask(t, "Gộp")
	f.assign(t, task.ID, f.member.ID)
	f.handleLast(t, "task.updated")

	f.setStatus(t, f.owner.ID, task.ID, "in_progress")
	f.handleLast(t, "task.updated")
	f.setStatus(t, f.owner.ID, task.ID, "done")
	f.handleLast(t, "task.updated")

	var status []db.Notification
	for _, n := range f.inbox(t, f.member.ID) {
		if n.Kind == KindTaskStatusChanged {
			status = append(status, n)
		}
	}
	if len(status) != 1 || status[0].Count != 2 {
		t.Fatalf("status rows = %+v", status)
	}
	if len(f.events(t, TopicPush)) != 1 { // assigned (push default on); status merged rows never push
		t.Fatalf("push events = %d", len(f.events(t, TopicPush)))
	}

	if _, err := f.q.MarkNotificationsRead(f.ctx, db.MarkNotificationsReadParams{UserID: f.member.ID, Ids: []string{status[0].ID}}); err != nil {
		t.Fatal(err)
	}
	f.setStatus(t, f.owner.ID, task.ID, "todo")
	f.handleLast(t, "task.updated")
	rows, _ := f.q.ListNotifications(f.ctx, db.ListNotificationsParams{UserID: f.member.ID, UnreadOnly: true, LimitN: 50})
	var unreadStatus int
	for _, n := range rows {
		if n.Kind == KindTaskStatusChanged {
			unreadStatus++
		}
	}
	if unreadStatus != 1 {
		t.Fatalf("after read, new status rows = %d", unreadStatus)
	}
}

// The dispatcher retries a row as a whole when a sibling consumer fails, so
// the same event reaches Handle twice. The second pass must be a no-op.
func TestConsumerIdempotent(t *testing.T) {
	f := newFixture(t)
	task := f.newTask(t, "Lặp")
	f.assign(t, task.ID, f.member.ID)
	ev := f.lastEvent(t, "task.updated")
	for i := 0; i < 2; i++ {
		if err := f.consumer.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	if n := f.inbox(t, f.member.ID); len(n) != 1 || n[0].Count != 1 {
		t.Fatalf("notifications after two passes = %+v", n)
	}
	if n := len(f.events(t, TopicPush)); n != 1 {
		t.Fatalf("push events = %d", n)
	}
}

// in_app off means no row at all; push off means a row but no push event.
func TestPrefsGate(t *testing.T) {
	f := newFixture(t)
	set := func(inApp, push bool) {
		if err := f.q.UpsertNotificationPreference(f.ctx, db.UpsertNotificationPreferenceParams{
			UserID: f.member.ID, Kind: KindTaskAssigned, InApp: inApp, Push: push, Email: true,
		}); err != nil {
			t.Fatal(err)
		}
	}
	set(false, true)
	task := f.newTask(t, "Tắt")
	f.assign(t, task.ID, f.member.ID)
	f.handleLast(t, "task.updated")
	if len(f.inbox(t, f.member.ID)) != 0 {
		t.Fatal("in_app=false still created a notification")
	}

	set(true, false)
	task2 := f.newTask(t, "Không push")
	f.assign(t, task2.ID, f.member.ID)
	f.handleLast(t, "task.updated")
	if len(f.inbox(t, f.member.ID)) != 1 {
		t.Fatal("in_app=true created nothing")
	}
	if len(f.events(t, TopicPush)) != 0 {
		t.Fatal("push=false still emitted notification.push")
	}
}

// "@Thành Viên" in a comment is a mention for that member and nothing else;
// the author hears nothing; the assignee (also the author here) is skipped.
func TestMentioned(t *testing.T) {
	f := newFixture(t)
	task := f.newTask(t, "Nhắc")
	f.assign(t, task.ID, f.owner.ID)
	if _, err := f.tasks.AddComment(f.ctx, f.ownerActor(), task.ID, "@thành viên xem giúp nhé, đoạn này dài "+repeat("x", 200)); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "task.comment_added")
	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindMentioned {
		t.Fatalf("member inbox = %+v", got)
	}
	if len(got[0].Params) > 300 || !contains(got[0].Params, "…") {
		t.Fatalf("snippet not bounded: %s", got[0].Params)
	}
	if len(f.inbox(t, f.owner.ID)) != 0 {
		t.Fatal("author notified of own comment")
	}

	// A second comment by the member reaches the owner as task_commented
	// (creator + assignee) once, not twice.
	if _, err := f.tasks.AddComment(f.ctx, f.memberActor(), task.ID, "đã xem"); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "task.comment_added")
	owner := f.inbox(t, f.owner.ID)
	if len(owner) != 1 || owner[0].Kind != KindTaskCommented {
		t.Fatalf("owner inbox = %+v", owner)
	}
}
