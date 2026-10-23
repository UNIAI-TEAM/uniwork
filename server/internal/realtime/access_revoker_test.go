package realtime

import (
	"context"
	"sort"
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
	want := []string{"member.removed", "member.deactivated", "member.left", "chat.room.member_removed", "chat.channel.updated", "session.revoked", "organization.suspended", "organization.closed"}
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

// A suspended organization and a closed one (ADR 0032) end every member's
// access the same way.
func TestAccessRevokerClosesEverySocketOfASuspendedOrganization(t *testing.T) {
	for _, row := range []outbox.Row{
		// The row names one of the organization's owners; every member goes.
		{Topic: "organization.suspended", Payload: `{"organization_id":"o1","user_id":"owner"}`},
		{Topic: "organization.closed", Payload: `{"organization_id":"o1"}`},
	} {
		t.Run(row.Topic, func(t *testing.T) {
			hub, server := newTestHub(t)
			defer server.Close()
			hub.SetOrganizationResolver(func(_ context.Context, workspaceID string) (string, error) {
				if workspaceID == "ws-other" {
					return "o2", nil
				}
				return "o1", nil
			})
			a := connectAs(t, server, "ws-a", Identity{UserID: "u1"})
			b := connectAs(t, server, "ws-b", Identity{UserID: "u2"})
			connectAs(t, server, "ws-other", Identity{UserID: "u1"})
			waitFor(t, "registration", func() bool { return totalClients(hub) == 3 })
			inv := &recordingInvalidator{}

			if err := instantRevoker(hub, inv).Handle(context.Background(), row); err != nil {
				t.Fatal(err)
			}
			expectClose(t, a, websocket.ClosePolicyViolation)
			expectClose(t, b, websocket.ClosePolicyViolation)
			waitFor(t, "o1 sockets unregistered", func() bool { return totalClients(hub) == 1 })
			got := inv.got()
			sort.Strings(got)
			if len(got) != 2 || got[0] != "u1@ws-a" || got[1] != "u2@ws-b" {
				t.Fatalf("invalidated = %v, want the closed sockets' memberships", got)
			}
		})
	}
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

func TestAccessRevokerRechecksEveryHolderOfAnUpdatedChannel(t *testing.T) {
	gate := &countingChatGate{allow: true}
	hub := NewHub()
	hub.SetAuthorizer(ScopeAuthorizers{ScopeChat: NewChatScopeAuthorizer(gate)})
	u1 := newDirectHubClient(hub, "u1", "ws1")
	u2 := newDirectHubClient(hub, "u2", "ws1")
	elsewhere := newDirectHubClient(hub, "u1", "ws1")
	for _, c := range []*Client{u1, u2} {
		c.handleSubscribe(ScopeChat, "r1")
		assertSubscribeAck(t, c)
	}
	elsewhere.handleSubscribe(ScopeChat, "r2")
	assertSubscribeAck(t, elsewhere)
	// The channel went private: the gate now refuses both onlookers.
	gate.mu.Lock()
	gate.allow = false
	gate.mu.Unlock()

	if err := instantRevoker(hub, nil).Handle(context.Background(), outbox.Row{
		Topic: "chat.channel.updated", Payload: `{"room_id":"r1","workspace_id":"ws1"}`,
	}); err != nil {
		t.Fatal(err)
	}
	assertSubscribeError(t, u1, "forbidden")
	assertSubscribeError(t, u2, "forbidden")
	if !inScopeRoom(hub, elsewhere, ScopeChat, "r2") {
		t.Fatal("a socket holding another channel was dropped")
	}
	select {
	case raw := <-elsewhere.send:
		t.Fatalf("unexpected frame %s", raw)
	default:
	}
}

func TestAccessRevokerIgnoresARowWithoutAUser(t *testing.T) {
	if err := instantRevoker(NewHub(), nil).Handle(context.Background(), outbox.Row{
		Topic: "member.left", Payload: `{"organization_id":"o1"}`,
	}); err != nil {
		t.Fatal(err)
	}
}
