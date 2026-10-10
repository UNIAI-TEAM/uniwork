package service

import "context"

type Event struct {
	Type    string            `json:"type"`
	Payload map[string]string `json:"payload"`
}

// ChatScopeType is the realtime scope for a DM/group room. Workspace chat
// stays on the workspace scope via Publish.
const ChatScopeType = "chat"

// EventPublisher fans out events to connected clients. Workspace-scoped
// events use Publish; high-frequency chat room events use PublishToScope;
// sidebar membership events use SendToUser so every member receives them
// on their user scope without org-wide workspace fan-out.
type EventPublisher interface {
	Publish(ctx context.Context, workspaceID string, ev Event)
	PublishToScope(ctx context.Context, scopeType, scopeID string, ev Event)
	SendToUser(ctx context.Context, userID string, ev Event)
	// SendToUsers is SendToUser for a room's worth of users. It may return
	// before delivery, so a large room does not hold up the request.
	SendToUsers(ctx context.Context, userIDs []string, ev Event)
}

type NopPublisher struct{}

func (NopPublisher) Publish(context.Context, string, Event) {}

func (NopPublisher) PublishToScope(context.Context, string, string, Event) {}

func (NopPublisher) SendToUser(context.Context, string, Event) {}

func (NopPublisher) SendToUsers(context.Context, []string, Event) {}

// RealtimePublisher adapts EventPublisher to the interface the outbox
// dispatcher expects. The adapter exists so internal/outbox never imports this
// package: the dependency runs service → outbox, and a consumer added there
// stays ignorant of who produced the event.
type RealtimePublisher struct{ Pub EventPublisher }

// PublishWorkspace fans an event out to everyone in a workspace.
func (r RealtimePublisher) PublishWorkspace(ctx context.Context, workspaceID, topic string, payload map[string]string) {
	r.Pub.Publish(ctx, workspaceID, Event{Type: topic, Payload: payload})
}

// PublishScope delivers to a narrower scope, currently a chat room.
func (r RealtimePublisher) PublishScope(ctx context.Context, scopeType, scopeID, topic string, payload map[string]string) {
	r.Pub.PublishToScope(ctx, scopeType, scopeID, Event{Type: topic, Payload: payload})
}

// PublishUser delivers to one user's own connections.
func (r RealtimePublisher) PublishUser(ctx context.Context, userID, topic string, payload map[string]string) {
	r.Pub.SendToUser(ctx, userID, Event{Type: topic, Payload: payload})
}

// PublishUsers delivers one event to many users' own connections.
func (r RealtimePublisher) PublishUsers(ctx context.Context, userIDs []string, topic string, payload map[string]string) {
	r.Pub.SendToUsers(ctx, userIDs, Event{Type: topic, Payload: payload})
}
