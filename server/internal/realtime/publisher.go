package realtime

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// Lobby events are mirrored to the meeting scope so guest lobby WebSocket
// clients receive admission signals without a workspace membership socket.
var meetingLobbyEventTypes = map[string]struct{}{
	"meeting.started":          {},
	"meeting.ended":            {},
	"meeting.canceled":         {},
	"join_request.approved":    {},
	"conference.session_ready": {},
}

// publisher adapts the service-layer EventPublisher contract onto a
// Broadcaster. Services keep publishing `{type, payload}` events for a
// workspace and never learn whether delivery is in-process (bare *Hub) or
// relayed through Redis to other nodes (DualWriteBroadcaster).
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
	frame, err := json.Marshal(ev)
	if err != nil {
		p.log.Error("realtime: marshal event", "type", ev.Type, "err", err)
		return
	}
	p.b.BroadcastToWorkspace(workspaceID, frame)
	if meetingID := ev.Payload["meeting_id"]; meetingID != "" {
		if _, ok := meetingLobbyEventTypes[ev.Type]; ok {
			p.b.BroadcastToScope(ScopeMeeting, meetingID, frame)
		}
	}
}
