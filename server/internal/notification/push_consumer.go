package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// PushConsumer delivers notification.push rows to every browser the
// recipient registered. It is its own consumer so a push service outage
// retries the push, never the creation of the notification.
type PushConsumer struct {
	q        *db.Queries
	sender   PushSender
	origin   string // FRONTEND_ORIGIN, the root of every deep link
	metrics  Metrics
	presence PresenceChecker
	now      func() time.Time
}

// PresenceChecker says when a user last had a chat presence heartbeat
// (ChatService in production).
type PresenceChecker interface {
	LastPresenceBeat(ctx context.Context, userID string) (time.Time, bool, error)
}

// pushActiveWindow: a recipient who beat this recently is at a keyboard and
// sees the message in the app, so the chat push is dropped (spec N2 §3.5).
const pushActiveWindow = 120 * time.Second

// NewPushConsumer wires the consumer; a nil sender means push is off and
// rows are acknowledged without sending.
func NewPushConsumer(q *db.Queries, sender PushSender, frontendOrigin string) *PushConsumer {
	return &PushConsumer{q: q, sender: sender, origin: strings.TrimRight(frontendOrigin, "/"), now: time.Now}
}

// SetPresence lets chat pushes skip a recipient who is active right now.
// Without it, or when it errors, every push goes out.
func (c *PushConsumer) SetPresence(p PresenceChecker) { c.presence = p }

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
	if c.presence != nil && isChatPushKind(n.Kind) {
		t, ok, err := c.presence.LastPresenceBeat(ctx, n.UserID)
		if err == nil && ok && c.now().Sub(t) <= pushActiveWindow {
			if m := c.metrics; m != nil {
				m.IncPushSuppressed(n.Kind)
			}
			return c.q.MarkNotificationPushed(ctx, n.ID)
		}
	}
	user, err := c.q.GetUserByID(ctx, n.UserID)
	if err != nil {
		return err
	}
	var body string
	if isChatPushKind(n.Kind) {
		// The preview is read at delivery, so a message deleted in the
		// meantime sends nothing.
		chatMsg, err := c.q.GetChatMessageByID(ctx, n.ResourceID)
		if errors.Is(err, pgx.ErrNoRows) {
			return c.q.MarkNotificationPushed(ctx, n.ID)
		}
		if err != nil {
			return err
		}
		body = pushBody(user.Locale, chatMsg)
	}
	msg, err := c.message(ctx, user.Locale, n, body)
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

func (c *PushConsumer) message(ctx context.Context, locale string, n db.Notification, body string) (PushMessage, error) {
	var params map[string]string
	_ = json.Unmarshal([]byte(n.Params), &params)
	url, err := ResourceURL(ctx, c.q, c.origin, n)
	if err != nil {
		return PushMessage{}, err
	}
	return PushMessage{Title: PushTitle(locale, n.Kind, params), Body: body, URL: url, Tag: n.GroupKey}, nil
}

// ResourceURL is the deep link a notification opens, mirroring
// packages/core/paths. A notification with no workspace lands on the
// workspace list; one whose workspace is gone does the same.
func ResourceURL(ctx context.Context, q *db.Queries, origin string, n db.Notification) (string, error) {
	if n.ResourceType == "document" {
		return documentResourceURL(ctx, q, origin, n)
	}
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
		if n.Kind == KindMeetingSummaryReminder {
			// Lands on the summary panel (use-meeting-section-deep-link.ts).
			return base + "/meetings/" + n.ResourceID + "?section=summary", nil
		}
		return base + "/meetings/" + n.ResourceID, nil
	case "audit_export":
		return base + "/settings?tab=audit", nil
	case "chat_message":
		// A message opens in its room, scrolled to it; a message that is gone
		// still lands in Chat.
		msg, err := q.GetChatMessageByID(ctx, n.ResourceID)
		if errors.Is(err, pgx.ErrNoRows) {
			return base + "/chat", nil
		}
		if err != nil {
			return "", err
		}
		return base + "/chat?room=" + url.QueryEscape(msg.RoomID) + "&message=" + url.QueryEscape(msg.ID), nil
	case "email_account":
		return base + "/email", nil
	default:
		return base + "/inbox", nil
	}
}

// documentResourceURL is the deep link a document notification opens
// (G8-07 section 2): the same path the web builds. The workspace is the
// recipient's entry in ListWorkspacesForUser that matches the notification's
// workspace; a recipient who reads the document through a share and is not a
// member of its workspace gets the first workspace of the same organization
// (the one they would have open); with none in that organization they land on
// the workspace list. The comment id rides as ?comment=, and a discussion
// thread adds &kind=discussion so the page opens the Discussion tab.
func documentResourceURL(ctx context.Context, q *db.Queries, origin string, n db.Notification) (string, error) {
	ws, ok, err := documentLinkWorkspace(ctx, q, n)
	if err != nil {
		return "", err
	}
	if !ok {
		return origin + "/workspaces", nil
	}
	link := origin + "/" + ws.OrganizationSlug + "/" + ws.Slug + "/documents/" + n.ResourceID
	var params map[string]string
	_ = json.Unmarshal([]byte(n.Params), &params)
	if cid := params["comment_id"]; cid != "" {
		link += "?comment=" + url.QueryEscape(cid)
		if params["kind"] == "discussion" {
			link += "&kind=discussion"
		}
	}
	return link, nil
}

// documentLinkWorkspace picks the workspace a document link is built from:
// the notification's own workspace when the recipient is in it, otherwise the
// first of their workspaces in the same organization.
func documentLinkWorkspace(ctx context.Context, q *db.Queries, n db.Notification) (db.ListWorkspacesForUserRow, bool, error) {
	workspaces, err := q.ListWorkspacesForUser(ctx, n.UserID)
	if err != nil {
		return db.ListWorkspacesForUserRow{}, false, err
	}
	if n.WorkspaceID.Valid {
		for _, w := range workspaces {
			if w.ID == n.WorkspaceID.String {
				return w, true, nil
			}
		}
	}
	for _, w := range workspaces {
		if w.OrganizationID == n.OrganizationID {
			return w, true, nil
		}
	}
	return db.ListWorkspacesForUserRow{}, false, nil
}
