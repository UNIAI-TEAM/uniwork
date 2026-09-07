package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// Publisher is the realtime fan-out this package needs. The concrete
// implementation lives with the hub; declaring the interface here keeps the
// dependency pointing one way (outbox knows nothing about services).
type Publisher interface {
	PublishWorkspace(ctx context.Context, workspaceID, topic string, payload map[string]string)
	PublishScope(ctx context.Context, scopeType, scopeID, topic string, payload map[string]string)
	PublishUser(ctx context.Context, userID, topic string, payload map[string]string)
}

// MemberResolver answers "who is in this chat room". ScopeRoom events are
// delivered to each member's own connections, and only the chat service knows
// the membership.
type MemberResolver interface {
	RoomMemberIDs(ctx context.Context, roomID string) ([]string, error)
}

// RealtimeConsumer is the one path from a domain event to a connected client.
// Before this existed, services published straight to the hub after commit,
// and a process that died in between lost the event with no way to notice.
type RealtimeConsumer struct {
	pub     Publisher
	members MemberResolver
	metrics PublishMetrics
	now     func() time.Time
}

// PublishMetrics receives commit → frame latency per topic; metrics.Outbox
// implements it. Nil is fine.
type PublishMetrics interface {
	ObserveRealtimePublish(topic string, d time.Duration)
}

// SetMetrics attaches the latency histogram.
func (c *RealtimeConsumer) SetMetrics(m PublishMetrics) { c.metrics = m }

// NewRealtimeConsumer returns a consumer publishing to pub.
func NewRealtimeConsumer(pub Publisher) *RealtimeConsumer {
	return &RealtimeConsumer{pub: pub, now: time.Now}
}

// WithMembers attaches the resolver ScopeRoom events need. Without it those
// events are dropped rather than delivered to the wrong audience.
func (c *RealtimeConsumer) WithMembers(m MemberResolver) *RealtimeConsumer {
	c.members = m
	return c
}

// Name identifies the consumer in errors and logs.
func (c *RealtimeConsumer) Name() string { return "realtime" }

// Topics is every outbox-delivered event that has a realtime audience.
func (c *RealtimeConsumer) Topics() []string { return RealtimeTopics() }

// Handle publishes the row to the scope its catalogue entry names. A payload
// missing the id that scope needs is dropped rather than retried: no retry
// will add the field, and a poisoned row would otherwise hold up the topic.
func (c *RealtimeConsumer) Handle(ctx context.Context, ev Row) error {
	if c.pub == nil {
		return nil
	}
	def, ok := Lookup(ev.Topic)
	if !ok {
		return nil
	}
	payload := map[string]string{}
	if ev.Payload != "" {
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
			return fmt.Errorf("realtime: payload of %s: %w", ev.ID, err)
		}
	}
	if c.metrics != nil && ev.CreatedAt.Valid {
		defer c.metrics.ObserveRealtimePublish(ev.Topic, c.now().Sub(ev.CreatedAt.Time))
	}
	switch def.Scope {
	case ScopeWorkspace:
		wsID := payload["workspace_id"]
		if wsID == "" {
			wsID = ev.WorkspaceID.String
		}
		if wsID == "" {
			return nil
		}
		c.pub.PublishWorkspace(ctx, wsID, ev.Topic, payload)
	case ScopeUser:
		if payload["user_id"] == "" {
			return nil
		}
		c.pub.PublishUser(ctx, payload["user_id"], ev.Topic, payload)
	case ScopeOrganization:
		if payload["organization_id"] == "" {
			return nil
		}
		c.pub.PublishScope(ctx, "organization", payload["organization_id"], ev.Topic, payload)
	case ScopeChat:
		if payload["room_id"] == "" {
			return nil
		}
		c.pub.PublishScope(ctx, "chat", payload["room_id"], ev.Topic, payload)
	case ScopeRoom:
		roomID := payload["room_id"]
		if roomID == "" || c.members == nil {
			return nil
		}
		ids, err := c.members.RoomMemberIDs(ctx, roomID)
		if err != nil {
			return fmt.Errorf("realtime: members of %s: %w", roomID, err)
		}
		for _, userID := range ids {
			c.pub.PublishUser(ctx, userID, ev.Topic, payload)
		}
	}
	return nil
}

// WebhookConsumer reserves the outbound-webhook topic so the catalogue entry
// and the delivery path land together when webhooks are built. It succeeds
// without doing anything, which keeps rows from piling up as dead letters.
type WebhookConsumer struct{}

// Name identifies the consumer in errors and logs.
func (WebhookConsumer) Name() string { return "webhook" }

// Topics is the reserved outbound-webhook topic.
func (WebhookConsumer) Topics() []string { return []string{"webhook.deliver"} }

// Handle does nothing yet.
func (WebhookConsumer) Handle(context.Context, Row) error {
	return nil // TODO(spec-webhooks): deliver to the subscription's endpoint.
}
