package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"

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

// Publisher adapts the service-layer EventPublisher contract onto a
// Broadcaster. Services keep publishing `{type, payload}` events and never
// learn whether delivery is in-process (bare *Hub) or relayed through Redis
// to other nodes (DualWriteBroadcaster).
type Publisher struct {
	b   Broadcaster
	log *slog.Logger

	mu sync.RWMutex
	// batches is the SendToUsers queue Run drains; nil while Run is not
	// running, and then SendToUsers delivers on the caller.
	batches chan userBatch
}

type userBatch struct {
	userIDs []string
	frame   []byte
}

// userBatchQueue bounds the SendToUsers batches waiting for Run; past it a
// sender delivers on its own goroutine rather than drop the frame.
const userBatchQueue = 256

// userBatchBroadcaster is a Broadcaster that delivers one frame to many users
// for less than a SendToUser each.
type userBatchBroadcaster interface {
	SendToUsers(userIDs []string, message []byte)
}

// NewPublisher wraps a Broadcaster as the EventPublisher services depend on.
func NewPublisher(b Broadcaster, log *slog.Logger) *Publisher {
	if log == nil {
		log = slog.Default()
	}
	return &Publisher{b: b, log: log}
}

// Publish delivers a workspace event. Services publish every meeting event
// here, so the catalogue decides the audience: a topic it scopes to the
// meeting goes only to the sockets holding that meeting open (G8), and is
// dropped when the payload does not name the meeting.
func (p *Publisher) Publish(_ context.Context, workspaceID string, ev service.Event) {
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

func (p *Publisher) PublishToScope(_ context.Context, scopeType, scopeID string, ev service.Event) {
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
func (p *Publisher) toMeeting(eventType, meetingID string, frame []byte) {
	p.b.BroadcastToScope(ScopeMeeting, meetingID, frame)
	if _, ok := meetingLobbyEventTypes[eventType]; ok {
		p.b.BroadcastToScope(ScopeMeetingLobby, meetingID, frame)
	}
}

func meetingScoped(eventType string) bool {
	def, ok := outbox.Lookup(eventType)
	return ok && def.Scope == outbox.ScopeMeeting
}

func (p *Publisher) SendToUser(_ context.Context, userID string, ev service.Event) {
	p.deliver(ev, func(frame []byte) {
		p.b.SendToUser(userID, frame)
	})
}

// SendToUsers marshals ev once for every user in userIDs. While Run is
// draining, it only queues: a room can have a thousand members, and their
// Redis writes do not belong on the request that sent the message.
func (p *Publisher) SendToUsers(_ context.Context, userIDs []string, ev service.Event) {
	if len(userIDs) == 0 {
		return
	}
	p.deliver(ev, func(frame []byte) {
		p.mu.RLock()
		if p.batches != nil {
			select {
			case p.batches <- userBatch{userIDs: userIDs, frame: frame}:
				p.mu.RUnlock()
				return
			default:
			}
		}
		p.mu.RUnlock()
		p.sendUsers(userIDs, frame)
	})
}

func (p *Publisher) sendUsers(userIDs []string, frame []byte) {
	if b, ok := p.b.(userBatchBroadcaster); ok {
		b.SendToUsers(userIDs, frame)
		return
	}
	for _, id := range userIDs {
		p.b.SendToUser(id, frame)
	}
}

// Run delivers queued SendToUsers batches until ctx is done, then delivers
// what is still queued and returns. It must stop before the relay does.
func (p *Publisher) Run(ctx context.Context) {
	q := make(chan userBatch, userBatchQueue)
	p.mu.Lock()
	p.batches = q
	p.mu.Unlock()
	for {
		select {
		case b := <-q:
			p.sendUsers(b.userIDs, b.frame)
		case <-ctx.Done():
			p.mu.Lock()
			p.batches = nil
			p.mu.Unlock()
			close(q)
			for b := range q {
				p.sendUsers(b.userIDs, b.frame)
			}
			return
		}
	}
}

func (p *Publisher) deliver(ev service.Event, send func([]byte)) {
	frame, err := json.Marshal(ev)
	if err != nil {
		p.log.Error("realtime: marshal event", "type", ev.Type, "err", err)
		return
	}
	M.RecordEvent(ev.Type)
	send(frame)
}
