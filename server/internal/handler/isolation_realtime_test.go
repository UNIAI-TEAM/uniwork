package handler

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestIsolationRealtime is the WebSocket half of the isolation matrix: the two
// sockets upgrade first and authenticate in-band, so a status code says
// nothing (TestIsolationMatrix lists them as isoRealtime). B's owner must not
// open A's workspace channel, must not subscribe to any of A's scopes from
// their own channel, and must not listen in A's meeting lobby. A's owner,
// on the same server, gets every one of those.
func TestIsolationRealtime(t *testing.T) {
	w := newIsolationServer(t)
	go w.deps.Hub.Run()
	w.alpha = w.buildTenant(t, "alpha")
	w.bravo = w.buildTenant(t, "bravo")
	a, b := w.alpha, w.bravo

	t.Run("workspace channel", func(t *testing.T) {
		for _, q := range []string{"workspace_id=" + a.wsID, "workspace_slug=" + url.QueryEscape(a.orgSlug+"/"+a.wsSlug)} {
			conn := w.dialWS(t, "/api/v1/ws?"+q)
			reply := wsAuth(t, conn, b.token)
			if reply["type"] == "auth_ack" || !strings.Contains(isoMust(json.Marshal(reply)), "not a member") {
				t.Errorf("B's owner on A's channel (%s) = %v, want refusal", q, reply)
			}
			conn.Close()
		}
		conn := w.dialWS(t, "/api/v1/ws?workspace_id="+a.wsID)
		if reply := wsAuth(t, conn, a.token); reply["type"] != "auth_ack" {
			t.Errorf("A's owner on A's channel = %v, want auth_ack", reply)
		}
		conn.Close()
	})

	// Every scope a client can name, filled with A's ids: from B's own
	// channel each one is refused; from A's channel the same frames are
	// acknowledged, so the refusal is the tenancy check.
	scopes := []struct{ scope, id string }{
		{"workspace", a.wsID}, {"organization", a.orgID}, {"user", a.userID},
		{"chat", a.ids["room"]}, {"task", a.ids["task"]}, {"meeting", a.ids["meeting"]},
	}
	t.Run("subscribe", func(t *testing.T) {
		conn := w.dialWS(t, "/api/v1/ws?workspace_id="+b.wsID)
		defer conn.Close()
		if reply := wsAuth(t, conn, b.token); reply["type"] != "auth_ack" {
			t.Fatalf("B's owner on B's channel = %v", reply)
		}
		for _, s := range scopes {
			reply := wsSubscribe(t, conn, s.scope, s.id)
			if reply["type"] != "subscribe_error" {
				t.Errorf("B subscribes to A's %s %s = %v, want subscribe_error", s.scope, s.id, reply)
			}
		}

		own := w.dialWS(t, "/api/v1/ws?workspace_id="+a.wsID)
		defer own.Close()
		if reply := wsAuth(t, own, a.token); reply["type"] != "auth_ack" {
			t.Fatalf("A's owner on A's channel = %v", reply)
		}
		for _, s := range scopes {
			if s.scope == "task" {
				// Not a subscribable scope today (task needs an authorizer
				// the server does not wire), so there is no positive control
				// to compare with.
				continue
			}
			if reply := wsSubscribe(t, own, s.scope, s.id); reply["type"] != "subscribe_ack" {
				t.Errorf("A subscribes to its own %s = %v, want subscribe_ack", s.scope, reply)
			}
		}

		// Delivery, not only the gates: a frame on each of A's scopes reaches
		// A's socket and never B's, which stays connected to B's workspace.
		hub := w.deps.Hub
		sends := []struct {
			name string
			send func(frame []byte)
		}{
			{"workspace", func(f []byte) { hub.BroadcastToWorkspace(a.wsID, f) }},
			{"organization", func(f []byte) { hub.BroadcastToScope("organization", a.orgID, f) }},
			{"chat", func(f []byte) { hub.BroadcastToScope("chat", a.ids["room"], f) }},
			{"user", func(f []byte) { hub.SendToUser(a.userID, f) }},
		}
		for _, s := range sends {
			tag := "iso-frame-" + s.name
			s.send([]byte(`{"type":"iso.probe","payload":{"tag":"` + tag + `"}}`))
			if !wsSees(own, tag, 3*time.Second) {
				t.Errorf("A's socket did not get a frame on A's %s scope", s.name)
			}
			if wsSees(conn, tag, 300*time.Millisecond) {
				t.Errorf("B's socket got a frame sent on A's %s scope", s.name)
			}
		}
	})

	// The edit lock topics (UNI-1645 §6), delivered the way the dispatcher
	// does - outbox row -> realtime consumer -> hub: document.lock_changed
	// reaches A's workspace and never B's socket; each user-scope topic
	// reaches only the user its payload names.
	t.Run("edit lock topics", func(t *testing.T) {
		dial := func(wsID, token string) *websocket.Conn {
			conn := w.dialWS(t, "/api/v1/ws?workspace_id="+wsID)
			if reply := wsAuth(t, conn, token); reply["type"] != "auth_ack" {
				t.Fatalf("auth on %s = %v", wsID, reply)
			}
			return conn
		}
		consumer := outbox.NewRealtimeConsumer(service.RealtimePublisher{Pub: realtime.NewPublisher(w.deps.Hub, nil)})
		doc := a.get(t, "lockDocument")
		cases := []struct {
			topic, userID string
			reach, miss   []string
		}{
			{"document.lock_changed", "", []string{"owner", "peer"}, []string{"other"}},
			{"document.lock_taken_over", a.userID, []string{"owner"}, []string{"peer", "other"}},
			{"document.edit_requested", a.userID, []string{"owner"}, []string{"peer", "other"}},
			{"document.edit_request_answered", a.peerID, []string{"peer"}, []string{"owner", "other"}},
		}
		for _, c := range cases {
			// Fresh sockets per topic: a read that hits its deadline leaves a
			// gorilla connection unusable, so a "miss" check ends that socket.
			conns := map[string]*websocket.Conn{
				"owner": dial(a.wsID, a.token), "peer": dial(a.wsID, a.peerToken), "other": dial(b.wsID, b.token),
			}
			tag := "iso-lock-" + strings.ReplaceAll(c.topic, ".", "-")
			// The tag rides in a catalogue key: request_id on the request
			// topics, document_id on the two that carry no request.
			payload := map[string]string{"document_id": doc, "workspace_id": a.wsID}
			if strings.Contains(c.topic, "edit_request") {
				payload["request_id"] = tag
			} else {
				payload["document_id"] = tag
			}
			if c.userID != "" {
				payload["user_id"] = c.userID
			}
			raw, _ := json.Marshal(payload)
			if err := consumer.Handle(context.Background(), db.OutboxEvent{
				ID: "iso-" + tag, Topic: c.topic, Payload: string(raw),
				WorkspaceID: pgtype.Text{String: a.wsID, Valid: true},
			}); err != nil {
				t.Fatalf("%s: %v", c.topic, err)
			}
			for _, who := range c.reach {
				if !wsSees(conns[who], tag, 3*time.Second) {
					t.Errorf("%s did not reach %s", c.topic, who)
				}
			}
			for _, who := range c.miss {
				if wsSees(conns[who], tag, 300*time.Millisecond) {
					t.Errorf("%s reached %s, outside its scope", c.topic, who)
				}
			}
			for _, conn := range conns {
				conn.Close()
			}
		}
	})

	t.Run("meeting lobby", func(t *testing.T) {
		conn := w.dialWS(t, "/api/v1/meetings/"+a.ids["meeting"]+"/lobby-ws")
		// The exact refusal, then a closed socket: a timeout or any other
		// frame is not a refusal.
		if reply := wsAuth(t, conn, b.token); reply["error"] != "meeting not available" {
			t.Errorf("B's owner in A's meeting lobby = %v, want {\"error\":\"meeting not available\"}", reply)
		}
		if after := wsRead(t, conn); after["read_error"] == nil {
			t.Errorf("A's lobby kept B's socket open: %v", after)
		}
		conn.Close()
		// The third member knocked in the fixture: the lobby is theirs to
		// wait in, which shows the socket works at all.
		conn = w.dialWS(t, "/api/v1/meetings/"+a.ids["meeting"]+"/lobby-ws")
		if reply := wsAuth(t, conn, a.thirdToken); reply["type"] != "auth_ack" {
			t.Errorf("A's knocking member in A's lobby = %v, want auth_ack", reply)
		}
		conn.Close()
	})
}

func (w *isoWorld) dialWS(t *testing.T, path string) *websocket.Conn {
	t.Helper()
	conn, res, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(w.srv.URL, "http")+path, nil)
	if err != nil {
		status := 0
		if res != nil {
			status = res.StatusCode
		}
		t.Fatalf("dial %s: %v (status %d)", path, err, status)
	}
	return conn
}

// wsAuth sends the auth frame and returns the server's first answer: the
// auth_ack, or the error frame written before it closes.
func wsAuth(t *testing.T, conn *websocket.Conn, token string) map[string]any {
	t.Helper()
	if err := conn.WriteJSON(map[string]any{"type": "auth", "payload": map[string]string{"token": token}}); err != nil {
		t.Fatal(err)
	}
	return wsRead(t, conn)
}

func wsSubscribe(t *testing.T, conn *websocket.Conn, scope, id string) map[string]any {
	t.Helper()
	if err := conn.WriteJSON(map[string]any{"type": "subscribe", "payload": map[string]string{"scope": scope, "id": id}}); err != nil {
		t.Fatal(err)
	}
	// Skip frames that are not the answer (presence, pings).
	for {
		reply := wsRead(t, conn)
		if typ, _ := reply["type"].(string); strings.HasPrefix(typ, "subscribe") {
			return reply
		}
	}
}

func wsRead(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		return map[string]any{"read_error": err.Error()}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{"raw": string(raw)}
	}
	return out
}

// wsSees reports whether a frame carrying tag arrives within d, skipping any
// other frame (presence, pings).
func wsSees(conn *websocket.Conn, tag string, d time.Duration) bool {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(deadline)
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return false
		}
		if strings.Contains(string(raw), tag) {
			return true
		}
	}
	return false
}

func isoMust(raw []byte, err error) string {
	if err != nil {
		panic(err)
	}
	return string(raw)
}
