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
	for !hub.HasLocalSubscribers(ScopeMeeting, meetingID) || !inMeetingRoom(hub, c, meetingID) {
		if time.Now().After(deadline) {
			t.Fatal("lobby client never subscribed to its meeting scope")
		}
		time.Sleep(time.Millisecond)
	}
	return c
}

func inMeetingRoom(hub *Hub, c *Client, meetingID string) bool {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	_, ok := hub.rooms[sk(ScopeMeeting, meetingID)][c]
	return ok
}

func TestPublisherMirrorsChatMessageToMeetingLobbyScope(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	lobby := newLobbyClient(t, hub, "mtg-1", 8)
	member := newRegisteredClient(t, hub, "ws1", 8)

	pub := NewPublisher(hub, slog.Default())
	pub.Publish(context.Background(), "ws1", service.Event{
		Type:    "chat.message",
		Payload: map[string]string{"meeting_id": "mtg-1"},
	})

	for _, c := range []*Client{lobby, member} {
		var ev service.Event
		if err := json.Unmarshal(recvOrTimeout(t, c.send), &ev); err != nil {
			t.Fatalf("frame is not an event: %v", err)
		}
		if ev.Type != "chat.message" || ev.Payload["meeting_id"] != "mtg-1" {
			t.Fatalf("unexpected event %+v", ev)
		}
	}
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
