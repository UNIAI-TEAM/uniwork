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
}

type NopPublisher struct{}

func (NopPublisher) Publish(context.Context, string, Event) {}

func (NopPublisher) PublishToScope(context.Context, string, string, Event) {}

func (NopPublisher) SendToUser(context.Context, string, Event) {}
