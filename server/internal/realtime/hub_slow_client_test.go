package realtime

import (
	"bytes"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// A socket whose download is stalled but whose upload still works is evicted
// as slow; its next ping must not reach the closed send channel (C1: that
// send panicked and took the whole process down).
func TestSlowClientThatKeepsPingingIsEvictedWithoutPanic(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()

	conn := connectWS(t, server)
	defer conn.Close()
	waitFor(t, "workspace subscription", func() bool {
		return hub.HasLocalSubscribers(ScopeWorkspace, testWorkspaceID)
	})

	// The client never reads, so the kernel buffers fill, writePump blocks and
	// the 256-frame queue overflows.
	big := bytes.Repeat([]byte("x"), 64*1024)
	deadline := time.Now().Add(5 * time.Second)
	for totalClients(hub) > 0 {
		if time.Now().After(deadline) {
			t.Fatal("stalled socket was never evicted")
		}
		hub.BroadcastToScope(ScopeWorkspace, testWorkspaceID, big)
	}

	// The upload direction is still alive: keep pinging the evicted socket.
	for range 5 {
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`))
		time.Sleep(10 * time.Millisecond)
	}

	// Eviction closes the connection itself, so the peer sees it end instead
	// of waiting for the write deadline.
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				t.Fatal("evicted socket is still open")
			}
			break
		}
	}
}

func TestSendJSONAfterEvictionIsDropped(t *testing.T) {
	hub := NewHub()
	c := newDirectHubClient(hub, "u1", "ws1")
	hub.evictSlow([]*Client{c})

	c.sendJSON(map[string]string{"type": "pong"}) // must not panic
}
