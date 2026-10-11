package realtime

import (
	"testing"
	"time"
)

// TestHubInMemoryFanOut200Subscribers walks the hub's scope map into 200
// in-process send channels. No socket, database or Redis is involved, so it
// says nothing about chat under load; that is scripts/load/chat.
func TestHubInMemoryFanOut200Subscribers(t *testing.T) {
	if testing.Short() {
		t.Skip("in-memory fan-out: skipped with -short")
	}

	hub := NewHub()
	go hub.Run()

	const (
		roomID    = "load-room"
		clientN   = 200
		bufferCap = 8
	)

	clients := make([]*Client, clientN)
	for i := range clientN {
		clients[i] = newRegisteredClient(t, hub, "ws-load", bufferCap)
		hub.subscribe(clients[i], ScopeChat, roomID)
	}

	start := time.Now()
	hub.BroadcastToScope(ScopeChat, roomID, []byte(`{"type":"chat.typing","payload":{"room_id":"load-room"}}`))
	elapsed := time.Since(start)

	received := 0
	for _, client := range clients {
		select {
		case <-client.send:
			received++
		default:
		}
	}
	if received != clientN {
		t.Fatalf("delivered to %d/%d subscribers", received, clientN)
	}
	t.Logf("chat scope broadcast to %d subscribers in %s", clientN, elapsed)
}
