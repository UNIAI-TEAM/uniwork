package realtime

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// meetingLobbyEventTypes is what a guest's lobby socket hears: the signals
// that end a wait, and the in-room changes a guest's screens show. Each one
// is also delivered to the meeting lobby scope, whatever its catalogue scope.
var meetingLobbyEventTypes = map[string]struct{}{
	"meeting.started":          {},
	"meeting.ended":            {},
	"meeting.canceled":         {},
	"join_request.approved":    {},
	"join_request.rejected":    {},
	"conference.session_ready": {},
	"chat.message":             {},
	"participant.invited":      {},
	"participant.removed":      {},
	"participant.updated":      {},
	"motion.created":           {},
	"motion.updated":           {},
	"motion.deleted":           {},
	"motion.opened":            {},
	"motion.closed":            {},
	"motion.ballot_cast":       {},
	"recording.started":        {},
	"recording.stopped":        {},
	"recording.ready":          {},
}

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

// Publish delivers a workspace event. Services publish every meeting event
// here, so the catalogue decides the audience: a topic it scopes to the
// meeting goes only to the sockets holding that meeting open (G8), and is
// dropped when the payload does not name the meeting.
func (p *publisher) Publish(_ context.Context, workspaceID string, ev service.Event) {
	meetingID := ev.Payload["meeting_id"]
	if meetingScoped(ev.Type) {
		if meetingID == "" {
			p.log.Warn("realtime: meeting event without meeting_id", "type", ev.Type)
			return
		}
		p.deliver(ev, func(frame []byte) { p.toMeeting(ev.Type, meetingID, frame) })
		return
	}
	p.deliver(ev, func(frame []byte) {
		p.b.BroadcastToWorkspace(workspaceID, frame)
		if meetingID != "" {
			if _, ok := meetingLobbyEventTypes[ev.Type]; ok {
				p.b.BroadcastToScope(ScopeMeetingLobby, meetingID, frame)
			}
		}
	})
}

func (p *publisher) PublishToScope(_ context.Context, scopeType, scopeID string, ev service.Event) {
	p.deliver(ev, func(frame []byte) {
		if scopeType == ScopeMeeting {
			p.toMeeting(ev.Type, scopeID, frame)
			return
		}
		p.b.BroadcastToScope(scopeType, scopeID, frame)
	})
}

// toMeeting fans a meeting-scoped frame out to the members holding the
// meeting open and, for the topics a guest needs, to its lobby.
func (p *publisher) toMeeting(eventType, meetingID string, frame []byte) {
	p.b.BroadcastToScope(ScopeMeeting, meetingID, frame)
	if _, ok := meetingLobbyEventTypes[eventType]; ok {
		p.b.BroadcastToScope(ScopeMeetingLobby, meetingID, frame)
	}
}

func meetingScoped(eventType string) bool {
	def, ok := outbox.Lookup(eventType)
	return ok && def.Scope == outbox.ScopeMeeting
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
