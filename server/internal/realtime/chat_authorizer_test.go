package realtime

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type countingChatGate struct {
	mu    sync.Mutex
	calls int
	allow bool
	err   error
}

func (g *countingChatGate) AuthorizeChatScope(_ context.Context, _, _, _ string) (bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.calls++
	return g.allow, g.err
}

func (g *countingChatGate) count() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.calls
}

func TestChatScopeAuthorizerReusesAPositiveDecisionUntilItExpires(t *testing.T) {
	gate := &countingChatGate{allow: true}
	now := time.Unix(1_700_000_000, 0)
	a := NewChatScopeAuthorizer(gate)
	a.now = func() time.Time { return now }
	ctx := context.Background()

	for range 3 {
		if ok, err := a.AuthorizeScope(ctx, "u1", "ws1", ScopeChat, "r1"); err != nil || !ok {
			t.Fatalf("AuthorizeScope = %v, %v; want true", ok, err)
		}
	}
	if gate.count() != 1 {
		t.Fatalf("gate calls = %d, want 1 (positive decision cached)", gate.count())
	}

	// Another room, workspace or user is its own decision.
	_, _ = a.AuthorizeScope(ctx, "u1", "ws1", ScopeChat, "r2")
	_, _ = a.AuthorizeScope(ctx, "u1", "ws2", ScopeChat, "r1")
	_, _ = a.AuthorizeScope(ctx, "u2", "ws1", ScopeChat, "r1")
	if gate.count() != 4 {
		t.Fatalf("gate calls = %d, want 4", gate.count())
	}

	now = now.Add(chatScopeTTL + time.Second)
	_, _ = a.AuthorizeScope(ctx, "u1", "ws1", ScopeChat, "r1")
	if gate.count() != 5 {
		t.Fatalf("gate calls = %d, want 5 (expired decision re-asked)", gate.count())
	}
}

func TestChatScopeAuthorizerNeverCachesARefusalOrAnError(t *testing.T) {
	ctx := context.Background()
	for _, gate := range []*countingChatGate{{allow: false}, {allow: true, err: errors.New("db down")}} {
		a := NewChatScopeAuthorizer(gate)
		for range 2 {
			if ok, _ := a.AuthorizeScope(ctx, "u1", "ws1", ScopeChat, "r1"); ok {
				t.Fatal("AuthorizeScope = true, want refusal")
			}
		}
		if gate.count() != 2 {
			t.Fatalf("gate calls = %d, want 2 (nothing cached)", gate.count())
		}
	}
}

func TestChatScopeAuthorizerRefusesWithoutAGateOrForAnotherScope(t *testing.T) {
	ctx := context.Background()
	if ok, _ := NewChatScopeAuthorizer(nil).AuthorizeScope(ctx, "u1", "ws1", ScopeChat, "r1"); ok {
		t.Fatal("nil gate admitted a chat scope")
	}
	gate := &countingChatGate{allow: true}
	if ok, _ := NewChatScopeAuthorizer(gate).AuthorizeScope(ctx, "u1", "ws1", ScopeTask, "t1"); ok {
		t.Fatal("chat authorizer admitted a task scope")
	}
	if gate.count() != 0 {
		t.Fatalf("gate calls = %d, want 0", gate.count())
	}
}
