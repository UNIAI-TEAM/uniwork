package notification

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func payloadOf(t *testing.T, ev outbox.Row) map[string]string {
	t.Helper()
	var p map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func (f *fixture) notificationOf(t *testing.T, push outbox.Row) db.Notification {
	t.Helper()
	n, err := f.q.GetNotification(f.ctx, payloadOf(t, push)["notification_id"])
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// Spec M3 §2: a call rings the callee's phone through a push "X đang gọi"
// that lives 60 seconds, opens the call, and is not held back by presence: an
// open desktop still rings, the phone is the background path.
func TestCallInvitePushesTheCalleeWhileItRings(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	f.consumer.SetCallRinging(chat)
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribe(t, f.member.ID, "ExponentPushToken[member]")
	// A browser too: it rings in-app through realtime, so the call push is the phone's only.
	f.subscribe(t, f.member.ID, "https://push.example/member-browser")
	now := time.Now()
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	pc.now = func() time.Time { return now }
	pc.SetPresence(fakePresence{at: now.Add(-10 * time.Second), ok: true})

	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-push-1", true); err != nil {
		t.Fatal(err)
	}
	ev := f.lastEvent(t, "chat.voice.invite_received")
	if p := payloadOf(t, ev); p["user_id"] != f.member.ID || p["room_id"] != dm.ID || p["call_id"] != "call-push-1" || len(p) != 3 {
		t.Fatalf("payload = %v, want ids of the callee, the room and the call", p)
	}
	if !ev.ActorID.Valid || ev.ActorID.String != f.owner.ID {
		t.Fatalf("actor = %+v, want the caller", ev.ActorID)
	}
	if err := f.consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	inbox := f.inbox(t, f.member.ID)
	if len(inbox) != 1 || inbox[0].Kind != KindChatCallIncoming || inbox[0].GroupKey != "chat_call:"+dm.ID ||
		inbox[0].ResourceType != "chat_room" || inbox[0].ResourceID != dm.ID {
		t.Fatalf("callee inbox = %+v", inbox)
	}
	if got := f.inbox(t, f.owner.ID); len(got) != 0 {
		t.Fatalf("the caller was notified of their own call: %+v", got)
	}
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	want := PushMessage{
		Title: "Chủ Nhóm đang gọi",
		URL:   "http://app.test/notif-org/notif-ws/chat?room=" + dm.ID + "&call=call-push-1",
		Tag:   "chat_call:" + dm.ID,
		TTL:   60,
	}
	if len(spy.sent) != 1 || spy.sent[0] != want || spy.endpoints[0] != "ExponentPushToken[member]" {
		t.Fatalf("sent = %+v to %v, want %+v to the phone only", spy.sent, spy.endpoints, want)
	}
	if n := f.notificationOf(t, f.lastEvent(t, TopicPush)); !n.PushedAt.Valid {
		t.Fatalf("a call push the browser did not get left the row pending: %+v", n)
	}

	// Answered on another device before the notify lane ran: nothing more.
	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-push-2", false); err != nil {
		t.Fatal(err)
	}
	answered := f.lastEvent(t, "chat.voice.invite_received")
	if err := chat.SignalVoiceAccept(f.ctx, f.member.ID, f.wsID, dm.ID, "call-push-2"); err != nil {
		t.Fatal(err)
	}
	if err := f.consumer.Handle(f.ctx, answered); err != nil {
		t.Fatal(err)
	}
	for _, n := range f.inbox(t, f.member.ID) {
		if !n.ReadAt.Valid {
			t.Fatalf("an answered call left an open row: %+v", n)
		}
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-push-2"); err != nil {
		t.Fatal(err)
	}

	// The caller hangs up after the row was written but before the push lane ran.
	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-push-3", false); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.voice.invite_received")
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-push-3"); err != nil {
		t.Fatal(err)
	}
	ended := f.lastEvent(t, TopicPush)
	if err := pc.Handle(f.ctx, ended); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 {
		t.Fatalf("a call that ended was pushed: %+v", spy.sent)
	}
	if n := f.notificationOf(t, ended); !n.ReadAt.Valid {
		t.Fatalf("hangup did not close the ring row: %+v", n)
	}

	// A row the notify lane reaches after the ring window gets nothing.
	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-push-4", false); err != nil {
		t.Fatal(err)
	}
	late := f.lastEvent(t, "chat.voice.invite_received")
	late.CreatedAt = pgtype.Timestamptz{Time: time.Now().Add(-2 * time.Minute), Valid: true}
	before := len(f.events(t, TopicPush))
	if err := f.consumer.Handle(f.ctx, late); err != nil {
		t.Fatal(err)
	}
	if got := len(f.events(t, TopicPush)); got != before {
		t.Fatalf("a late ring queued a push (%d → %d)", before, got)
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-push-4"); err != nil {
		t.Fatal(err)
	}

	// Answered after the rule wrote the row but before the push lane ran (a
	// consumer without the ring check stands in for that race): no push, row closed.
	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-push-race", false); err != nil {
		t.Fatal(err)
	}
	race := f.lastEvent(t, "chat.voice.invite_received")
	if err := chat.SignalVoiceAccept(f.ctx, f.member.ID, f.wsID, dm.ID, "call-push-race"); err != nil {
		t.Fatal(err)
	}
	if err := NewConsumer(f.pool, f.q, f.ws).Handle(f.ctx, race); err != nil {
		t.Fatal(err)
	}
	pc.SetCallRinging(chat)
	raced := f.lastEvent(t, TopicPush)
	if err := pc.Handle(f.ctx, raced); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 || !f.notificationOf(t, raced).ReadAt.Valid {
		t.Fatalf("a ring answered before the push lane was pushed or left open: %+v", spy.sent)
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-push-race"); err != nil {
		t.Fatal(err)
	}

	// A push lane that falls behind the ring window drops the push too.
	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-push-5", false); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.voice.invite_received")
	pc.now = func() time.Time { return time.Now().Add(2 * time.Minute) }
	behind := f.lastEvent(t, TopicPush)
	if err := pc.Handle(f.ctx, behind); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 || !f.notificationOf(t, behind).ReadAt.Valid {
		t.Fatalf("a ring past its window was pushed or left open: %+v", spy.sent)
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-push-5"); err != nil {
		t.Fatal(err)
	}
}

// A phone whose device session was revoked (UNI-1838) does not ring: the
// call push reads the same live subscriptions as every other push.
func TestCallPushSkipsAPhoneWhoseDeviceWasRevoked(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	f.consumer.SetCallRinging(chat)
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	for endpoint, family := range map[string]string{"ExponentPushToken[lost]": "family-lost", "ExponentPushToken[kept]": "family-kept"} {
		if _, err := f.q.UpsertPushSubscription(f.ctx, db.UpsertPushSubscriptionParams{
			ID: util.NewID(), UserID: f.member.ID, Endpoint: endpoint, SessionID: pgtype.Text{String: family, Valid: true},
		}); err != nil {
			t.Fatal(err)
		}
	}
	// What revoking the lost phone's device session runs (service.revokeDesktopFamily).
	if err := f.q.RevokePushSubscriptionsForSession(f.ctx, db.RevokePushSubscriptionsForSessionParams{UserID: f.member.ID, SessionID: pgtype.Text{String: "family-lost", Valid: true}}); err != nil {
		t.Fatal(err)
	}
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	pc.SetCallRinging(chat)
	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-revoked", true); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.voice.invite_received")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.endpoints) != 1 || spy.endpoints[0] != "ExponentPushToken[kept]" {
		t.Fatalf("call pushed to %v, want the phone that is still signed in only", spy.endpoints)
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-revoked"); err != nil {
		t.Fatal(err)
	}
}

// Only a call skips the browser: a chat message still reaches every subscription.
func TestChatMessagePushStillReachesBrowserAndPhone(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribe(t, f.member.ID, "ExponentPushToken[member]")
	f.subscribe(t, f.member.ID, "https://push.example/member-browser")
	if _, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: "chào"}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.dm.received")
	spy := &spySender{}
	if err := NewPushConsumer(f.q, spy, "http://app.test").Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.endpoints) != 2 {
		t.Fatalf("DM push went to %v, want the phone and the browser", spy.endpoints)
	}
}

// A group call rings every other member, never the caller, and someone who
// already joined the call is not rung again.
func TestGroupCallInviteRingsMembersNotInTheCall(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	f.consumer.SetCallRinging(chat)
	third := f.register(t, service.NewAuthService(f.pool, f.q, authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil), "third@example.com", "Người Ba")
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: third.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: third.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	group, err := chat.CreateGroup(f.ctx, f.owner.ID, f.wsID, service.CreateGroupInput{Name: "Đội gọi", MemberUserIDs: []string{f.member.ID, third.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, group.ID, "group-call-1", false); err != nil {
		t.Fatal(err)
	}
	rung := map[string]outbox.Row{}
	for _, ev := range f.events(t, "chat.voice.invite_received") {
		rung[payloadOf(t, ev)["user_id"]] = ev
	}
	if len(rung) != 2 || rung[f.member.ID].ID == "" || rung[third.ID].ID == "" {
		t.Fatalf("group invite rows for %v, want the two other members", rung)
	}
	if err := chat.SignalVoiceAccept(f.ctx, f.member.ID, f.wsID, group.ID, "group-call-1"); err != nil {
		t.Fatal(err)
	}
	for _, ev := range rung {
		if err := f.consumer.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	if got := f.inbox(t, f.member.ID); len(got) != 0 {
		t.Fatalf("a member already in the call was rung: %+v", got)
	}
	if got := f.inbox(t, third.ID); len(got) != 1 || got[0].Kind != KindChatCallIncoming {
		t.Fatalf("the member not in the call was not rung: %+v", got)
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, group.ID, "group-call-1"); err != nil {
		t.Fatal(err)
	}
}
