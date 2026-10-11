package realtime

import (
	"context"
	"encoding/json"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type countingScopeAuthorizer struct{ calls atomic.Int64 }

func (a *countingScopeAuthorizer) AuthorizeScope(context.Context, string, string, string, string) (bool, error) {
	a.calls.Add(1)
	return true, nil
}

func lastFrame(t *testing.T, c *Client) (string, map[string]string) {
	t.Helper()
	var frame struct {
		Type    string            `json:"type"`
		Payload map[string]string `json:"payload"`
	}
	var raw []byte
	for len(c.send) > 0 {
		raw = <-c.send
	}
	if raw == nil {
		t.Fatal("no frame sent")
	}
	if err := json.Unmarshal(raw, &frame); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return frame.Type, frame.Payload
}

func TestResubscribingAHeldScopeSkipsAuthorization(t *testing.T) {
	hub := NewHub()
	auth := &countingScopeAuthorizer{}
	hub.SetAuthorizer(auth)
	c := newDirectHubClient(hub, "u1", "ws1")

	c.handleSubscribe(ScopeChat, "r1")
	c.handleSubscribe(ScopeChat, "r1")

	if typ, _ := lastFrame(t, c); typ != "subscribe_ack" {
		t.Fatalf("second subscribe answered %q, want subscribe_ack", typ)
	}
	if n := auth.calls.Load(); n != 1 {
		t.Fatalf("authorizer calls = %d, want 1 (held scope not re-checked)", n)
	}
}

func TestSocketIsRefusedScopesPastTheCap(t *testing.T) {
	hub := NewHub()
	auth := &countingScopeAuthorizer{}
	hub.SetAuthorizer(auth)
	c := newDirectHubClient(hub, "u1", "ws1")
	c.send = make(chan []byte, maxScopesPerSocket+8)

	for i := range maxScopesPerSocket {
		c.handleSubscribe(ScopeTask, "t"+strconv.Itoa(i))
	}
	c.handleSubscribe(ScopeTask, "one-too-many")

	typ, payload := lastFrame(t, c)
	if typ != "subscribe_error" || payload["error"] != "too_many_scopes" {
		t.Fatalf("subscribe past the cap answered %q %v, want subscribe_error too_many_scopes", typ, payload)
	}
	if n := auth.calls.Load(); n != maxScopesPerSocket {
		t.Fatalf("authorizer calls = %d, want %d (refused before the lookup)", n, maxScopesPerSocket)
	}
	if hub.HasLocalSubscribers(ScopeTask, "one-too-many") {
		t.Fatal("scope past the cap was subscribed")
	}

	// A scope already held is still acknowledged at the cap.
	c.handleSubscribe(ScopeTask, "t0")
	if typ, _ := lastFrame(t, c); typ != "subscribe_ack" {
		t.Fatalf("held scope at the cap answered %q, want subscribe_ack", typ)
	}
}

func TestSocketFloodingFramesIsClosedWithPolicyViolation(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()

	conn := connectWS(t, server)
	defer conn.Close()
	waitFor(t, "client registration", func() bool { return totalClients(hub) == 1 })

	for range inboundFrameBurst + 20 {
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`)); err != nil {
			break
		}
	}

	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		_, _, err := conn.ReadMessage()
		if err == nil {
			continue // pongs for the frames inside the burst
		}
		if !websocket.IsCloseError(err, websocket.ClosePolicyViolation) {
			t.Fatalf("read after flood = %v, want close code %d", err, websocket.ClosePolicyViolation)
		}
		break
	}
	waitFor(t, "client to be unregistered", func() bool { return totalClients(hub) == 0 })
}
