package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// PushMessage is what a browser or the mobile app receives: the rendered
// title, a short body (chat only), where a click goes, and a tag so an older
// banner of the same group is replaced rather than stacked. No task
// description, nothing beyond the title and that short body.
type PushMessage struct {
	Title string `json:"title"`
	Body  string `json:"body,omitempty"`
	URL   string `json:"url"`
	Tag   string `json:"tag"`
	// TTL is how long, in seconds, the push service may hold the message for
	// an offline device; 0 means pushTTL. It travels as a header, not in the body.
	TTL int `json:"-"`
	// Channel is the Android notification channel the phone files the push
	// under (pushChannel): calls, missed calls, mentions, messages or the
	// rest. A browser has no channels and never sees it.
	Channel string `json:"-"`
	// Call is set on a ring, on the end of one and on a missed call: the
	// phone's own call UI needs the ids, not a banner. A browser never sees it.
	Call CallPush `json:"-"`
	// Chat is set on a chat message push (a DM, a mention, a thread reply):
	// the ids the phone's notification actions act on without opening the
	// app — Reply sends into the room or the thread, Mark as read reads the
	// room. A browser never sees it.
	Chat ChatPush `json:"-"`
	// Badge is the app icon's count the person's iPhones show with this push
	// (everything unread, as the app draws it); nil leaves the icon as it is.
	// Android launchers count the tray themselves. A browser never sees it.
	Badge *int `json:"-"`
	// Cleared is set when the person read a room on some device: their
	// Android phones take its message notifications out of the tray and set
	// the icon's count to Badge. A browser never sees it.
	Cleared RoomCleared `json:"-"`
	// Quiet is a chat message that follows one the phone alerted for less than
	// chatAlertWindow ago in the same room (or thread): it shows, grouped
	// with the room's, without a sound or a vibration. A browser replaces the
	// room's notification by its tag without renotifying anyway.
	Quiet bool `json:"-"`
}

// RoomCleared names the room a "read elsewhere" push is about. Ids only.
type RoomCleared struct {
	WorkspaceID string
	RoomID      string
}

// RoomReadPush is the type of the data-only push that clears a read room's
// notifications (apps/chat-mobile/lib/room-read-push.ts reads it).
const RoomReadPush = "room_read"

// ChatPush names the message a chat push is about. Ids only, as every
// client-visible payload (CLAUDE.md › Audit and Events).
type ChatPush struct {
	WorkspaceID  string
	RoomID       string
	MessageID    string
	ThreadRootID string
	// Unread is how many messages the room's open row holds when it is more
	// than this one, and Summary says it in the person's language ("3 tin
	// nhắn mới"): Android replaces the room's notification with each push, so
	// its title carries the count. Zero and "" for a single message.
	Unread  int
	Summary string
}

// The kinds of CallPush. An invite and an end reach Android as data-only,
// high-priority messages the app turns into its own call UI (ADR 0038); an
// iPhone with a PushKit token gets both as VoIP pushes for CallKit while
// unichat_mobile_calls_ios is on (push_apns.go), and one without keeps the
// visible invite and no end. A missed call is
// a visible push everywhere that also names the call, so the app can clear a
// ring the end push never cleared.
const (
	CallPushInvite = "call_invite"
	CallPushEnd    = "call_end"
	CallPushMissed = "call_missed"
)

// CallPush is what the phone's call UI needs: ids, the two names a ringing
// screen shows, and how long the ring may still last. Type "" means the push
// is not about a call.
type CallPush struct {
	Type        string
	CallID      string
	RoomID      string
	WorkspaceID string
	// OrgSlug and WorkspaceSlug are set only on a push to an iPhone's PushKit
	// token, whose app opens the call by its path (ADR 0038); Android reads the URL.
	OrgSlug       string
	WorkspaceSlug string
	CallerName    string
	RoomName      string
	// CallKind is the room's kind: dm, group or channel.
	CallKind string
	Video    bool
	// ExpiresAt is when the ring stops, in Unix milliseconds; the phone stops
	// ringing then even when no end push reaches it.
	ExpiresAt int64
}

// pushTTL is the default lifetime of a push: a reminder delivered tomorrow is noise.
const pushTTL = int(time.Hour / time.Second)

func (m PushMessage) ttl() int {
	if m.TTL > 0 {
		return m.TTL
	}
	return pushTTL
}

// ErrSubscriptionGone is returned when the push service says the browser is
// no longer listening (404/410). The subscription is revoked, not retried.
var ErrSubscriptionGone = errors.New("push subscription gone")

// PushSender delivers one message to one subscription.
type PushSender interface {
	Send(ctx context.Context, sub db.PushSubscription, msg PushMessage) error
}

// WebPushSender is the production sender: RFC 8291 encryption and VAPID
// signing come from webpush-go, the one dependency this feature adds.
type WebPushSender struct {
	PublicKey  string
	PrivateKey string
	Subject    string // "mailto:" or an https origin, what the push service sees
}

// Send encrypts msg for sub and posts it, held at most msg's TTL.
func (s WebPushSender) Send(ctx context.Context, sub db.PushSubscription, msg PushMessage) error {
	body, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	resp, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
		Endpoint: sub.Endpoint, Keys: webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber: s.Subject, VAPIDPublicKey: s.PublicKey, VAPIDPrivateKey: s.PrivateKey,
		TTL: msg.ttl(), Urgency: webpush.UrgencyNormal,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return ErrSubscriptionGone
	case resp.StatusCode >= 400:
		return fmt.Errorf("push service: %s", resp.Status)
	}
	return nil
}

// LogPushSender prints instead of sending, the development and test
// counterpart of mail.LogSender.
type LogPushSender struct{ Log *slog.Logger }

func (s LogPushSender) Send(_ context.Context, sub db.PushSubscription, msg PushMessage) error {
	log := s.Log
	if log == nil {
		log = slog.Default()
	}
	log.Info("push not configured, printing message", "endpoint", sub.Endpoint, "title", msg.Title, "url", msg.URL)
	return nil
}
