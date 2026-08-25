package service

import "context"

type Event struct {
	Type    string            `json:"type"`
	Payload map[string]string `json:"payload"`
}

// EventPublisher fans out workspace-scoped events to connected clients.
// The realtime package provides the production implementation; NopPublisher
// is for tests and for wiring before realtime exists.
type EventPublisher interface {
	Publish(ctx context.Context, workspaceID string, ev Event)
}

type NopPublisher struct{}

func (NopPublisher) Publish(context.Context, string, Event) {}
