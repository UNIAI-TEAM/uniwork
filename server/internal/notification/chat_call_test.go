package notification

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
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
	rung := f.notificationOf(t, f.lastEvent(t, TopicPush))
	var rungParams map[string]string
	if err := json.Unmarshal([]byte(rung.Params), &rungParams); err != nil {
		t.Fatal(err)
	}
	// The phone's own ringing screen gets the call's ids, who calls, the kind
	// of call and when the ring ends (ADR draft 0038).
	want := PushMessage{
		Title:   "Chủ Nhóm đang gọi",
		URL:     "http://app.test/notif-org/notif-ws/chat?room=" + dm.ID + "&call=call-push-1",
		Tag:     "chat_call:" + dm.ID,
		TTL:     60,
		Channel: ChannelCalls,
		Call: CallPush{
			Type: CallPushInvite, CallID: "call-push-1", RoomID: dm.ID, WorkspaceID: f.wsID,
			CallerName: "Chủ Nhóm", RoomName: rungParams["room"], CallKind: "dm", Video: true,
			ExpiresAt: rung.CreatedAt.Time.Add(callRingWindow).UnixMilli(),
		},
	}
	if len(spy.sent) != 1 || spy.sent[0] != want || spy.endpoints[0] != "ExponentPushToken[member]" {
		t.Fatalf("sent = %+v to %v, want %+v to the phone only", spy.sent, spy.endpoints, want)
	}
	if rungParams["call_kind"] != "dm" || rungParams["video"] != "1" {
		t.Fatalf("ring params = %v, want the call's kind and camera", rungParams)
	}
	if !rung.PushedAt.Valid {
		t.Fatalf("a call push the browser did not get left the row pending: %+v", rung)
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

// The UniChat mobile calls kill switch (UNI-2053) stops the call push itself:
// with FF_UNICHAT_MOBILE_CALLS=false no phone rings for a feature its own
// config has turned off. The row is marked pushed, not retried, and stays in
// the inbox; a chat message still pushes.
func TestCallPushStopsWhenTheMobileCallsSwitchIsOff(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	f.consumer.SetCallRinging(chat)
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribe(t, f.member.ID, "ExponentPushToken[member]")
	t.Setenv("FF_UNICHAT_MOBILE_CALLS", "false")
	flags, err := featureflag.NewServiceFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	var asked [][2]string
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	pc.SetCallRinging(chat)
	check := featureflags.ForPerson(flags, "unichat_mobile_calls")
	pc.SetMobileCalls(func(ctx context.Context, userID, organizationID string) bool {
		asked = append(asked, [2]string{userID, organizationID})
		return check(ctx, userID, organizationID)
	})
	m := &countingMetrics{suppressed: map[string]int{}, sent: map[string]int{}}
	pc.SetMetrics(m)

	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-switch-off", true); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.voice.invite_received")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 0 {
		t.Fatalf("a call pushed %+v to %v with the switch off", spy.sent, spy.endpoints)
	}
	if len(asked) != 1 || asked[0] != [2]string{f.member.ID, f.orgID} {
		t.Fatalf("switch evaluated for %v, want the callee in the call's organization", asked)
	}
	if n := f.notificationOf(t, f.lastEvent(t, TopicPush)); !n.PushedAt.Valid || n.ReadAt.Valid {
		t.Fatalf("row = %+v, want marked pushed (no retry) and still unread in the inbox", n)
	}
	if m.suppressed[KindChatCallIncoming] != 1 {
		t.Fatalf("suppressed = %v, want the call counted once", m.suppressed)
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-switch-off"); err != nil {
		t.Fatal(err)
	}

	// Back on: the next call rings the phone again.
	t.Setenv("FF_UNICHAT_MOBILE_CALLS", "true")
	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-switch-on", true); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.voice.invite_received")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.endpoints) != 1 || spy.endpoints[0] != "ExponentPushToken[member]" {
		t.Fatalf("switch back on: pushed to %v, want the phone", spy.endpoints)
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-switch-on"); err != nil {
		t.Fatal(err)
	}
}

// Calls on an iPhone wait for CallKit (unichat_mobile_calls_ios, off by
// default): with that switch off a call rings the person's Android phones and
// skips their iPhones, which could only play one short sound and keep a stale
// "X đang gọi" banner; on, the iPhone gets its visible push again.
func TestCallPushSkipsIPhonesWhileTheIOSSwitchIsOff(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribeAs(t, f.member.ID, "ExponentPushToken[android]", "expo/android; call-ui")
	f.subscribeAs(t, f.member.ID, "ExponentPushToken[iphone]", "expo/ios")
	iosOn := false
	var asked [][2]string
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	pc.SetCallRinging(chat)
	pc.SetMobileCallsIOS(func(_ context.Context, userID, organizationID string) bool {
		asked = append(asked, [2]string{userID, organizationID})
		return iosOn
	})
	ring := func(callID string) []string {
		spy.sent, spy.endpoints = nil, nil
		if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, callID, false); err != nil {
			t.Fatal(err)
		}
		f.handleLast(t, "chat.voice.invite_received")
		if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
			t.Fatal(err)
		}
		if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, callID); err != nil {
			t.Fatal(err)
		}
		return spy.endpoints
	}

	if got := ring("call-ios-off"); len(got) != 1 || got[0] != "ExponentPushToken[android]" {
		t.Fatalf("iOS switch off: rang %v, want the Android phone only", got)
	}
	if len(asked) != 1 || asked[0] != [2]string{f.member.ID, f.orgID} {
		t.Fatalf("iOS switch evaluated for %v, want the callee in the call's organization", asked)
	}
	iosOn = true
	if got := ring("call-ios-on"); len(got) != 2 {
		t.Fatalf("iOS switch on: rang %v, want both phones", got)
	}
}

// A chat push carries the person's unread count to their iPhones (the icon is
// right while the app is closed); with no iPhone the count is not even read,
// and a count that cannot be read sends the push without one.
func TestChatPushCarriesTheBadgeToIPhones(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribeAs(t, f.member.ID, "ExponentPushToken[android]", "expo/android; call-ui")
	badges := &fakeBadges{count: 4}
	run := func() *spySender {
		f.readAll(t, f.member.ID)
		if _, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: "x"}); err != nil {
			t.Fatal(err)
		}
		f.handleLast(t, "chat.dm.received")
		spy := &spySender{}
		pc := NewPushConsumer(f.q, spy, "http://app.test")
		pc.SetBadges(badges)
		if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
			t.Fatal(err)
		}
		return spy
	}
	if spy := run(); len(spy.sent) != 1 || spy.sent[0].Badge != nil || len(badges.asked) != 0 {
		t.Fatalf("Android only: sent %+v, asked %v; want no count read", spy.sent, badges.asked)
	}
	f.subscribeAs(t, f.member.ID, "ExponentPushToken[iphone]", "expo/ios")
	spy := run()
	if len(spy.sent) != 2 || spy.sent[0].Badge == nil || *spy.sent[0].Badge != 4 || len(badges.asked) != 1 || badges.asked[0] != f.member.ID {
		t.Fatalf("with an iPhone: sent %+v, asked %v; want the recipient's count 4", spy.sent, badges.asked)
	}
	badges.err = errors.New("db slow")
	if spy := run(); len(spy.sent) != 2 || spy.sent[0].Badge != nil {
		t.Fatalf("unreadable count: sent %+v, want the push without a badge", spy.sent)
	}
}

type fakeBadges struct {
	count int
	err   error
	asked []string
}

func (b *fakeBadges) UnreadBadge(_ context.Context, userID string) (int, error) {
	b.asked = append(b.asked, userID)
	return b.count, b.err
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

func (f *fixture) subscribeAs(t *testing.T, userID, endpoint, userAgent string) {
	t.Helper()
	if _, err := f.q.UpsertPushSubscription(f.ctx, db.UpsertPushSubscriptionParams{
		ID: util.NewID(), UserID: userID, Endpoint: endpoint, UserAgent: pgtype.Text{String: userAgent, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
}

// A call that stops ringing for someone (they answered on one device, or the
// caller hung up) tells their Android phones, so a ringing screen on a locked
// phone comes down at once instead of ringing out its window. Only Android
// gets it: an iPhone cannot act on a data-only push, and a browser rings in
// the page. With the calls switch off for the person nothing is sent.
func TestCallRingClosedStopsTheAndroidPhones(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	f.consumer.SetCallRinging(chat)
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribeAs(t, f.member.ID, "ExponentPushToken[android]", "expo/android; call-ui")
	f.subscribeAs(t, f.member.ID, "ExponentPushToken[android-0.2]", "expo/android")
	f.subscribeAs(t, f.member.ID, "ExponentPushToken[iphone]", "expo/ios")
	f.subscribe(t, f.member.ID, "https://push.example/member-browser")
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")

	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-closed-1", false); err != nil {
		t.Fatal(err)
	}
	if err := chat.SignalVoiceAccept(f.ctx, f.member.ID, f.wsID, dm.ID, "call-closed-1"); err != nil {
		t.Fatal(err)
	}
	answered := f.lastEvent(t, TopicCallRingClosed)
	if p := payloadOf(t, answered); p["user_id"] != f.member.ID || p["room_id"] != dm.ID || p["call_id"] != "call-closed-1" || len(p) != 3 {
		t.Fatalf("ring_closed payload = %v, want the ids of the callee, the room and the call", p)
	}
	if !answered.ActorID.Valid || answered.ActorID.String != f.member.ID || answered.OrganizationID.String != f.orgID {
		t.Fatalf("ring_closed actor/org = %+v/%+v, want the callee who answered in the call's organization", answered.ActorID, answered.OrganizationID)
	}
	if err := pc.Handle(f.ctx, answered); err != nil {
		t.Fatal(err)
	}
	want := PushMessage{TTL: 60, Call: CallPush{Type: CallPushEnd, CallID: "call-closed-1", RoomID: dm.ID, WorkspaceID: answered.WorkspaceID.String}}
	if len(spy.sent) != 1 || spy.sent[0] != want || spy.endpoints[0] != "ExponentPushToken[android]" {
		t.Fatalf("ring end sent %+v to %v, want %+v to the Android phone with the call UI only", spy.sent, spy.endpoints, want)
	}

	// The caller hangs up: the call's end closes the ring for every invitee.
	before := len(f.events(t, TopicCallRingClosed))
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-closed-1"); err != nil {
		t.Fatal(err)
	}
	ended := f.events(t, TopicCallRingClosed)
	if len(ended) != before+1 || payloadOf(t, ended[len(ended)-1])["user_id"] != f.member.ID || ended[len(ended)-1].ActorID.String != f.owner.ID {
		t.Fatalf("hangup ring_closed rows = %d (was %d), want one more for the callee by the caller", len(ended), before)
	}

	// The switch off for the callee: their phone was never rung, nothing is sent.
	pc.SetMobileCalls(func(context.Context, string, string) bool { return false })
	if err := pc.Handle(f.ctx, ended[len(ended)-1]); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 {
		t.Fatalf("a closed ring was pushed with the calls switch off: %+v", spy.sent)
	}
}

// A DM call nobody answered reaches the callee's phones as a missed call on
// its own channel, naming the call, not as "X đã nhắn tin cho bạn" over an
// empty preview.
func TestUnansweredDMCallPushesAMissedCall(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	f.consumer.SetCallRinging(chat)
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribeAs(t, f.member.ID, "ExponentPushToken[android]", "expo/android")
	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-missed-1", true); err != nil {
		t.Fatal(err)
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-missed-1"); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.dm.received")
	spy := &spySender{}
	if err := NewPushConsumer(f.q, spy, "http://app.test").Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 {
		t.Fatalf("missed call pushes = %+v", spy.sent)
	}
	got := spy.sent[0]
	if got.Title != "Cuộc gọi video nhỡ từ Chủ Nhóm" || got.Body != "" || got.Channel != ChannelMissedCalls ||
		got.Call.Type != CallPushMissed || got.Call.CallID != "call-missed-1" || got.Call.RoomID != dm.ID || got.Call.WorkspaceID != f.wsID {
		t.Fatalf("missed call push = %+v", got)
	}
}
