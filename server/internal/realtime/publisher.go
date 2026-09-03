package realtime

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// publisher adapts the service-layer EventPublisher contract onto a
// Broadcaster. Services keep publishing `{type, payload}` events and never
// learn whether delivery is in-process (bare *Hub) or relayed through Redis
// to other nodes (DualWriteBroadcaster).
type publisher struct {
	b   Broadcaster
	log *slog.Logger
}

// NewPublisher wraps a Broadcaster as the EventPublisher services depend on.
func NewPublisher(b Broadcaster, log *slog.Logger) service.EventPublisher {
	if log == nil {
		log = slog.Default()
	}
	return &publisher{b: b, log: log}
}

func (p *publisher) Publish(_ context.Context, workspaceID string, ev service.Event) {
	p.deliver(ev, func(frame []byte) {
		p.b.BroadcastToWorkspace(workspaceID, frame)
	})
}

func (p *publisher) PublishToScope(_ context.Context, scopeType, scopeID string, ev service.Event) {
	p.deliver(ev, func(frame []byte) {
		p.b.BroadcastToScope(scopeType, scopeID, frame)
	})
}

func (p *publisher) SendToUser(_ context.Context, userID string, ev service.Event) {
	p.deliver(ev, func(frame []byte) {
		p.b.SendToUser(userID, frame)
	})
}

func (p *publisher) deliver(ev service.Event, send func([]byte)) {
	frame, err := json.Marshal(ev)
	if err != nil {
		p.log.Error("realtime: marshal event", "type", ev.Type, "err", err)
		return
	}
	M.RecordEvent(ev.Type)
	send(frame)
}
