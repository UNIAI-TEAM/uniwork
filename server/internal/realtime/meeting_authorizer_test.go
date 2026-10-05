package realtime

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type countingMeetingGate struct {
	mu    sync.Mutex
	calls int
	allow bool
	err   error
}

func (g *countingMeetingGate) AuthorizeMeetingScope(_ context.Context, _, _, _ string) (bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.calls++
	return g.allow, g.err
}

func (g *countingMeetingGate) count() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.calls
}

func (a *MeetingScopeAuthorizer) size() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.allowed)
}

func newTestMeetingAuthorizer(gate MeetingScopeGate, now *time.Time) *MeetingScopeAuthorizer {
	a := NewMeetingScopeAuthorizer(gate)
	a.now = func() time.Time { return *now }
	return a
}

func TestMeetingScopeAuthorizerReusesAPositiveDecisionUntilItExpires(t *testing.T) {
	gate := &countingMeetingGate{allow: true}
	now := time.Unix(1_700_000_000, 0)
	a := newTestMeetingAuthorizer(gate, &now)
	ctx := context.Background()

	for range 3 {
		ok, err := a.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, "m1")
		if err != nil || !ok {
			t.Fatalf("AuthorizeScope = %v, %v; want true", ok, err)
		}
	}
	if gate.count() != 1 {
		t.Fatalf("gate calls = %d, want 1 (positive decision cached)", gate.count())
	}

	// Another meeting, workspace or user is its own decision.
	_, _ = a.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, "m2")
	_, _ = a.AuthorizeScope(ctx, "u1", "ws2", ScopeMeeting, "m1")
	_, _ = a.AuthorizeScope(ctx, "u2", "ws1", ScopeMeeting, "m1")
	if gate.count() != 4 {
		t.Fatalf("gate calls = %d, want 4", gate.count())
	}

	now = now.Add(meetingScopeTTL + time.Second)
	_, _ = a.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, "m1")
	if gate.count() != 5 {
		t.Fatalf("gate calls = %d, want 5 (expired decision re-asked)", gate.count())
	}
}

func TestMeetingScopeAuthorizerNeverCachesARefusalOrAnError(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	ctx := context.Background()

	refuse := &countingMeetingGate{allow: false}
	a := newTestMeetingAuthorizer(refuse, &now)
	for range 2 {
		if ok, err := a.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, "m1"); ok || err != nil {
			t.Fatalf("AuthorizeScope = %v, %v; want false, nil", ok, err)
		}
	}
	if refuse.count() != 2 {
		t.Fatalf("gate calls = %d, want 2", refuse.count())
	}

	failing := &countingMeetingGate{allow: true, err: errors.New("db down")}
	b := newTestMeetingAuthorizer(failing, &now)
	for range 2 {
		if ok, err := b.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, "m1"); ok || err == nil {
			t.Fatalf("AuthorizeScope = %v, %v; want false and the error", ok, err)
		}
	}
	if failing.count() != 2 {
		t.Fatalf("gate calls = %d, want 2", failing.count())
	}
}

func TestMeetingScopeAuthorizerReleaseForgetsTheDecision(t *testing.T) {
	gate := &countingMeetingGate{allow: true}
	now := time.Unix(1_700_000_000, 0)
	a := newTestMeetingAuthorizer(gate, &now)
	ctx := context.Background()

	_, _ = a.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, "m1")
	a.ReleaseScope("u1", "ws1", ScopeMeeting, "m1")
	_, _ = a.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, "m1")
	if gate.count() != 2 {
		t.Fatalf("gate calls = %d, want 2 (released decision re-asked)", gate.count())
	}
}

func TestMeetingScopeAuthorizerRefusesWithoutAskingOutsideItsScope(t *testing.T) {
	gate := &countingMeetingGate{allow: true}
	now := time.Unix(1_700_000_000, 0)
	a := newTestMeetingAuthorizer(gate, &now)
	ctx := context.Background()

	cases := []struct{ user, ws, scope, id string }{
		{"u1", "ws1", ScopeChat, "m1"},
		{"u1", "", ScopeMeeting, "m1"}, // a lobby socket has no workspace
		{"", "ws1", ScopeMeeting, "m1"},
		{"u1", "ws1", ScopeMeeting, ""},
	}
	for _, c := range cases {
		if ok, err := a.AuthorizeScope(ctx, c.user, c.ws, c.scope, c.id); ok || err != nil {
			t.Errorf("AuthorizeScope(%+v) = %v, %v; want false, nil", c, ok, err)
		}
	}
	if gate.count() != 0 {
		t.Fatalf("gate calls = %d, want 0", gate.count())
	}
	noGate := NewMeetingScopeAuthorizer(nil)
	if ok, _ := noGate.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, "m1"); ok {
		t.Fatal("an authorizer without a gate admitted a subscription")
	}
}

// The cache is bounded: past the cap it stops remembering instead of growing,
// and expired entries make room again.
func TestMeetingScopeAuthorizerCacheIsBounded(t *testing.T) {
	gate := &countingMeetingGate{allow: true}
	now := time.Unix(1_700_000_000, 0)
	a := newTestMeetingAuthorizer(gate, &now)
	a.max = 2
	ctx := context.Background()

	for _, id := range []string{"m1", "m2", "m3"} {
		_, _ = a.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, id)
	}
	if n := a.size(); n != 2 {
		t.Fatalf("cache size = %d, want 2", n)
	}
	now = now.Add(meetingScopeTTL + time.Second)
	_, _ = a.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, "m4")
	if n := a.size(); n != 1 {
		t.Fatalf("cache size after expiry = %d, want 1", n)
	}
}

func TestScopeAuthorizersDispatchByScopeType(t *testing.T) {
	ctx := context.Background()
	auth := ScopeAuthorizers{
		ScopeChat:    allowAllAuthorizer{ok: true},
		ScopeMeeting: allowAllAuthorizer{ok: false},
	}
	if ok, _ := auth.AuthorizeScope(ctx, "u1", "ws1", ScopeChat, "r1"); !ok {
		t.Fatal("chat should follow the chat authorizer")
	}
	if ok, _ := auth.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, "m1"); ok {
		t.Fatal("meeting should follow the meeting authorizer")
	}
	if ok, _ := auth.AuthorizeScope(ctx, "u1", "ws1", ScopeTask, "t1"); ok {
		t.Fatal("a scope with no authorizer must be refused")
	}

	gate := &countingMeetingGate{allow: true}
	meeting := NewMeetingScopeAuthorizer(gate)
	withRelease := ScopeAuthorizers{ScopeMeeting: meeting}
	_, _ = withRelease.AuthorizeScope(ctx, "u1", "ws1", ScopeMeeting, "m1")
	withRelease.ReleaseScope("u1", "ws1", ScopeMeeting, "m1")
	withRelease.ReleaseScope("u1", "ws1", ScopeChat, "r1") // no authorizer: no-op
	if n := meeting.size(); n != 0 {
		t.Fatalf("release did not reach the meeting authorizer, cache size = %d", n)
	}
}
