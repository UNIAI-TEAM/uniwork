package notification

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type spySender struct {
	sent []PushMessage
	err  error
}

func (s *spySender) Send(_ context.Context, _ db.PushSubscription, m PushMessage) error {
	s.sent = append(s.sent, m)
	return s.err
}

func (f *fixture) subscribe(t *testing.T, userID, endpoint string) {
	t.Helper()
	if _, err := f.q.UpsertPushSubscription(f.ctx, db.UpsertPushSubscriptionParams{
		ID: util.NewID(), UserID: userID, Endpoint: endpoint, P256dh: "p", Auth: "a",
	}); err != nil {
		t.Fatal(err)
	}
}

// A 410 from the push service revokes the subscription and does not fail
// the row; a healthy send marks the notification pushed and carries the
// deep link and the group tag.
func TestPushGone(t *testing.T) {
	f := newFixture(t)
	task := f.newTask(t, "Đẩy")
	f.assign(t, task.ID, f.member.ID)
	f.handleLast(t, "task.updated")
	f.subscribe(t, f.member.ID, "https://push.example/gone")

	gone := &spySender{err: ErrSubscriptionGone}
	pc := NewPushConsumer(f.q, gone, "http://app.test/")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if subs, _ := f.q.ListActivePushSubscriptions(f.ctx, f.member.ID); len(subs) != 0 {
		t.Fatal("410 did not revoke the subscription")
	}
	if n, _ := f.q.GetNotification(f.ctx, f.inbox(t, f.member.ID)[0].ID); !n.PushedAt.Valid {
		t.Fatal("notification not marked pushed after a gone subscription")
	}

	task2 := f.newTask(t, "Đẩy lần hai")
	f.assign(t, task2.ID, f.member.ID)
	f.handleLast(t, "task.updated")
	f.subscribe(t, f.member.ID, "https://push.example/ok")
	ok := &spySender{}
	pc = NewPushConsumer(f.q, ok, "http://app.test")
	ev := f.lastEvent(t, TopicPush)
	for i := 0; i < 2; i++ { // retried row: one send
		if err := pc.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	if len(ok.sent) != 1 || ok.sent[0].Title != "Chủ Nhóm đã giao bạn việc “Đẩy lần hai”" ||
		ok.sent[0].URL != "http://app.test/notif-org/notif-ws/tasks/"+task2.ID || ok.sent[0].Tag != "task:"+task2.ID+":assigned" {
		t.Fatalf("sent = %+v", ok.sent)
	}
}

// Three ticks inside the window queue one mail; nothing when there is
// nothing unread; nothing to an unverified address.
func TestDigestOncePerDay(t *testing.T) {
	f := newFixture(t)
	task := f.newTask(t, "Tóm tắt")
	f.assign(t, task.ID, f.member.ID)
	f.handleLast(t, "task.updated")

	out := &fakeOutbox{}
	s := NewDigestScheduler(f.q, mail.Renderer{AppURL: "http://app.test"}, out)
	// 01:05 UTC is 08:05 in Asia/Ho_Chi_Minh, the default zone.
	at := time.Date(2026, 9, 7, 1, 5, 0, 0, time.UTC)
	for i := 0; i < 3; i++ {
		if _, err := s.RunOnce(f.ctx, at.Add(time.Duration(i)*4*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	if len(out.sent) != 1 || out.sent[0].To != f.member.Email || out.sent[0].Kind != mail.KindNotificationDigest {
		t.Fatalf("digests = %+v", out.sent)
	}
	if !contains(out.sent[0].Text, "Chủ Nhóm đã giao bạn việc “Tóm tắt”") || !contains(out.sent[0].Text, "/notif-org/notif-ws/tasks/"+task.ID) {
		t.Fatalf("digest text:\n%s", out.sent[0].Text)
	}
	if n, _ := s.RunOnce(f.ctx, at.Add(2*time.Minute)); n != 0 {
		t.Fatal("digested rows were mailed again")
	}
	// Outside the window nothing goes out even with fresh rows.
	task2 := f.newTask(t, "Ngoài giờ")
	f.assign(t, task2.ID, f.member.ID)
	f.handleLast(t, "task.updated")
	if n, _ := s.RunOnce(f.ctx, at.Add(3*time.Hour)); n != 0 {
		t.Fatal("digest sent outside the 08:00 window")
	}
	// An unverified address is skipped.
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET email_verified_at = NULL WHERE id = $1`, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.RunOnce(f.ctx, at); n != 0 {
		t.Fatal("digest sent to an unverified address")
	}
}

// A meeting eight minutes out reminds the host and accepted invitees once;
// the next tick adds nothing; a declined invitee hears nothing.
func TestMeetingReminderOnce(t *testing.T) {
	f := newFixture(t)
	now := time.Now()
	m, err := f.q.CreateMeeting(f.ctx, db.CreateMeetingParams{
		ID: util.NewID(), WorkspaceID: f.wsID, Title: "Standup", RoomName: "r", CreatedBy: f.owner.ID, CreatedByKind: "human",
		Status: "SCHEDULED", MeetingType: "SCHEDULED", HostUserID: f.owner.ID, Timezone: "UTC", AllowJoinRequest: true,
		StartsAt: pgtype.Timestamptz{Time: now.Add(8 * time.Minute), Valid: true},
		EndsAt:   pgtype.Timestamptz{Time: now.Add(38 * time.Minute), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	invite := func(userID, response string) {
		p, err := f.q.CreateMeetingParticipant(f.ctx, db.CreateMeetingParticipantParams{
			ID: util.NewID(), MeetingID: m.ID, PrincipalType: "USER", UserID: pgtype.Text{String: userID, Valid: true},
			DisplayNameSnapshot: "x", Role: "PARTICIPANT", SourceType: "INVITE", AddedBy: f.owner.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		inv, err := f.q.CreateMeetingInvitation(f.ctx, db.CreateMeetingInvitationParams{ID: util.NewID(), MeetingID: m.ID, ParticipantID: p.ID, InvitedBy: f.owner.ID})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.q.UpdateInvitationResponse(f.ctx, db.UpdateInvitationResponseParams{ID: inv.ID, ResponseStatus: response}); err != nil {
			t.Fatal(err)
		}
	}
	invite(f.member.ID, "ACCEPTED")

	r := NewMeetingReminder(f.consumer)
	for i := 0; i < 2; i++ {
		if _, err := r.RunOnce(f.ctx, now); err != nil {
			t.Fatal(err)
		}
	}
	for _, uid := range []string{f.owner.ID, f.member.ID} {
		got := f.inbox(t, uid)
		if len(got) != 1 || got[0].Kind != KindMeetingStarting || got[0].Count != 1 || got[0].ActorKind != "system" {
			t.Fatalf("inbox of %s = %+v", uid, got)
		}
		if !contains(got[0].Params, `"minutes":"8"`) {
			t.Fatalf("params = %s", got[0].Params)
		}
	}
	if n, _ := r.RunOnce(f.ctx, now.Add(20*time.Minute)); n != 0 {
		t.Fatal("a meeting already started was picked up")
	}
}
