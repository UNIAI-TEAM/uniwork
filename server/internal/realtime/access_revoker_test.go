package realtime

import (
	"context"
	"sync"
	"testing"

	"github.com/gorilla/websocket"

	"github.com/unicomhub/uniwork/server/internal/outbox"
)

type recordingInvalidator struct {
	mu    sync.Mutex
	calls []string
}

func (r *recordingInvalidator) Invalidate(_ context.Context, userID, workspaceID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, userID+"@"+workspaceID)
}

func (r *recordingInvalidator) InvalidateUser(_ context.Context, userID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, userID+"@*")
}

func (r *recordingInvalidator) got() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.calls...)
}

// instantRevoker skips the grace a membership disconnect waits in production.
func instantRevoker(hub *Hub, inv MembershipInvalidator) *AccessRevoker {
	r := NewAccessRevoker(hub, inv)
	r.grace = 0
	return r
}

func TestAccessRevokerSubscribesToEveryTopicThatTakesAccessAway(t *testing.T) {
	want := []string{"member.removed", "member.deactivated", "member.left", "chat.room.member_removed", "session.revoked"}
	got := NewAccessRevoker(NewHub(), nil).Topics()
	if len(got) != len(want) {
		t.Fatalf("topics = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("topics = %v, want %v", got, want)
		}
		if _, ok := outbox.Lookup(want[i]); !ok {
			t.Fatalf("%s is not in the catalogue", want[i])
		}
	}
}

func TestAccessRevokerClosesTheRemovedMembersWorkspaceSockets(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()
	gone := connectAs(t, server, "ws-a", Identity{UserID: "u1"})
	connectAs(t, server, "ws-b", Identity{UserID: "u1"})
	waitFor(t, "registration", func() bool { return totalClients(hub) == 2 })
	inv := &recordingInvalidator{}

	err := instantRevoker(hub, inv).Handle(context.Background(), outbox.Row{
		Topic: "member.removed", Payload: `{"organization_id":"o1","workspace_id":"ws-a","user_id":"u1"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	expectClose(t, gone, websocket.ClosePolicyViolation)
	waitFor(t, "ws-a socket unregistered", func() bool { return totalClients(hub) == 1 })
	if got := inv.got(); len(got) != 1 || got[0] != "u1@ws-a" {
		t.Fatalf("invalidated = %v", got)
	}
}

func TestAccessRevokerClosesEverySocketOfADeactivatedOrDepartedMember(t *testing.T) {
	for _, topic := range []string{"member.deactivated", "member.left"} {
		t.Run(topic, func(t *testing.T) {
			hub, server := newTestHub(t)
			defer server.Close()
			a := connectAs(t, server, "ws-a", Identity{UserID: "u1"})
			b := connectAs(t, server, "ws-b", Identity{UserID: "u1"})
			waitFor(t, "registration", func() bool { return totalClients(hub) == 2 })
			inv := &recordingInvalidator{}

			if err := instantRevoker(hub, inv).Handle(context.Background(), outbox.Row{
				Topic: topic, Payload: `{"organization_id":"o1","user_id":"u1"}`,
			}); err != nil {
				t.Fatal(err)
			}
			expectClose(t, a, websocket.ClosePolicyViolation)
			expectClose(t, b, websocket.ClosePolicyViolation)
			if got := inv.got(); len(got) != 1 || got[0] != "u1@*" {
				t.Fatalf("invalidated = %v", got)
			}
		})
	}
}

func TestAccessRevokerEndsTheRevokedSession(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()
	ended := connectAs(t, server, "ws-a", Identity{UserID: "u1", SessionID: "s1"})
	connectAs(t, server, "ws-a", Identity{UserID: "u1", SessionID: "s2"})
	waitFor(t, "registration", func() bool { return totalClients(hub) == 2 })

	if err := instantRevoker(hub, nil).Handle(context.Background(), outbox.Row{
		Topic: "session.revoked", Payload: `{"user_id":"u1","session_id":"s1"}`,
	}); err != nil {
		t.Fatal(err)
	}
	expectClose(t, ended, CloseSessionEnded)
	waitFor(t, "s1 unregistered", func() bool { return totalClients(hub) == 1 })
}

func TestAccessRevokerRechecksTheRoomAMemberWasRemovedFrom(t *testing.T) {
	gate := &countingChatGate{allow: true}
	hub := NewHub()
	hub.SetAuthorizer(ScopeAuthorizers{ScopeChat: NewChatScopeAuthorizer(gate)})
	c := newDirectHubClient(hub, "u1", "ws1")
	c.handleSubscribe(ScopeChat, "r1")
	assertSubscribeAck(t, c)
	gate.mu.Lock()
	gate.allow = false
	gate.mu.Unlock()

	if err := instantRevoker(hub, nil).Handle(context.Background(), outbox.Row{
		Topic: "chat.room.member_removed", Payload: `{"room_id":"r1","user_id":"u1"}`,
	}); err != nil {
		t.Fatal(err)
	}
	assertSubscribeError(t, c, "forbidden")
}

func TestAccessRevokerIgnoresARowWithoutAUser(t *testing.T) {
	if err := instantRevoker(NewHub(), nil).Handle(context.Background(), outbox.Row{
		Topic: "member.left", Payload: `{"organization_id":"o1"}`,
	}); err != nil {
		t.Fatal(err)
	}
}
