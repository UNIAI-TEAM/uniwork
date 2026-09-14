package notification

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Role change and meeting invitation reach the person they are about; the
// consumer's Name/Topics are what the dispatcher registers.
func TestRulesMembershipAndMeeting(t *testing.T) {
	f := newFixture(t)
	if len(f.consumer.Topics()) != len(rules) || f.consumer.Name() != "notification" {
		t.Fatal("consumer identity")
	}
	if _, err := f.ws.UpdateMemberRole(f.ctx, f.owner.ID, f.wsID, f.member.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "member.role_changed")
	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindRoleChanged || !contains(got[0].Params, `"role":"admin"`) {
		t.Fatalf("role change inbox = %+v", got)
	}

	m, err := f.meetings.Create(f.ctx, f.owner.ID, f.wsID, service.CreateMeetingInput{
		Title: "Họp tuần", StartsAt: time.Now().Add(time.Hour), EndsAt: time.Now().Add(2 * time.Hour), Timezone: "UTC",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.meetings.Invite(f.ctx, f.owner.ID, m.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "participant.invited")
	got = f.inbox(t, f.member.ID)
	if len(got) != 2 || got[0].Kind != KindMeetingInvited || got[0].ResourceID != m.ID {
		t.Fatalf("meeting invite inbox = %+v", got)
	}

	// audit.exported and member.joined are consumed from rows shaped like
	// the producers write them.
	ev := db.OutboxEvent{ID: "ev-export", Topic: "audit.exported",
		Payload:   `{"export_id":"exp1","organization_id":"` + f.orgID + `","user_id":"` + f.member.ID + `"}`,
		ActorKind: pgtype.Text{String: "system", Valid: true}, ActorID: pgtype.Text{String: "audit-export", Valid: true}}
	if err := f.consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	if got = f.inbox(t, f.member.ID); len(got) != 3 || got[0].Kind != KindAuditExportReady || got[0].WorkspaceID.Valid {
		t.Fatalf("export inbox = %+v", got)
	}
	join := db.OutboxEvent{ID: "ev-join", Topic: "member.joined",
		Payload:   `{"organization_id":"` + f.orgID + `","workspace_id":"` + f.wsID + `","user_id":"` + f.member.ID + `"}`,
		ActorKind: pgtype.Text{String: "human", Valid: true}, ActorID: pgtype.Text{String: f.owner.ID, Valid: true}}
	if err := f.consumer.Handle(f.ctx, join); err != nil {
		t.Fatal(err)
	}
	if got = f.inbox(t, f.member.ID); len(got) != 4 || got[0].Kind != KindMemberAdded {
		t.Fatalf("member added inbox = %+v", got)
	}
	// Unknown topic and an organization-level join are no-ops.
	if err := f.consumer.Handle(f.ctx, db.OutboxEvent{ID: "x", Topic: "nothing"}); err != nil {
		t.Fatal(err)
	}
	if err := f.consumer.Handle(f.ctx, db.OutboxEvent{ID: "y", Topic: "member.joined", Payload: `{"user_id":"u"}`}); err != nil {
		t.Fatal(err)
	}
	if len(f.inbox(t, f.member.ID)) != 4 {
		t.Fatal("no-op topics created rows")
	}
	if len(f.events(t, TopicPush)) != 0 { // none of these kinds push by default
		t.Fatalf("push events = %d", len(f.events(t, TopicPush)))
	}
}

// WebPushSender maps the push service's answer: 201 sent, 410 gone, 5xx error.
func TestWebPushSenderStatusMapping(t *testing.T) {
	var status int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" || r.Header.Get("Content-Encoding") != "aes128gcm" {
			t.Errorf("missing VAPID or encryption headers: %v", r.Header)
		}
		w.WriteHeader(status)
	}))
	defer srv.Close()
	// Real keys on both ends: webpush-go encrypts for the browser's P-256 key.
	browser, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	sub := db.PushSubscription{
		Endpoint: srv.URL,
		P256dh:   base64.RawURLEncoding.EncodeToString(browser.PublicKey().Bytes()),
		Auth:     base64.RawURLEncoding.EncodeToString(auth),
	}
	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	sender := WebPushSender{PublicKey: pub, PrivateKey: priv, Subject: "mailto:ops@example.com"}
	for _, tc := range []struct {
		status int
		gone   bool
		err    bool
	}{{201, false, false}, {410, true, false}, {404, true, false}, {500, false, true}} {
		status = tc.status
		err := sender.Send(t.Context(), sub, PushMessage{Title: "x", URL: "/", Tag: "t"})
		switch {
		case tc.gone && err != ErrSubscriptionGone:
			t.Fatalf("%d: want gone, got %v", tc.status, err)
		case tc.err && (err == nil || err == ErrSubscriptionGone):
			t.Fatalf("%d: want error, got %v", tc.status, err)
		case !tc.gone && !tc.err && err != nil:
			t.Fatalf("%d: want nil, got %v", tc.status, err)
		}
	}
	if err := (LogPushSender{}).Send(t.Context(), sub, PushMessage{}); err != nil {
		t.Fatal(err)
	}
}

func TestPushConsumerIdentityAndOff(t *testing.T) {
	pc := NewPushConsumer(nil, nil, "http://app")
	if pc.Name() != "notification-push" || pc.Topics()[0] != TopicPush {
		t.Fatal("identity")
	}
	if err := pc.Handle(t.Context(), db.OutboxEvent{Payload: "{}"}); err != nil {
		t.Fatal("push off must acknowledge rows")
	}
}

func TestRuleChatFollowUpCreated(t *testing.T) {
	f := newFixture(t)
	payload := `{"follow_up_id":"fu1","workspace_id":"` + f.wsID + `","user_id":"` + f.owner.ID + `","message_id":"msg1","room_id":"room1"}`
	ev := db.OutboxEvent{
		ID: "ev-fu", Topic: "chat.follow_up.created", Payload: payload,
		ActorKind: pgtype.Text{String: "human", Valid: true},
		ActorID:   pgtype.Text{String: f.owner.ID, Valid: true},
	}
	if err := f.consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	got := f.inbox(t, f.owner.ID)
	if len(got) != 1 || got[0].Kind != KindChatFollowUp || got[0].ResourceID != "msg1" {
		t.Fatalf("follow-up inbox = %+v", got)
	}
	if got[0].GroupKey != "chat_follow_up:fu1" || got[0].WorkspaceID.String != f.wsID {
		t.Fatalf("follow-up attribution = %+v", got[0])
	}
	// Incomplete payload is a no-op.
	if err := f.consumer.Handle(f.ctx, db.OutboxEvent{
		ID: "ev-fu-empty", Topic: "chat.follow_up.created", Payload: `{"user_id":"x"}`,
	}); err != nil {
		t.Fatal(err)
	}
	if len(f.inbox(t, f.owner.ID)) != 1 {
		t.Fatal("incomplete payload created a row")
	}
}
