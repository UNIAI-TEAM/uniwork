package realtime

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// connectAs opens a socket to workspaceID authenticated as id (the test
// parser reads a JSON Identity as the token).
func connectAs(t *testing.T, server *httptest.Server, workspaceID string, id Identity) *websocket.Conn {
	t.Helper()
	token, _ := json.Marshal(id)
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?workspace_id=" + workspaceID
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	auth, _ := json.Marshal(map[string]any{"type": "auth", "payload": map[string]string{"token": string(token)}})
	if err := conn.WriteMessage(websocket.TextMessage, auth); err != nil {
		t.Fatalf("auth: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, ack, err := conn.ReadMessage(); err != nil || !strings.Contains(string(ack), "auth_ack") {
		t.Fatalf("auth_ack = %s, %v", ack, err)
	}
	_ = conn.SetReadDeadline(time.Time{})
	return conn
}

func expectClose(t *testing.T, conn *websocket.Conn, code int) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		_, _, err := conn.ReadMessage()
		if err == nil {
			continue // a keepalive or event that was already queued
		}
		if !websocket.IsCloseError(err, code) {
			t.Fatalf("read = %v, want close code %d", err, code)
		}
		return
	}
}

func hubUsers(hub *Hub) map[string]int {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	out := map[string]int{}
	for c := range hub.clients {
		out[c.userID+"@"+c.workspaceID+"#"+c.sessionID]++
	}
	return out
}

func TestDisconnectUserClosesThatUsersSocketsInOneWorkspace(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()

	gone := connectAs(t, server, "ws-a", Identity{UserID: "u1"})
	connectAs(t, server, "ws-b", Identity{UserID: "u1"})
	connectAs(t, server, "ws-a", Identity{UserID: "u2"})
	waitFor(t, "registration", func() bool { return totalClients(hub) == 3 })

	hub.DisconnectUser("u1", "ws-a")

	expectClose(t, gone, websocket.ClosePolicyViolation)
	waitFor(t, "u1@ws-a unregistered", func() bool { return totalClients(hub) == 2 })
	got := hubUsers(hub)
	if got["u1@ws-b#"] != 1 || got["u2@ws-a#"] != 1 {
		t.Fatalf("remaining sockets = %v", got)
	}
}

func TestDisconnectUserWithoutAWorkspaceClosesEverySocketOfTheUser(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()

	a := connectAs(t, server, "ws-a", Identity{UserID: "u1"})
	b := connectAs(t, server, "ws-b", Identity{UserID: "u1"})
	connectAs(t, server, "ws-a", Identity{UserID: "u2"})
	waitFor(t, "registration", func() bool { return totalClients(hub) == 3 })

	hub.DisconnectUser("u1", "")

	expectClose(t, a, websocket.ClosePolicyViolation)
	expectClose(t, b, websocket.ClosePolicyViolation)
	waitFor(t, "u1 unregistered", func() bool { return totalClients(hub) == 1 })
}

func TestDisconnectSessionClosesOnlyThatSessionWithSessionEnded(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()

	ended := connectAs(t, server, "ws-a", Identity{UserID: "u1", SessionID: "s1"})
	connectAs(t, server, "ws-a", Identity{UserID: "u1", SessionID: "s2"})
	waitFor(t, "registration", func() bool { return totalClients(hub) == 2 })

	hub.DisconnectSession("u1", "s1")

	expectClose(t, ended, CloseSessionEnded)
	waitFor(t, "s1 unregistered", func() bool { return totalClients(hub) == 1 })
	if got := hubUsers(hub); got["u1@ws-a#s2"] != 1 {
		t.Fatalf("remaining sockets = %v", got)
	}

	hub.DisconnectSession("u1", "")
	waitFor(t, "every session closed", func() bool { return totalClients(hub) == 0 })
}

func TestSocketClosesWhenItsAccessTokenExpires(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()

	conn := connectAs(t, server, "ws-a", Identity{UserID: "u1", ExpiresAt: time.Now().Add(300 * time.Millisecond)})
	expectClose(t, conn, CloseSessionEnded)
	waitFor(t, "expired socket unregistered", func() bool { return totalClients(hub) == 0 })
}

func TestRevokeScopeDropsAScopeTheGateNoLongerAllowsEvenWhenCached(t *testing.T) {
	gate := &countingChatGate{allow: true}
	hub := NewHub()
	hub.SetAuthorizer(ScopeAuthorizers{ScopeChat: NewChatScopeAuthorizer(gate)})
	kicked := newDirectHubClient(hub, "u1", "ws1")
	other := newDirectHubClient(hub, "u2", "ws1")
	for _, c := range []*Client{kicked, other} {
		c.handleSubscribe(ScopeChat, "r1")
		assertSubscribeAck(t, c)
	}

	gate.mu.Lock()
	gate.allow = false
	gate.mu.Unlock()
	hub.RevokeScope("u1", ScopeChat, "r1")

	assertSubscribeError(t, kicked, "forbidden")
	if inScopeRoom(hub, kicked, ScopeChat, "r1") {
		t.Fatal("revoked socket still in the room")
	}
	if !inScopeRoom(hub, other, ScopeChat, "r1") {
		t.Fatal("another user's socket was dropped")
	}
	// The 30s grant is gone too: a resubscribe asks the gate again.
	kicked.handleSubscribe(ScopeChat, "r1")
	assertSubscribeError(t, kicked, "forbidden")
}

func TestRevokeScopeKeepsAScopeTheGateStillAllows(t *testing.T) {
	hub := NewHub()
	hub.SetAuthorizer(ScopeAuthorizers{ScopeChat: NewChatScopeAuthorizer(&countingChatGate{allow: true})})
	c := newDirectHubClient(hub, "u1", "ws1")
	c.handleSubscribe(ScopeChat, "r1")
	assertSubscribeAck(t, c)

	// Leaving a public channel: still readable, so the socket keeps hearing it.
	hub.RevokeScope("u1", ScopeChat, "r1")

	if !inScopeRoom(hub, c, ScopeChat, "r1") {
		t.Fatal("a scope the gate still allows was dropped")
	}
	select {
	case raw := <-c.send:
		t.Fatalf("unexpected frame %s", raw)
	default:
	}
}

func TestGrantCacheRevokeForgetsEveryWorkspaceOfTheUser(t *testing.T) {
	g := newGrantCache(time.Minute)
	g.remember(scopeGrantKey{userID: "u1", workspaceID: "ws1", scopeID: "r1"})
	g.remember(scopeGrantKey{userID: "u1", workspaceID: "ws2", scopeID: "r1"})
	g.remember(scopeGrantKey{userID: "u1", workspaceID: "ws1", scopeID: "r2"})
	g.remember(scopeGrantKey{userID: "u2", workspaceID: "ws1", scopeID: "r1"})

	g.RevokeScope("u1", ScopeChat, "r1")
	if g.cached(scopeGrantKey{userID: "u1", workspaceID: "ws1", scopeID: "r1"}) ||
		g.cached(scopeGrantKey{userID: "u1", workspaceID: "ws2", scopeID: "r1"}) {
		t.Fatal("u1's r1 grants survived")
	}
	if !g.cached(scopeGrantKey{userID: "u1", workspaceID: "ws1", scopeID: "r2"}) ||
		!g.cached(scopeGrantKey{userID: "u2", workspaceID: "ws1", scopeID: "r1"}) {
		t.Fatal("unrelated grants were forgotten")
	}

	g.RevokeScope("u1", "", "")
	if g.cached(scopeGrantKey{userID: "u1", workspaceID: "ws1", scopeID: "r2"}) {
		t.Fatal("an empty scope must forget all of the user's grants")
	}
}
