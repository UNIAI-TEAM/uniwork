package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// PushConsumer delivers notification.push rows to every browser the
// recipient registered. It is its own consumer so a push service outage
// retries the push, never the creation of the notification.
type PushConsumer struct {
	q       *db.Queries
	sender  PushSender
	origin  string // FRONTEND_ORIGIN, the root of every deep link
	metrics Metrics
}

// NewPushConsumer wires the consumer; a nil sender means push is off and
// rows are acknowledged without sending.
func NewPushConsumer(q *db.Queries, sender PushSender, frontendOrigin string) *PushConsumer {
	return &PushConsumer{q: q, sender: sender, origin: strings.TrimRight(frontendOrigin, "/")}
}

// SetMetrics attaches counters.
func (c *PushConsumer) SetMetrics(m Metrics) { c.metrics = m }

func (*PushConsumer) Name() string { return "notification-push" }

func (*PushConsumer) Topics() []string { return []string{TopicPush} }

// Handle sends once per subscription and marks the notification pushed, so
// a retried row after a partial failure does not re-send to the browsers
// that already got it — pushed_at is per notification, which is the
// granularity the outbox retries at.
func (c *PushConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	if c.sender == nil {
		return nil
	}
	var p map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		return fmt.Errorf("push: payload of %s: %w", ev.ID, err)
	}
	n, err := c.q.GetNotification(ctx, p["notification_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if n.PushedAt.Valid || n.ReadAt.Valid {
		return nil // already delivered, or read on another device before the push went out
	}
	subs, err := c.q.ListActivePushSubscriptions(ctx, n.UserID)
	if err != nil {
		return err
	}
	if len(subs) == 0 {
		return c.q.MarkNotificationPushed(ctx, n.ID)
	}
	user, err := c.q.GetUserByID(ctx, n.UserID)
	if err != nil {
		return err
	}
	msg, err := c.message(ctx, user.Locale, n)
	if err != nil {
		return err
	}
	var failed error
	for _, sub := range subs {
		err := c.sender.Send(ctx, sub, msg)
		switch {
		case err == nil:
			c.count("sent")
		case errors.Is(err, ErrSubscriptionGone):
			c.count("gone")
			_ = c.q.RevokePushSubscription(ctx, sub.ID)
		default:
			c.count("failed")
			failed = err
		}
	}
	if failed != nil {
		return failed
	}
	return c.q.MarkNotificationPushed(ctx, n.ID)
}

func (c *PushConsumer) count(result string) {
	if c.metrics != nil {
		c.metrics.IncPushSent(result)
	}
}

func (c *PushConsumer) message(ctx context.Context, locale string, n db.Notification) (PushMessage, error) {
	var params map[string]string
	_ = json.Unmarshal([]byte(n.Params), &params)
	url, err := ResourceURL(ctx, c.q, c.origin, n)
	if err != nil {
		return PushMessage{}, err
	}
	return PushMessage{Title: Title(locale, n.Kind, params), URL: url, Tag: n.GroupKey}, nil
}

// ResourceURL is the deep link a notification opens, mirroring
// packages/core/paths. A notification with no workspace lands on the
// workspace list; one whose workspace is gone does the same.
func ResourceURL(ctx context.Context, q *db.Queries, origin string, n db.Notification) (string, error) {
	if !n.WorkspaceID.Valid {
		return origin + "/workspaces", nil
	}
	ws, err := q.GetWorkspaceWithOrg(ctx, n.WorkspaceID.String)
	if errors.Is(err, pgx.ErrNoRows) {
		return origin + "/workspaces", nil
	}
	if err != nil {
		return "", err
	}
	base := origin + "/" + ws.OrganizationSlug + "/" + ws.Slug
	switch n.ResourceType {
	case "task":
		return base + "/tasks/" + n.ResourceID, nil
	case "meeting":
		return base + "/meetings/" + n.ResourceID, nil
	case "audit_export":
		return base + "/settings?tab=audit", nil
	case "chat_message":
		return base + "/chat", nil
	default:
		return base + "/inbox", nil
	}
}
