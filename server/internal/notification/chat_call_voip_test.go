package notification

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// routeSpy records every send and answers an endpoint with the error a test
// gives it (ErrPushSkipped for a VoIP sender without a key, ErrSubscriptionGone
// for a dead token).
type routeSpy struct {
	sent      []PushMessage
	endpoints []string
	errs      map[string]error
}

func (s *routeSpy) Send(_ context.Context, sub db.PushSubscription, m PushMessage) error {
	if err := s.errs[sub.Endpoint]; err != nil {
		return err
	}
	s.sent = append(s.sent, m)
	s.endpoints = append(s.endpoints, sub.Endpoint)
	return nil
}

func (s *routeSpy) to(endpoint string) (PushMessage, bool) {
	for i, ep := range s.endpoints {
		if ep == endpoint {
			return s.sent[i], true
		}
	}
	return PushMessage{}, false
}

func (f *fixture) subscribeFrom(t *testing.T, userID, endpoint, userAgent, session string) {
	t.Helper()
	if _, err := f.q.UpsertPushSubscription(f.ctx, db.UpsertPushSubscriptionParams{
		ID: util.NewID(), UserID: userID, Endpoint: endpoint,
		UserAgent: pgtype.Text{String: userAgent, Valid: true}, SessionID: pgtype.Text{String: session, Valid: session != ""},
	}); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) subscribeVoIP(t *testing.T, userID, token, session string) {
	t.Helper()
	if _, err := f.q.UpsertPushSubscription(f.ctx, db.UpsertPushSubscriptionParams{
		ID: util.NewID(), UserID: userID, Endpoint: token, SessionID: pgtype.Text{String: session, Valid: session != ""},
		Transport:       pgtype.Text{String: TransportAPNsVoIP, Valid: true},
		ApnsEnvironment: pgtype.Text{String: APNsProduction, Valid: true},
		ApnsBundleID:    pgtype.Text{String: "com.uniworkos.chat", Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
}

const (
	voipToken   = "aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff00112233"
	iphoneExpo  = "ExponentPushToken[iphone-new]"
	iphoneOld   = "ExponentPushToken[iphone-old]"
	androidExpo = "ExponentPushToken[android]"
)

// ADR 0038 › iOS: with unichat_mobile_calls_ios on, a ring reaches an iPhone
// that registered a PushKit token as a VoIP push (CallKit), not as the Expo
// "X đang gọi" banner: the Expo token registered from the same device session
// is skipped. An iPhone without a PushKit token (an older build, another
// session) keeps today's visible push, Android keeps its data-only ring, and
// with the switch off no iPhone rings at all.
func TestCallInviteRingsAnIPhoneOverVoIP(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	f.consumer.SetCallRinging(chat) // the rule reads whether the call is video
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribeFrom(t, f.member.ID, androidExpo, "expo/android; call-ui", "family-android")
	f.subscribeFrom(t, f.member.ID, iphoneExpo, "expo/ios", "family-iphone")
	f.subscribeVoIP(t, f.member.ID, voipToken, "family-iphone")
	f.subscribeFrom(t, f.member.ID, iphoneOld, "expo/ios", "family-old-iphone")
	f.subscribe(t, f.member.ID, "https://push.example/member-browser")
	iosOn := true
	spy := &routeSpy{errs: map[string]error{}}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	pc.SetCallRinging(chat)
	pc.SetMobileCallsIOS(func(context.Context, string, string) bool { return iosOn })
	ring := func(callID string) {
		t.Helper()
		spy.sent, spy.endpoints = nil, nil
		if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, callID, true); err != nil {
			t.Fatal(err)
		}
		f.handleLast(t, "chat.voice.invite_received")
		if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
			t.Fatal(err)
		}
		if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, callID); err != nil {
			t.Fatal(err)
		}
	}

	ring("call-voip-1")
	if len(spy.endpoints) != 3 {
		t.Fatalf("rang %v, want the Android phone, the PushKit token and the older iPhone", spy.endpoints)
	}
	voip, ok := spy.to(voipToken)
	if !ok {
		t.Fatalf("the PushKit token was not rung: %v", spy.endpoints)
	}
	c := voip.Call
	if c.Type != CallPushInvite || c.CallID != "call-voip-1" || c.RoomID != dm.ID || c.WorkspaceID != f.wsID ||
		c.OrgSlug != "notif-org" || c.WorkspaceSlug != "notif-ws" || c.CallerName != "Chủ Nhóm" || !c.Video || c.ExpiresAt == 0 {
		t.Fatalf("VoIP ring = %+v, want the call's ids, slugs, caller, video and end", c)
	}
	if _, ok := spy.to(iphoneExpo); ok {
		t.Fatal("the iPhone with a PushKit token also got the Expo \"đang gọi\" banner")
	}
	if _, ok := spy.to(iphoneOld); !ok {
		t.Fatal("an iPhone without a PushKit token lost its visible ring")
	}

	// No APNs key on the server: the VoIP push is skipped and the same iPhone
	// keeps today's visible push.
	spy.errs[voipToken] = ErrPushSkipped
	ring("call-voip-2")
	if _, ok := spy.to(iphoneExpo); !ok || len(spy.endpoints) != 3 {
		t.Fatalf("VoIP off: rang %v, want the Expo iPhones back on the visible push", spy.endpoints)
	}
	// APNs failing (a 503, a refused key): the same fallback, and the row is
	// not retried, which would ring every other device again.
	spy.errs[voipToken] = errors.New("apns: 503 ServiceUnavailable")
	ring("call-voip-2b")
	if _, ok := spy.to(iphoneExpo); !ok || len(spy.endpoints) != 3 {
		t.Fatalf("VoIP failing: rang %v, want the Expo iPhones back on the visible push", spy.endpoints)
	}
	delete(spy.errs, voipToken)

	// The iOS switch off: neither the PushKit token nor any Expo iPhone rings.
	iosOn = false
	ring("call-voip-3")
	if len(spy.endpoints) != 1 || spy.endpoints[0] != androidExpo {
		t.Fatalf("iOS switch off: rang %v, want the Android phone only", spy.endpoints)
	}
}

// A dead PushKit token (APNs 410 Unregistered or 400 BadDeviceToken, which
// the sender turns into ErrSubscriptionGone) is revoked like any other.
func TestCallInviteRevokesADeadPushKitToken(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribeFrom(t, f.member.ID, iphoneExpo, "expo/ios", "family-iphone")
	f.subscribeVoIP(t, f.member.ID, voipToken, "family-iphone")
	spy := &routeSpy{errs: map[string]error{voipToken: ErrSubscriptionGone}}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	pc.SetCallRinging(chat)
	pc.SetMobileCallsIOS(func(context.Context, string, string) bool { return true })

	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-dead-token", false); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.voice.invite_received")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	subs, err := f.q.ListActivePushSubscriptions(f.ctx, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(subs) != 1 || subs[0].Endpoint != iphoneExpo {
		t.Fatalf("live subscriptions = %+v, want the dead PushKit token revoked", subs)
	}
	// The ring still reached that iPhone through its Expo token.
	if len(spy.endpoints) != 1 || spy.endpoints[0] != iphoneExpo {
		t.Fatalf("rang %v, want the iPhone's visible push in place of the dead VoIP token", spy.endpoints)
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-dead-token"); err != nil {
		t.Fatal(err)
	}
}

// When the ring stops for someone (answered elsewhere, declined, or ended),
// their iPhone's PushKit token gets the end as a VoIP push, so the CallKit
// screen comes down; the Android phones get theirs as before. With the iOS
// switch off nothing goes to the PushKit token.
func TestCallRingClosedEndsTheCallKitRing(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribeFrom(t, f.member.ID, androidExpo, "expo/android; call-ui", "family-android")
	f.subscribeFrom(t, f.member.ID, iphoneExpo, "expo/ios", "family-iphone")
	f.subscribeVoIP(t, f.member.ID, voipToken, "family-iphone")
	iosOn := true
	spy := &routeSpy{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	pc.SetMobileCallsIOS(func(context.Context, string, string) bool { return iosOn })

	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, dm.ID, "call-voip-end", false); err != nil {
		t.Fatal(err)
	}
	if err := chat.SignalVoiceDecline(f.ctx, f.member.ID, f.wsID, dm.ID, "call-voip-end"); err != nil {
		t.Fatal(err)
	}
	closed := f.lastEvent(t, TopicCallRingClosed)
	if err := pc.Handle(f.ctx, closed); err != nil {
		t.Fatal(err)
	}
	if len(spy.endpoints) != 2 {
		t.Fatalf("ring end sent to %v, want the Android phone and the PushKit token", spy.endpoints)
	}
	end, ok := spy.to(voipToken)
	if !ok || end.Call.Type != CallPushEnd || end.Call.CallID != "call-voip-end" || end.Call.RoomID != dm.ID ||
		end.Call.WorkspaceID != f.wsID || end.Call.OrgSlug != "notif-org" || end.Call.WorkspaceSlug != "notif-ws" || end.TTL != callEndTTL {
		t.Fatalf("VoIP end = %+v (sent: %v), want the call's ids and slugs", end, ok)
	}
	if android, _ := spy.to(androidExpo); android.Call.OrgSlug != "" {
		t.Fatalf("the Android end carries slugs it never reads: %+v", android.Call)
	}

	iosOn = false
	spy.sent, spy.endpoints = nil, nil
	if err := pc.Handle(f.ctx, closed); err != nil {
		t.Fatal(err)
	}
	if len(spy.endpoints) != 1 || spy.endpoints[0] != androidExpo {
		t.Fatalf("iOS switch off: ring end sent to %v, want the Android phone only", spy.endpoints)
	}
}

// A PushKit token takes call pushes only: a chat message never goes to it
// (iOS kills an app whose VoIP push does not ring CallKit).
func TestChatPushNeverReachesAPushKitToken(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribeFrom(t, f.member.ID, iphoneExpo, "expo/ios", "family-iphone")
	f.subscribeVoIP(t, f.member.ID, voipToken, "family-iphone")
	spy := &routeSpy{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	pc.SetMobileCallsIOS(func(context.Context, string, string) bool { return true })

	if _, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: "chào"}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.dm.received")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.endpoints) != 1 || spy.endpoints[0] != iphoneExpo {
		t.Fatalf("chat push went to %v, want the Expo token only", spy.endpoints)
	}
}
