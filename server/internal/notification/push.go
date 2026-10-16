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

// Send encrypts msg for sub and posts it. TTL is an hour: a reminder
// delivered tomorrow is noise.
func (s WebPushSender) Send(ctx context.Context, sub db.PushSubscription, msg PushMessage) error {
	body, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	resp, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
		Endpoint: sub.Endpoint, Keys: webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber: s.Subject, VAPIDPublicKey: s.PublicKey, VAPIDPrivateKey: s.PrivateKey,
		TTL: int(time.Hour / time.Second), Urgency: webpush.UrgencyNormal,
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
