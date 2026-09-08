package realtime

import (
	"context"
	"testing"
	"time"
)

type allowAllAuthorizer struct{ ok bool }

func (a allowAllAuthorizer) AuthorizeScope(context.Context, string, string, string, string) (bool, error) {
	return a.ok, nil
}

func newDirectHubClient(hub *Hub, userID, workspaceID string) *Client {
	c := &Client{
		hub:           hub,
		send:          make(chan []byte, 8),
		userID:        userID,
		workspaceID:   workspaceID,
		subscriptions: map[scopeKey]bool{},
	}
	hub.mu.Lock()
	hub.clients[c] = true
	hub.mu.Unlock()
	return c
}

func TestHubUnsubscribeVariants(t *testing.T) {
	hub := NewHub()
	c := newDirectHubClient(hub, "u1", "ws1")

	// Empty scope/id is a no-op.
	if hub.unsubscribe(c, "", "x") {
		t.Fatal("empty scope should not unsubscribe")
	}
	// Unknown client is a no-op.
	outsider := &Client{send: make(chan []byte, 1), subscriptions: map[scopeKey]bool{}}
	if hub.unsubscribe(outsider, ScopeWorkspace, "ws1") {
		t.Fatal("unknown client should not unsubscribe")
	}
	// Not subscribed is a no-op.
	if hub.unsubscribe(c, ScopeWorkspace, "ws1") {
		t.Fatal("unsubscribed client should return false")
	}

	// Subscribe then unsubscribe with callbacks.
	var first, last []scopeKey
	hub.SetSubscriptionCallbacks(
		func(typ, id string) { first = append(first, sk(typ, id)) },
		func(typ, id string) { last = append(last, sk(typ, id)) },
	)
	if !hub.subscribe(c, ScopeTask, "t1") {
		t.Fatal("subscribe failed")
	}
	if len(first) != 1 {
		t.Fatalf("onFirst not fired: %+v", first)
	}
	if !hub.unsubscribe(c, ScopeTask, "t1") {
		t.Fatal("unsubscribe failed")
	}
	if len(last) != 1 || last[0] != sk(ScopeTask, "t1") {
		t.Fatalf("onLast not fired: %+v", last)
	}
	// Second unsubscribe returns false.
	if hub.unsubscribe(c, ScopeTask, "t1") {
		t.Fatal("second unsubscribe should return false")
	}

	// Unsubscribe from a scope whose room vanished is still consistent.
	c2 := newDirectHubClient(hub, "u2", "ws1")
	hub.subscribe(c2, ScopeTask, "t-gone")
	hub.mu.Lock()
	delete(hub.rooms, sk(ScopeTask, "t-gone"))
	hub.mu.Unlock()
	if !hub.unsubscribe(c2, ScopeTask, "t-gone") {
		t.Fatal("unsubscribe with missing room should still return true")
	}
}

func TestHubLocalScopesAndHasLocal(t *testing.T) {
	hub := NewHub()
	if len(hub.LocalScopes()) != 0 {
		t.Fatal("expected no local scopes")
	}
	if hub.HasLocalSubscribers(ScopeWorkspace, "ws1") {
		t.Fatal("expected no subscribers")
	}
	c := newDirectHubClient(hub, "u1", "ws1")
	hub.subscribe(c, ScopeWorkspace, "ws1")
	hub.subscribe(c, ScopeTask, "t1")
	scopes := hub.LocalScopes()
	if len(scopes) != 2 {
		t.Fatalf("LocalScopes = %d", len(scopes))
	}
	if !hub.HasLocalSubscribers(ScopeTask, "t1") {
		t.Fatal("expected task subscriber")
	}
}

func TestHubSendToUserExcludeAndDedup(t *testing.T) {
	hub := NewHub()
	in := &Client{send: make(chan []byte, 4), workspaceID: "ws1", userID: "u1", subscriptions: map[scopeKey]bool{}}
	out := &Client{send: make(chan []byte, 4), workspaceID: "ws-excluded", userID: "u1", subscriptions: map[scopeKey]bool{}}
	hub.mu.Lock()
	hub.clients[in] = true
	hub.clients[out] = true
	hub.rooms[sk(ScopeUser, "u1")] = map[*Client]bool{in: true, out: true}
	in.subscriptions[sk(ScopeUser, "u1")] = true
	out.subscriptions[sk(ScopeUser, "u1")] = true
	hub.mu.Unlock()

	hub.SendToUser("u1", []byte(`{"type":"dm"}`), "ws-excluded")
	select {
	case <-in.send:
	case <-time.After(time.Second):
		t.Fatal("expected delivery to non-excluded connection")
	}
	select {
	case msg := <-out.send:
		t.Fatalf("excluded connection received: %s", msg)
	case <-time.After(20 * time.Millisecond):
	}

	// fanoutUser dedup: same event id delivered once.
	hub.fanoutUser("u1", injectEventID([]byte(`{"type":"dm"}`), "dup-1"), "", "dup-1")
	select {
	case <-in.send:
	case <-time.After(time.Second):
		t.Fatal("expected first dedup delivery")
	}
	hub.fanoutUser("u1", injectEventID([]byte(`{"type":"dm"}`), "dup-1"), "", "dup-1")
	select {
	case msg := <-in.send:
		t.Fatalf("duplicate event delivered: %s", msg)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestHubSnapshotCounts(t *testing.T) {
	hub := NewHub()
	c := newDirectHubClient(hub, "u1", "ws1")
	hub.subscribe(c, ScopeWorkspace, "ws1")
	hub.subscribe(c, ScopeTask, "t1")
	snap := hub.Snapshot()
	if snap["connections"] != 1 {
		t.Fatalf("connections = %v", snap["connections"])
	}
	rooms, ok := snap["rooms"].(map[string]int)
	if !ok {
		t.Fatalf("rooms type = %T", snap["rooms"])
	}
	if rooms[ScopeWorkspace] != 1 || rooms[ScopeTask] != 1 {
		t.Fatalf("rooms = %+v", rooms)
	}
}

func TestClientHandleUnsubscribeAck(t *testing.T) {
	hub := NewHub()
	c := newDirectHubClient(hub, "u1", "ws1")
	hub.subscribe(c, ScopeTask, "t1")
	c.handleUnsubscribe(ScopeTask, "t1")
	select {
	case raw := <-c.send:
		if string(raw) == "" {
			t.Fatal("empty ack")
		}
	case <-time.After(time.Second):
		t.Fatal("expected unsubscribe_ack")
	}
	if hub.HasLocalSubscribers(ScopeTask, "t1") {
		t.Fatal("expected room emptied after unsubscribe")
	}
}

func TestHandleFrameBranches(t *testing.T) {
	newFrameClient := func() (*Hub, *Client) {
		hub := NewHub()
		c := newDirectHubClient(hub, "u1", "ws1")
		return hub, c
	}

	// Invalid JSON is ignored silently.
	_, c := newFrameClient()
	c.handleFrame([]byte(`{bad`))
	select {
	case msg := <-c.send:
		t.Fatalf("invalid json produced reply: %s", msg)
	case <-time.After(20 * time.Millisecond):
	}

	// Invalid subscribe payload.
	_, c2 := newFrameClient()
	c2.handleFrame([]byte(`{"type":"subscribe","payload":{"scope":"","id":""}}`))
	select {
	case <-c2.send:
	case <-time.After(time.Second):
		t.Fatal("expected subscribe_error for invalid payload")
	}

	// Ping produces pong.
	_, c3 := newFrameClient()
	c3.handleFrame([]byte(`{"type":"ping"}`))
	select {
	case <-c3.send:
	case <-time.After(time.Second):
		t.Fatal("expected pong")
	}

	// Unknown frame is ignored.
	_, c4 := newFrameClient()
	c4.handleFrame([]byte(`{"type":"future:thing"}`))
	select {
	case msg := <-c4.send:
		t.Fatalf("unknown frame produced reply: %s", msg)
	case <-time.After(20 * time.Millisecond):
	}

	// Unsubscribe frame dispatches and acks.
	hub5, c5 := newFrameClient()
	hub5.subscribe(c5, ScopeTask, "t1")
	drain := func() {
		for {
			select {
			case <-c5.send:
			default:
				return
			}
		}
	}
	drain()
	c5.handleFrame([]byte(`{"type":"unsubscribe","payload":{"scope":"task","id":"t1"}}`))
	select {
	case <-c5.send:
	case <-time.After(time.Second):
		t.Fatal("expected unsubscribe_ack")
	}
}

func TestHandleSubscribeBranches(t *testing.T) {
	// Workspace mismatch forbidden.
	hub := NewHub()
	c := newDirectHubClient(hub, "u1", "ws1")
	c.handleSubscribe(ScopeWorkspace, "ws-other")
	assertSubscribeError(t, c, "forbidden")

	// Workspace match acks (auto-subscribed identity scope).
	hub2 := NewHub()
	c2 := newDirectHubClient(hub2, "u1", "ws1")
	c2.handleSubscribe(ScopeWorkspace, "ws1")
	assertSubscribeAck(t, c2)

	// User mismatch forbidden, match acks.
	hub3 := NewHub()
	c3 := newDirectHubClient(hub3, "u1", "ws1")
	c3.handleSubscribe(ScopeUser, "u-other")
	assertSubscribeError(t, c3, "forbidden")
	c3.handleSubscribe(ScopeUser, "u1")
	assertSubscribeAck(t, c3)

	// Task without authorizer subscribes directly.
	hub4 := NewHub()
	c4 := newDirectHubClient(hub4, "u1", "ws1")
	c4.handleSubscribe(ScopeTask, "t1")
	assertSubscribeAck(t, c4)

	// Task denied by authorizer.
	hub5 := NewHub()
	hub5.SetAuthorizer(allowAllAuthorizer{ok: false})
	c5 := newDirectHubClient(hub5, "u1", "ws1")
	c5.handleSubscribe(ScopeTask, "t1")
	assertSubscribeError(t, c5, "forbidden")

	// Meeting scope always forbidden.
	hub6 := NewHub()
	c6 := newDirectHubClient(hub6, "u1", "ws1")
	c6.handleSubscribe(ScopeMeeting, "m1")
	assertSubscribeError(t, c6, "forbidden")

	// Unknown scope.
	hub7 := NewHub()
	c7 := newDirectHubClient(hub7, "u1", "ws1")
	c7.handleSubscribe("bogus", "x")
	assertSubscribeError(t, c7, "unknown_scope")
}

func assertSubscribeError(t *testing.T, c *Client, want string) {
	t.Helper()
	select {
	case raw := <-c.send:
		s := string(raw)
		found := false
		if len(s) > 0 && containsStr(s, want) {
			found = true
		}
		if !found {
			t.Fatalf("expected error %q in %s", want, raw)
		}
	case <-time.After(time.Second):
		t.Fatalf("expected subscribe_error %q", want)
	}
}

func assertSubscribeAck(t *testing.T, c *Client) {
	t.Helper()
	select {
	case raw := <-c.send:
		if !containsStr(string(raw), "subscribe_ack") {
			t.Fatalf("expected subscribe_ack, got %s", raw)
		}
	case <-time.After(time.Second):
		t.Fatal("expected subscribe_ack")
	}
}

func containsStr(haystack, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

func TestHubFanoutAllExcludeAndDedup(t *testing.T) {
	hub := NewHub()
	a := &Client{send: make(chan []byte, 4), workspaceID: "ws1", userID: "u1", subscriptions: map[scopeKey]bool{}}
	b := &Client{send: make(chan []byte, 4), workspaceID: "ws-skip", userID: "u2", subscriptions: map[scopeKey]bool{}}
	hub.mu.Lock()
	hub.clients[a] = true
	hub.clients[b] = true
	hub.mu.Unlock()

	hub.fanoutAll([]byte(`{"type":"all"}`), "ws-skip")
	select {
	case <-a.send:
	case <-time.After(time.Second):
		t.Fatal("expected fanoutAll delivery")
	}
	select {
	case msg := <-b.send:
		t.Fatalf("excluded client received: %s", msg)
	case <-time.After(20 * time.Millisecond):
	}

	hub.fanoutAllDedup(injectEventID([]byte(`{"type":"all"}`), "all-1"), "", "all-1")
	select {
	case <-a.send:
	case <-time.After(time.Second):
		t.Fatal("expected first dedup delivery")
	}
	hub.fanoutAllDedup(injectEventID([]byte(`{"type":"all"}`), "all-1"), "", "all-1")
	select {
	case msg := <-a.send:
		t.Fatalf("duplicate global delivered: %s", msg)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestHubSubscribeEdgeCases(t *testing.T) {
	hub := NewHub()
	c := newDirectHubClient(hub, "u1", "ws1")
	if hub.subscribe(c, "", "x") {
		t.Fatal("empty scope type should not subscribe")
	}
	if hub.subscribe(c, ScopeTask, "") {
		t.Fatal("empty scope id should not subscribe")
	}
	// Duplicate subscribe returns false.
	if !hub.subscribe(c, ScopeTask, "t1") {
		t.Fatal("first subscribe should succeed")
	}
	drainOne(c)
	if hub.subscribe(c, ScopeTask, "t1") {
		t.Fatal("duplicate subscribe should return false")
	}
	// BroadcastToScopeDedup with empty scope is a no-op.
	hub.BroadcastToScopeDedup("", "", []byte(`{}`), "")
	hub.BroadcastToScopeDedup(ScopeTask, "", []byte(`{}`), "")
}

func drainOne(c *Client) {
	select {
	case <-c.send:
	default:
	}
}
