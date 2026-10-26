package notification

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/outbox"
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
	voipToken   = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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

// voipCalls rings dm's member from its owner and hands every push to pc, the
// way the lanes do: the ring row, then its push.
type voipCalls struct {
	f    *fixture
	chat *service.ChatService
	pc   *PushConsumer
	spy  *routeSpy
	dmID string
}

func (v voipCalls) ring(t *testing.T, callID string) {
	t.Helper()
	if err := v.chat.SignalVoiceInvite(v.f.ctx, v.f.owner.ID, v.f.wsID, v.dmID, callID, false); err != nil {
		t.Fatal(err)
	}
	v.f.handleLast(t, "chat.voice.invite_received")
	if err := v.pc.Handle(v.f.ctx, v.f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	v.spy.sent, v.spy.endpoints = nil, nil
}

// closed hands the last ring_closed row to the push lane and returns it.
func (v voipCalls) closed(t *testing.T) outbox.Row {
	t.Helper()
	row := v.f.lastEvent(t, TopicCallRingClosed)
	v.spy.sent, v.spy.endpoints = nil, nil
	if err := v.pc.Handle(v.f.ctx, row); err != nil {
		t.Fatal(err)
	}
	return row
}

func newVoIPCalls(t *testing.T) voipCalls {
	t.Helper()
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	f.consumer.SetCallRinging(chat)
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribeFrom(t, f.member.ID, androidExpo, "expo/android; call-ui", "family-android")
	f.subscribeFrom(t, f.member.ID, iphoneExpo, "expo/ios", "family-iphone")
	f.subscribeVoIP(t, f.member.ID, voipToken, "family-iphone")
	f.subscribeVoIP(t, f.member.ID, voipToken2, "family-ipad")
	spy := &routeSpy{errs: map[string]error{}}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	pc.SetCallRinging(chat)
	pc.SetMobileCallsIOS(func(context.Context, string, string) bool { return true })
	return voipCalls{f: f, chat: chat, pc: pc, spy: spy, dmID: dm.ID}
}

const voipToken2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

// When the ring stops for someone, the PushKit tokens the ring reached get the
// end as a VoIP push, saying why, so their CallKit screens come down; the
// Android phones get theirs as before. The device that answered or declined
// is not told: iOS makes the app report a call for every VoIP push, and an end
// there would hang up the call just answered or show a declined one again. The
// end goes once: a retry of the row, or the ring_closed the call's own end
// writes, sends no second one.
func TestCallRingClosedEndsTheCallKitRing(t *testing.T) {
	v := newVoIPCalls(t)
	f, chat := v.f, v.chat
	onIPhone := service.WithDeviceSession(f.ctx, "family-iphone")

	v.ring(t, "call-answer")
	if err := chat.SignalVoiceAccept(onIPhone, f.member.ID, f.wsID, v.dmID, "call-answer"); err != nil {
		t.Fatal(err)
	}
	answered := v.closed(t)
	if p := payloadOf(t, answered); p["session_id"] != "family-iphone" || p["reason"] != service.RingClosedAnswered {
		t.Fatalf("ring_closed payload = %v, want the answering session and reason answered", p)
	}
	if _, ok := v.spy.to(voipToken); ok {
		t.Fatalf("the iPhone that answered was told to end its call: %v", v.spy.endpoints)
	}
	end, ok := v.spy.to(voipToken2)
	if !ok || end.Call.Type != CallPushEnd || end.Call.CallID != "call-answer" || end.Call.RoomID != v.dmID ||
		end.Call.WorkspaceID != f.wsID || end.Call.OrgSlug != "notif-org" || end.Call.WorkspaceSlug != "notif-ws" ||
		end.Call.EndReason != service.RingClosedAnswered || end.TTL != callEndTTL {
		t.Fatalf("VoIP end = %+v (sent: %v), want the call's ids, slugs and reason answered", end, ok)
	}
	if android, ok := v.spy.to(androidExpo); !ok || android.Call.OrgSlug != "" || android.Call.EndReason != "" || len(v.spy.endpoints) != 2 {
		t.Fatalf("ring end sent to %v (Android %+v), want the iPad's PushKit token and the Android phone as before", v.spy.endpoints, android.Call)
	}
	v.spy.sent, v.spy.endpoints = nil, nil
	if err := v.pc.Handle(f.ctx, answered); err != nil {
		t.Fatal(err)
	}
	if len(v.spy.endpoints) != 1 || v.spy.endpoints[0] != androidExpo {
		t.Fatalf("a retried ring_closed row sent %v, want the Android phone only: the iPad's ring already ended", v.spy.endpoints)
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, v.dmID, "call-answer"); err != nil {
		t.Fatal(err)
	}
	v.closed(t)
	if len(v.spy.endpoints) != 1 || v.spy.endpoints[0] != androidExpo {
		t.Fatalf("the call's end sent %v, want the Android phone only: the iPad's ring already ended", v.spy.endpoints)
	}

	// Declined on the iPhone (in a DM that is the hangup): the iPad hears it
	// was declined elsewhere, the iPhone nothing.
	v.ring(t, "call-decline")
	if err := chat.SignalVoiceDecline(onIPhone, f.member.ID, f.wsID, v.dmID, "call-decline"); err != nil {
		t.Fatal(err)
	}
	v.closed(t)
	if _, ok := v.spy.to(voipToken); ok {
		t.Fatalf("the iPhone that declined was told to end the call: %v", v.spy.endpoints)
	}
	if end, ok := v.spy.to(voipToken2); !ok || end.Call.EndReason != service.RingClosedDeclined {
		t.Fatalf("iPad end = %+v (sent: %v), want reason declined", end.Call, ok)
	}

	// The caller hangs up before anyone answers: every iPhone the ring reached
	// hears it ended.
	v.ring(t, "call-ended")
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, v.dmID, "call-ended"); err != nil {
		t.Fatal(err)
	}
	v.closed(t)
	for _, token := range []string{voipToken, voipToken2} {
		if end, ok := v.spy.to(token); !ok || end.Call.EndReason != service.RingClosedEnded {
			t.Fatalf("end to %s… = %+v (sent: %v), want reason ended", token[:6], end.Call, ok)
		}
	}

	// The iOS switch off: nothing goes to a PushKit token.
	v.ring(t, "call-switch")
	v.pc.SetMobileCallsIOS(func(context.Context, string, string) bool { return false })
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, v.dmID, "call-switch"); err != nil {
		t.Fatal(err)
	}
	v.closed(t)
	if len(v.spy.endpoints) != 1 || v.spy.endpoints[0] != androidExpo {
		t.Fatalf("iOS switch off: ring end sent to %v, want the Android phone only", v.spy.endpoints)
	}
}

// An end goes only where a ring went and only while it rings: an invite the
// lane dropped (answered on a computer before it went out) rang no PushKit
// token, and a ring that ran out its window has nothing left on the phone, so
// the call's end half an hour later sends no VoIP push — each would be a
// CallKit call shown and ended at once. A failing PushKit end does not retry
// the row either: the retry would end every other phone again, and the phone
// stops ringing at the end of its window anyway.
func TestCallRingClosedSendsNoVoIPEndWhereNoRingIs(t *testing.T) {
	v := newVoIPCalls(t)
	f, chat := v.f, v.chat

	if err := chat.SignalVoiceInvite(f.ctx, f.owner.ID, f.wsID, v.dmID, "call-dropped", false); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.voice.invite_received")
	push := f.lastEvent(t, TopicPush)
	if err := chat.SignalVoiceAccept(service.WithDeviceSession(f.ctx, "family-web"), f.member.ID, f.wsID, v.dmID, "call-dropped"); err != nil {
		t.Fatal(err)
	}
	if err := v.pc.Handle(f.ctx, push); err != nil {
		t.Fatal(err)
	}
	if len(v.spy.endpoints) != 0 {
		t.Fatalf("an answered ring was pushed to %v", v.spy.endpoints)
	}
	v.closed(t)
	if len(v.spy.endpoints) != 1 || v.spy.endpoints[0] != androidExpo {
		t.Fatalf("a ring that never reached an iPhone ended %v, want the Android phone only", v.spy.endpoints)
	}
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, v.dmID, "call-dropped"); err != nil {
		t.Fatal(err)
	}

	v.ring(t, "call-long")
	v.pc.now = func() time.Time { return time.Now().Add(30 * time.Minute) }
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, v.dmID, "call-long"); err != nil {
		t.Fatal(err)
	}
	v.closed(t)
	if len(v.spy.endpoints) != 1 || v.spy.endpoints[0] != androidExpo {
		t.Fatalf("an end after the ring window went to %v, want the Android phone only", v.spy.endpoints)
	}
	v.pc.now = time.Now

	v.ring(t, "call-failing")
	v.spy.errs[voipToken] = errors.New("apns: 503 ServiceUnavailable")
	if err := chat.SignalVoiceHangup(f.ctx, f.owner.ID, f.wsID, v.dmID, "call-failing"); err != nil {
		t.Fatal(err)
	}
	if err := v.pc.Handle(f.ctx, f.lastEvent(t, TopicCallRingClosed)); err != nil {
		t.Fatalf("a failing PushKit end failed the row (%v): its retry would end every other phone again", err)
	}
	if _, ok := v.spy.to(voipToken2); !ok {
		t.Fatalf("the other PushKit token lost its end: %v", v.spy.endpoints)
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
