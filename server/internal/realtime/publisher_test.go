package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// These three cases are the regression contract carried over from the
// previous 45-line hub: delivery is scoped to the workspace, a removed client
// stops receiving, and a slow client cannot stall a broadcast. They run
// against the scope-based hub through the same EventPublisher adapter the
// services use, so they also prove the adapter end to end.

func newRegisteredClient(t *testing.T, hub *Hub, workspaceID string, buffer int) *Client {
	t.Helper()
	c := &Client{
		hub:           hub,
		send:          make(chan []byte, buffer),
		userID:        "user-" + workspaceID,
		workspaceID:   workspaceID,
		subscriptions: make(map[scopeKey]bool),
	}
	hub.register <- c
	// register is handled by the Run loop; wait until THIS client is in the
	// workspace room before the test broadcasts. HasLocalSubscribers is not
	// enough — it turns true as soon as any earlier client joined, and a
	// broadcast issued in that window misses the one still registering.
	deadline := time.Now().Add(time.Second)
	for !hub.HasLocalSubscribers(ScopeWorkspace, workspaceID) || !inRoom(hub, c, workspaceID) {
		if time.Now().After(deadline) {
			t.Fatal("client never subscribed to its workspace scope")
		}
		time.Sleep(time.Millisecond)
	}
	return c
}

func inRoom(hub *Hub, c *Client, workspaceID string) bool {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	_, ok := hub.rooms[sk(ScopeWorkspace, workspaceID)][c]
	return ok
}

func recvOrTimeout(t *testing.T, ch <-chan []byte) []byte {
	t.Helper()
	select {
	case m := <-ch:
		return m
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for message")
		return nil
	}
}

func TestPublisherDeliversToWorkspaceOnly(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	c1 := newRegisteredClient(t, hub, "ws1", 8)
	c2 := newRegisteredClient(t, hub, "ws1", 8)
	other := newRegisteredClient(t, hub, "ws2", 8)

	pub := NewPublisher(hub, slog.Default())
	pub.Publish(context.Background(), "ws1", service.Event{Type: "task.created", Payload: map[string]string{"task_id": "t1"}})

	for _, c := range []*Client{c1, c2} {
		var ev service.Event
		if err := json.Unmarshal(recvOrTimeout(t, c.send), &ev); err != nil {
			t.Fatalf("frame is not an event: %v", err)
		}
		if ev.Type != "task.created" || ev.Payload["task_id"] != "t1" {
			t.Fatalf("unexpected event %+v", ev)
		}
	}
	select {
	case <-other.send:
		t.Fatal("ws2 client received a ws1 event")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestUnregisterStopsDelivery(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	c := newRegisteredClient(t, hub, "ws1", 1)

	hub.unregister <- c
	deadline := time.Now().Add(time.Second)
	for hub.HasLocalSubscribers(ScopeWorkspace, "ws1") {
		if time.Now().After(deadline) {
			t.Fatal("client never left its workspace scope")
		}
		time.Sleep(time.Millisecond)
	}

	hub.BroadcastToWorkspace("ws1", []byte(`{"type":"x"}`))
	// The hub closes a removed client's channel so its writePump exits; a
	// closed channel yields immediately with ok=false, which is not delivery.
	select {
	case m, ok := <-c.send:
		if ok {
			t.Fatalf("removed client received a message: %s", m)
		}
	case <-time.After(50 * time.Millisecond):
	}
}

func TestSlowClientDoesNotBlockBroadcast(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	slow := newRegisteredClient(t, hub, "ws1", 0) // unbuffered, nobody reads
	ok := newRegisteredClient(t, hub, "ws1", 8)
	_ = slow

	done := make(chan struct{})
	go func() {
		hub.BroadcastToWorkspace("ws1", []byte(`{"type":"m"}`))
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("broadcast blocked on a slow client")
	}
	recvOrTimeout(t, ok.send)
}

func newLobbyClient(t *testing.T, hub *Hub, meetingID string, buffer int) *Client {
	t.Helper()
	c := &Client{
		hub:            hub,
		send:           make(chan []byte, buffer),
		userID:         "guest:test",
		lobbyMeetingID: meetingID,
		subscriptions:  make(map[scopeKey]bool),
	}
	hub.register <- c
	deadline := time.Now().Add(time.Second)
	for !hub.HasLocalSubscribers(ScopeMeetingLobby, meetingID) || !inScopeRoom(hub, c, ScopeMeetingLobby, meetingID) {
		if time.Now().After(deadline) {
			t.Fatal("lobby client never subscribed to its meeting lobby scope")
		}
		time.Sleep(time.Millisecond)
	}
	return c
}

// newMeetingMember is a workspace socket that also holds meetingID open, as
// the room and the detail page do.
func newMeetingMember(t *testing.T, hub *Hub, workspaceID, meetingID string) *Client {
	t.Helper()
	c := newRegisteredClient(t, hub, workspaceID, 8)
	if !hub.subscribe(c, ScopeMeeting, meetingID) {
		t.Fatal("member did not join the meeting scope")
	}
	return c
}

func decodeEvent(t *testing.T, raw []byte) service.Event {
	t.Helper()
	var ev service.Event
	if err := json.Unmarshal(raw, &ev); err != nil {
		t.Fatalf("frame is not an event: %v", err)
	}
	return ev
}

func assertSilent(t *testing.T, c *Client, who string) {
	t.Helper()
	select {
	case raw := <-c.send:
		t.Fatalf("%s received %s", who, raw)
	case <-time.After(50 * time.Millisecond):
	}
}

// An in-room event reaches the sockets holding the meeting open and the
// guests' lobby, never the rest of the workspace (G8). Services still call
// Publish with the workspace; the catalogue decides the audience.
func TestPublisherRoutesMeetingTopicsToTheMeetingScope(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	lobby := newLobbyClient(t, hub, "mtg-1", 8)
	inRoom := newMeetingMember(t, hub, "ws1", "mtg-1")
	elsewhere := newRegisteredClient(t, hub, "ws1", 8)

	pub := NewPublisher(hub, slog.Default())
	pub.Publish(context.Background(), "ws1", service.Event{
		Type:    "chat.message",
		Payload: map[string]string{"meeting_id": "mtg-1"},
	})

	for _, c := range []*Client{lobby, inRoom} {
		if ev := decodeEvent(t, recvOrTimeout(t, c.send)); ev.Type != "chat.message" || ev.Payload["meeting_id"] != "mtg-1" {
			t.Fatalf("unexpected event %+v", ev)
		}
	}
	assertSilent(t, elsewhere, "a workspace socket outside the meeting")
	assertSilent(t, inRoom, "the in-room socket (a second copy)")
}

// The outbox consumer hands meeting rows to PublishToScope; the lobby still
// hears the ones a guest needs.
func TestPublishToMeetingScopeAlsoReachesTheLobby(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	lobby := newLobbyClient(t, hub, "mtg-1", 8)
	inRoom := newMeetingMember(t, hub, "ws1", "mtg-1")

	pub := NewPublisher(hub, slog.Default())
	pub.PublishToScope(context.Background(), ScopeMeeting, "mtg-1", service.Event{
		Type:    "motion.ballot_cast",
		Payload: map[string]string{"meeting_id": "mtg-1", "motion_id": "mo1"},
	})
	for _, c := range []*Client{lobby, inRoom} {
		if ev := decodeEvent(t, recvOrTimeout(t, c.send)); ev.Type != "motion.ballot_cast" {
			t.Fatalf("unexpected event %+v", ev)
		}
	}
}

// A guest hears only what its screens use: the lobby mirror list did not
// widen when in-room topics moved to the meeting scope.
func TestLobbyDoesNotHearMeetingTopicsGuestsDoNotUse(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	lobby := newLobbyClient(t, hub, "mtg-1", 8)
	inRoom := newMeetingMember(t, hub, "ws1", "mtg-1")

	pub := NewPublisher(hub, slog.Default())
	for _, typ := range []string{"transcript.appended", "attendance.updated", "join_request.created"} {
		pub.Publish(context.Background(), "ws1", service.Event{
			Type:    typ,
			Payload: map[string]string{"meeting_id": "mtg-1"},
		})
		if ev := decodeEvent(t, recvOrTimeout(t, inRoom.send)); ev.Type != typ {
			t.Fatalf("in-room socket got %+v, want %s", ev, typ)
		}
	}
	assertSilent(t, lobby, "the lobby")
}

// Lifecycle events stay on the workspace (the list and the calendar follow
// them) and are mirrored to the lobby only: a member holding the meeting open
// is in the workspace scope too and must not get the frame twice.
func TestWorkspaceMeetingTopicsReachAMemberInTheRoomOnce(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	lobby := newLobbyClient(t, hub, "mtg-1", 8)
	inRoom := newMeetingMember(t, hub, "ws1", "mtg-1")
	elsewhere := newRegisteredClient(t, hub, "ws1", 8)

	pub := NewPublisher(hub, slog.Default())
	pub.Publish(context.Background(), "ws1", service.Event{
		Type:    "meeting.started",
		Payload: map[string]string{"meeting_id": "mtg-1", "version": "2"},
	})
	for _, c := range []*Client{lobby, inRoom, elsewhere} {
		if ev := decodeEvent(t, recvOrTimeout(t, c.send)); ev.Type != "meeting.started" {
			t.Fatalf("unexpected event %+v", ev)
		}
	}
	assertSilent(t, inRoom, "the in-room socket (a second copy)")
}

// A meeting-scoped event without its meeting id has no audience; it is not
// widened to the workspace.
func TestMeetingTopicWithoutMeetingIDIsDropped(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	member := newRegisteredClient(t, hub, "ws1", 8)

	pub := NewPublisher(hub, slog.Default())
	pub.Publish(context.Background(), "ws1", service.Event{Type: "transcript.appended", Payload: map[string]string{}})
	assertSilent(t, member, "a workspace socket")
}

func TestPublisherDeliversToChatScopeOnly(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	inRoom := newRegisteredClient(t, hub, "ws1", 8)
	hub.subscribe(inRoom, ScopeChat, "room-a")
	outRoom := newRegisteredClient(t, hub, "ws1", 8)

	pub := NewPublisher(hub, slog.Default())
	pub.PublishToScope(context.Background(), ScopeChat, "room-a", service.Event{
		Type:    "chat.typing",
		Payload: map[string]string{"room_id": "room-a"},
	})

	var ev service.Event
	if err := json.Unmarshal(recvOrTimeout(t, inRoom.send), &ev); err != nil {
		t.Fatalf("frame is not an event: %v", err)
	}
	if ev.Type != "chat.typing" {
		t.Fatalf("unexpected event %+v", ev)
	}
	select {
	case <-outRoom.send:
		t.Fatal("client not subscribed to room-a received the event")
	case <-time.After(50 * time.Millisecond):
	}
}

// A guest lobby socket only hears the meeting scope, so every signal that
// ends a wait — admitted, rejected, the meeting closing — must be mirrored.
func TestLobbyMirrorsEverySignalThatEndsAWait(t *testing.T) {
	for _, typ := range []string{
		"meeting.started", "meeting.ended", "meeting.canceled",
		"join_request.approved", "join_request.rejected", "conference.session_ready",
	} {
		if _, ok := meetingLobbyEventTypes[typ]; !ok {
			t.Errorf("%s is not mirrored to the meeting lobby scope", typ)
		}
	}
}

// Guests have no workspace socket, so the REC badge in their room only moves
// if recording start/stop reach the meeting scope.
func TestLobbyMirrorsRecordingState(t *testing.T) {
	for _, typ := range []string{"recording.started", "recording.stopped", "recording.ready"} {
		if _, ok := meetingLobbyEventTypes[typ]; !ok {
			t.Errorf("%s is not mirrored to the meeting lobby scope", typ)
		}
	}
}

// Guests can be promoted to members and vote, and they only hear the meeting
// scope: every motion change must be mirrored there or their Votes tab and
// vote prompt never move.
func TestLobbyMirrorsMotionEvents(t *testing.T) {
	for _, typ := range []string{
		"motion.created", "motion.updated", "motion.deleted",
		"motion.opened", "motion.closed", "motion.ballot_cast",
	} {
		if _, ok := meetingLobbyEventTypes[typ]; !ok {
			t.Errorf("%s is not mirrored to the meeting lobby scope", typ)
		}
	}
}
