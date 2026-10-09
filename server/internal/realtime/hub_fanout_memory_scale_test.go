package realtime

import (
	"fmt"
	"testing"
	"time"
)

// TestHubInMemoryFanOut500ClientsLazyChatScopes holds 500 in-process clients,
// each with workspace + user scopes plus a capped set of chat room
// subscriptions (lazy sidebar), and broadcasts once. No socket, database or
// Redis is involved, so it measures the hub's map walk only; chat under real
// load is scripts/load/chat.
func TestHubInMemoryFanOut500ClientsLazyChatScopes(t *testing.T) {
	if testing.Short() {
		t.Skip("in-memory fan-out: skipped with -short")
	}

	const (
		clientCount    = 500
		roomsPerClient = 25
		bufferCap      = 16
	)

	hub := NewHub()
	go hub.Run()

	roomID := "hot-room"
	clients := make([]*Client, clientCount)
	for i := range clientCount {
		wsID := fmt.Sprintf("ws-%d", i%50)
		clients[i] = newRegisteredClient(t, hub, wsID, bufferCap)
		hub.subscribe(clients[i], ScopeChat, roomID)
		for r := 0; r < roomsPerClient-1; r++ {
			hub.subscribe(clients[i], ScopeChat, fmt.Sprintf("room-%d-%d", i, r))
		}
	}

	start := time.Now()
	hub.BroadcastToScope(ScopeChat, roomID, []byte(`{"type":"chat.typing","payload":{"room_id":"hot-room"}}`))
	elapsed := time.Since(start)

	received := 0
	for _, client := range clients {
		select {
		case <-client.send:
			received++
		default:
		}
	}
	if received != clientCount {
		t.Fatalf("hot-room delivery: got %d/%d", received, clientCount)
	}
	t.Logf(
		"org-scale: %d clients × %d chat scopes, hot-room fan-out in %s",
		clientCount,
		roomsPerClient,
		elapsed,
	)
}
