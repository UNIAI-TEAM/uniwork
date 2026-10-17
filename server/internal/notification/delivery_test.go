package notification

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
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

// FE-1/OQ-C8: a document mention push carries the short kindTitle, not the
// content sentence, so the title line reads the same as the Inbox will render
// it (G8-07).
func TestPushUsesShortKindTitle(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Đẩy nhắc tên")
	f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" xem giúp", "comment")
	f.handleComment(t)
	f.subscribe(t, f.member.ID, "https://push.example/short")

	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 || spy.sent[0].Title != kindTitles["vi"][KindDocumentMentioned] {
		t.Fatalf("sent = %+v, want the short kindTitle", spy.sent)
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
		ID: util.NewID(), WorkspaceID: f.wsID, OrganizationID: f.orgID, Title: "Standup", RoomName: "r", CreatedBy: f.owner.ID, CreatedByKind: "human",
		Status: "SCHEDULED", MeetingType: "SCHEDULED", HostUserID: f.owner.ID, Timezone: "UTC", AllowJoinRequest: true,
		StartsAt: pgtype.Timestamptz{Time: now.Add(8 * time.Minute), Valid: true},
		EndsAt:   pgtype.Timestamptz{Time: now.Add(38 * time.Minute), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	invite := func(userID, response string) {
		p, err := f.q.CreateMeetingParticipant(f.ctx, db.CreateMeetingParticipantParams{
			ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, PrincipalType: "USER", UserID: pgtype.Text{String: userID, Valid: true},
			DisplayNameSnapshot: "x", Role: "PARTICIPANT", SourceType: "INVITE", AddedBy: f.owner.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		inv, err := f.q.CreateMeetingInvitation(f.ctx, db.CreateMeetingInvitationParams{ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, ParticipantID: p.ID, InvitedBy: f.owner.ID})
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

// R1-2: the email digest applies the same document read gate as Service.List.
// A recipient who lost the document after delivery must not receive its title
// (or snippet) by email: the row is dropped, and when that leaves nothing to
// render no digest goes out at all. A row the recipient can still read keeps
// its title; an archived (gone) document is dropped the same way.
func TestDigestAppliesTheDocumentReadGate(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "restricted", "Tiêu Đề Của Tài Liệu Được Chia Sẻ")
	recipient, recipientShare := f.sharedCommentAuthor(t, docID, "digest-recipient@example.com", "Người Nhận Digest")

	// Row 1 is written and delivered while the share lives: mailed with its
	// title, proving the gate does not hide a readable document.
	f.commentOf(t, f.owner.ID, docID, mentionOf(recipient)+" xem giúp", "comment")
	f.handleComment(t)

	out := &fakeOutbox{}
	s := NewDigestScheduler(f.q, mail.Renderer{AppURL: "http://app.test"}, out)
	s.SetDocumentReaders(f.docs)
	at := time.Date(2026, 9, 7, 1, 5, 0, 0, time.UTC) // 08:05 in Asia/Ho_Chi_Minh.
	if n, err := s.RunOnce(f.ctx, at); err != nil || n != 1 {
		t.Fatalf("readable digest = %d, %v", n, err)
	}
	if !contains(out.sent[0].Text, "Tiêu Đề Của Tài Liệu Được Chia Sẻ") {
		t.Fatalf("readable document lost its title:\n%s", out.sent[0].Text)
	}

	// Row 2 is written while the share lives, then the share is revoked: the
	// window must drop it, and with nothing else to render send no mail.
	f.commentOf(t, f.owner.ID, docID, mentionOf(recipient)+" lần nữa", "comment")
	f.handleComment(t)
	f.revokeShare(t, recipientShare, docID)
	out.sent = nil
	if n, err := s.RunOnce(f.ctx, at.Add(time.Minute)); err != nil || n != 0 {
		t.Fatalf("access_lost digest = %d, %v", n, err)
	}
	if len(out.sent) != 0 {
		t.Fatalf("digest mailed a document the recipient cannot read:\n%s", out.sent[0].Text)
	}

	// A document archived before the window is gone; a workspace member who
	// never lost a share is dropped just the same.
	goneDocID := f.document(t, "workspace", "Tài Liệu Sắp Bị Lưu Trữ")
	f.commentOf(t, f.owner.ID, goneDocID, mentionOf(f.member)+" đọc thử", "comment")
	f.handleComment(t)
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET archived_at = now() WHERE id = $1`, goneDocID); err != nil {
		t.Fatal(err)
	}
	out.sent = nil
	if n, err := s.RunOnce(f.ctx, at.Add(2*time.Minute)); err != nil || n != 0 {
		t.Fatalf("gone digest = %d, %v", n, err)
	}
	if len(out.sent) != 0 {
		t.Fatalf("digest mailed an archived document:\n%s", out.sent[0].Text)
	}
}

// Spec N2 §3.4: a chat push carries a short preview read at delivery; a
// message deleted before the push goes out sends nothing and is marked pushed.
func TestChatPushCarriesBodyAndSkipsDeleted(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribe(t, f.member.ID, "ExponentPushToken[member]")
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")

	if _, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: "[@Thành Viên](mention://member/" + f.member.ID + ") họp **9h** nhé"}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.dm.received")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 || spy.sent[0].Body != "@Thành Viên họp 9h nhé" || spy.sent[0].Title != "Chủ Nhóm đã nhắn tin cho bạn" {
		t.Fatalf("sent = %+v", spy.sent)
	}

	// Read it so the next DM opens a fresh row, then delete that message before the push runs.
	f.readAll(t, f.member.ID)
	gone, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: "nhầm"})
	if err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.dm.received")
	if err := chat.DeleteChatMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, gone.ID); err != nil {
		t.Fatal(err)
	}
	ev := f.lastEvent(t, TopicPush)
	for i := 0; i < 2; i++ {
		if err := pc.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	if len(spy.sent) != 1 {
		t.Fatalf("deleted message was pushed: %+v", spy.sent)
	}
	var p map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		t.Fatal(err)
	}
	if n, _ := f.q.GetNotification(f.ctx, p["notification_id"]); n.ResourceID != gone.ID || !n.PushedAt.Valid {
		t.Fatalf("deleted-message notification not marked pushed: %+v", n)
	}
}

type fakePresence struct {
	at  time.Time
	ok  bool
	err error
}

func (p fakePresence) LastPresenceBeat(context.Context, string) (time.Time, bool, error) {
	return p.at, p.ok, p.err
}

type countingMetrics struct{ suppressed, sent map[string]int }

func (m *countingMetrics) IncNotificationCreated(string) {}
func (m *countingMetrics) IncNotificationMerged()        {}
func (m *countingMetrics) IncPushSent(r string)          { m.sent[r]++ }
func (m *countingMetrics) IncDigestSent()                {}
func (m *countingMetrics) IncPushSuppressed(k string)    { m.suppressed[k]++ }

// Spec N2 §3.5: a recipient with a presence beat inside two minutes is at a
// keyboard already; the push is dropped and counted, the row marked pushed.
func TestChatPushIsSuppressedWhileTheRecipientIsActive(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribe(t, f.member.ID, "ExponentPushToken[member]")
	now := time.Now()
	send := func() outbox.Row {
		f.readAll(t, f.member.ID) // the next DM opens a fresh row
		if _, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: "x"}); err != nil {
			t.Fatal(err)
		}
		f.handleLast(t, "chat.dm.received")
		return f.lastEvent(t, TopicPush)
	}
	run := func(p PresenceChecker) (*spySender, *countingMetrics, outbox.Row) {
		spy, m := &spySender{}, &countingMetrics{suppressed: map[string]int{}, sent: map[string]int{}}
		pc := NewPushConsumer(f.q, spy, "http://app.test")
		pc.SetMetrics(m)
		pc.now = func() time.Time { return now }
		if p != nil {
			pc.SetPresence(p)
		}
		ev := send()
		if err := pc.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
		return spy, m, ev
	}

	spy, m, ev := run(fakePresence{at: now.Add(-30 * time.Second), ok: true})
	if len(spy.sent) != 0 || m.suppressed[KindChatDM] != 1 {
		t.Fatalf("active 30s ago: sent=%d suppressed=%v", len(spy.sent), m.suppressed)
	}
	var p map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		t.Fatal(err)
	}
	if n, err := f.q.GetNotification(f.ctx, p["notification_id"]); err != nil || !n.PushedAt.Valid {
		t.Fatalf("suppressed row not marked pushed: %+v err=%v", n, err)
	}
	if spy, m, _ := run(fakePresence{at: now.Add(-5 * time.Minute), ok: true}); len(spy.sent) != 1 || len(m.suppressed) != 0 {
		t.Fatal("active 5 minutes ago must still be pushed")
	}
	if spy, _, _ := run(fakePresence{ok: false}); len(spy.sent) != 1 {
		t.Fatal("never online must be pushed")
	}
	if spy, _, _ := run(fakePresence{err: errors.New("redis down")}); len(spy.sent) != 1 {
		t.Fatal("presence error must fail open")
	}
	if spy, _, _ := run(nil); len(spy.sent) != 1 {
		t.Fatal("no presence wired must push")
	}

	// A subscription no sender can reach (web while VAPID is off) is counted
	// as skipped, never as sent, and does not hold the row back.
	m2 := &countingMetrics{suppressed: map[string]int{}, sent: map[string]int{}}
	pc := NewPushConsumer(f.q, &spySender{err: ErrPushSkipped}, "http://app.test")
	pc.SetMetrics(m2)
	ev = send()
	if err := pc.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	if m2.sent["skipped"] != 1 || m2.sent["sent"] != 0 {
		t.Fatalf("skipped send counted as %v", m2.sent)
	}
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		t.Fatal(err)
	}
	if n, err := f.q.GetNotification(f.ctx, p["notification_id"]); err != nil || !n.PushedAt.Valid {
		t.Fatalf("skipped row not marked pushed: %+v err=%v", n, err)
	}
}

// blockingPresence stands in for a stalled Redis: it answers only when its
// context is done.
type blockingPresence struct{}

func (blockingPresence) LastPresenceBeat(ctx context.Context, _ string) (time.Time, bool, error) {
	<-ctx.Done()
	return time.Time{}, false, ctx.Err()
}

// A stalled presence lookup must not hold the two-worker push lane: the
// call is bounded and the push fails open within that bound.
func TestChatPushFailsOpenFastWhenPresenceStalls(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribe(t, f.member.ID, "ExponentPushToken[member]")
	if _, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: "x"}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.dm.received")
	ev := f.lastEvent(t, TopicPush)

	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	pc.SetPresence(blockingPresence{})
	ctx, cancel := context.WithTimeout(f.ctx, 3*time.Second)
	defer cancel()
	start := time.Now()
	err = pc.Handle(ctx, ev)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("stalled presence must fail open: %v", err)
	}
	if len(spy.sent) != 1 {
		t.Fatalf("stalled presence must still push, sent=%d", len(spy.sent))
	}
	if elapsed >= time.Second {
		t.Fatalf("Handle took %s with a stalled presence lookup", elapsed)
	}
}
