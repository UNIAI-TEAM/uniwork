package realtime

import (
	"context"
	"sync"
	"testing"
	"time"
)

// releaseRecorder is a ScopeAuthorizer that also records ReleaseScope calls,
// standing in for the caching MeetingScopeAuthorizer.
type releaseRecorder struct {
	ok       bool
	mu       sync.Mutex
	released []string
}

func (r *releaseRecorder) AuthorizeScope(context.Context, string, string, string, string) (bool, error) {
	return r.ok, nil
}

func (r *releaseRecorder) ReleaseScope(userID, workspaceID, scopeType, scopeID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.released = append(r.released, userID+"/"+workspaceID+"/"+scopeType+":"+scopeID)
}

func (r *releaseRecorder) releases() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.released...)
}

func TestMemberSocketSubscribesToAMeetingTheGateAllows(t *testing.T) {
	hub := NewHub()
	hub.SetAuthorizer(ScopeAuthorizers{ScopeMeeting: allowAllAuthorizer{ok: true}})
	c := newDirectHubClient(hub, "u1", "ws1")

	c.handleSubscribe(ScopeMeeting, "m1")
	assertSubscribeAck(t, c)

	hub.BroadcastToScope(ScopeMeeting, "m1", []byte(`{"type":"chat.message"}`))
	if got := string(recvOrTimeout(t, c.send)); got != `{"type":"chat.message"}` {
		t.Fatalf("frame = %s", got)
	}
}

func TestMemberSocketIsRefusedAMeetingTheGateRefuses(t *testing.T) {
	hub := NewHub()
	hub.SetAuthorizer(ScopeAuthorizers{ScopeMeeting: allowAllAuthorizer{ok: false}})
	c := newDirectHubClient(hub, "u1", "ws1")

	c.handleSubscribe(ScopeMeeting, "m1")
	assertSubscribeError(t, c, "forbidden")
	if hub.HasLocalSubscribers(ScopeMeeting, "m1") {
		t.Fatal("a refused socket joined the meeting scope")
	}
}

// Unlike task and chat, a meeting scope without a wired gate is refused, not
// admitted: the hub fails closed until the server says who may listen.
func TestMeetingScopeFailsClosedWithoutAnAuthorizer(t *testing.T) {
	hub := NewHub()
	c := newDirectHubClient(hub, "u1", "ws1")
	c.handleSubscribe(ScopeMeeting, "m1")
	assertSubscribeError(t, c, "forbidden")

	// A chat-only authorizer has nothing to say about meetings either.
	hub2 := NewHub()
	hub2.SetAuthorizer(NewChatScopeAuthorizer(nil))
	c2 := newDirectHubClient(hub2, "u1", "ws1")
	c2.handleSubscribe(ScopeMeeting, "m1")
	assertSubscribeError(t, c2, "forbidden")
}

// A lobby socket already hears its own meeting's lobby scope; it is not a
// member socket and may not widen that to the members' meeting scope.
func TestLobbySocketCannotSubscribeToTheMembersMeetingScope(t *testing.T) {
	hub := NewHub()
	hub.SetAuthorizer(ScopeAuthorizers{ScopeMeeting: allowAllAuthorizer{ok: true}})
	c := newDirectHubClient(hub, "guest:g1", "")
	c.lobbyMeetingID = "m1"

	c.handleSubscribe(ScopeMeeting, "m1")
	assertSubscribeError(t, c, "forbidden")
}

// Nobody subscribes to a lobby scope by name: lobby sockets join theirs at
// connect time, from the meeting the lobby handler admitted them to.
func TestLobbyScopeIsNotSubscribable(t *testing.T) {
	hub := NewHub()
	hub.SetAuthorizer(ScopeAuthorizers{ScopeMeeting: allowAllAuthorizer{ok: true}})
	c := newDirectHubClient(hub, "u1", "ws1")
	c.handleSubscribe(ScopeMeetingLobby, "m1")
	assertSubscribeError(t, c, "unknown_scope")
}

func TestLobbyClientJoinsTheLobbyScopeOnly(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	c := newLobbyClient(t, hub, "m1", 4)
	if hub.HasLocalSubscribers(ScopeMeeting, "m1") {
		t.Fatal("a lobby socket joined the members' meeting scope")
	}
	if !inScopeRoom(hub, c, ScopeMeetingLobby, "m1") {
		t.Fatal("lobby socket is not in its lobby scope")
	}
}

func TestLeavingAMeetingScopeReleasesTheCachedDecision(t *testing.T) {
	hub := NewHub()
	rec := &releaseRecorder{ok: true}
	hub.SetAuthorizer(rec)
	c := newDirectHubClient(hub, "u1", "ws1")

	c.handleSubscribe(ScopeMeeting, "m1")
	assertSubscribeAck(t, c)
	c.handleUnsubscribe(ScopeMeeting, "m1")
	if got := rec.releases(); len(got) != 1 || got[0] != "u1/ws1/meeting:m1" {
		t.Fatalf("releases after unsubscribe = %v", got)
	}

	// Unsubscribing from a scope the socket never held releases nothing.
	c.handleUnsubscribe(ScopeMeeting, "m-other")
	if got := rec.releases(); len(got) != 1 {
		t.Fatalf("releases after a no-op unsubscribe = %v", got)
	}
}

func TestDisconnectReleasesEveryMeetingScope(t *testing.T) {
	hub := NewHub()
	rec := &releaseRecorder{ok: true}
	hub.SetAuthorizer(rec)
	c := newDirectHubClient(hub, "u1", "ws1")
	c.handleSubscribe(ScopeMeeting, "m1")
	c.handleSubscribe(ScopeMeeting, "m2")
	hub.subscribe(c, ScopeWorkspace, "ws1")

	hub.removeClient(c)

	got := map[string]bool{}
	for _, r := range rec.releases() {
		got[r] = true
	}
	if len(got) != 2 || !got["u1/ws1/meeting:m1"] || !got["u1/ws1/meeting:m2"] {
		t.Fatalf("releases after disconnect = %v, want both meetings and nothing else", rec.releases())
	}
}

func TestEvictingASlowSocketReleasesItsMeetingScopes(t *testing.T) {
	hub := NewHub()
	rec := &releaseRecorder{ok: true}
	hub.SetAuthorizer(rec)
	c := newDirectHubClient(hub, "u1", "ws1")
	c.handleSubscribe(ScopeMeeting, "m1")
	// Fill the send buffer so the next broadcast finds the socket slow.
	for len(c.send) < cap(c.send) {
		c.send <- []byte(`{}`)
	}

	hub.BroadcastToScope(ScopeMeeting, "m1", []byte(`{"type":"x"}`))

	deadline := time.Now().Add(time.Second)
	for len(rec.releases()) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("evicted socket did not release its meeting scope")
		}
		time.Sleep(time.Millisecond)
	}
	if got := rec.releases(); got[0] != "u1/ws1/meeting:m1" {
		t.Fatalf("releases = %v", got)
	}
}

func inScopeRoom(hub *Hub, c *Client, scopeType, scopeID string) bool {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	_, ok := hub.rooms[sk(scopeType, scopeID)][c]
	return ok
}
