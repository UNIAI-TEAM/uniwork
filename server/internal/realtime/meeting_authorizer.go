package realtime

import (
	"context"
	"sync"
	"time"
)

// MeetingScopeGate is implemented by MeetingService to authorize
// meeting:{meetingId} subscriptions from a workspace socket, the way
// ChatScopeGate does for chat rooms.
type MeetingScopeGate interface {
	AuthorizeMeetingScope(ctx context.Context, userID, workspaceID, meetingID string) (bool, error)
}

const (
	// meetingScopeTTL is how long a positive decision is reused. A whole room
	// resubscribes at once after a network blip; within this window that
	// costs no database read. A refusal or a failed lookup is never cached.
	meetingScopeTTL = 30 * time.Second
	// meetingScopeCacheMax bounds the cache. Past it, decisions are simply
	// not remembered until expired entries make room.
	meetingScopeCacheMax = 10_000
)

type meetingGrantKey struct{ userID, workspaceID, meetingID string }

// MeetingScopeAuthorizer adapts MeetingScopeGate to ScopeAuthorizer and keeps
// positive decisions for meetingScopeTTL. A subscription is checked when it
// is made; leaving the scope or disconnecting releases the decision, so the
// next subscription asks the gate again.
type MeetingScopeAuthorizer struct {
	gate MeetingScopeGate
	now  func() time.Time
	max  int

	mu      sync.Mutex
	allowed map[meetingGrantKey]time.Time // expiry
}

// NewMeetingScopeAuthorizer returns an authorizer asking gate. A nil gate
// refuses every subscription.
func NewMeetingScopeAuthorizer(gate MeetingScopeGate) *MeetingScopeAuthorizer {
	return &MeetingScopeAuthorizer{
		gate:    gate,
		now:     time.Now,
		max:     meetingScopeCacheMax,
		allowed: map[meetingGrantKey]time.Time{},
	}
}

// AuthorizeScope answers for ScopeMeeting only. A lobby socket has no
// workspace and is refused here: it hears its meeting on the lobby scope.
func (a *MeetingScopeAuthorizer) AuthorizeScope(
	ctx context.Context, userID, workspaceID, scopeType, scopeID string,
) (bool, error) {
	if a == nil || a.gate == nil || scopeType != ScopeMeeting ||
		userID == "" || workspaceID == "" || scopeID == "" {
		return false, nil
	}
	key := meetingGrantKey{userID: userID, workspaceID: workspaceID, meetingID: scopeID}
	if a.cached(key) {
		return true, nil
	}
	ok, err := a.gate.AuthorizeMeetingScope(ctx, userID, workspaceID, scopeID)
	if err != nil || !ok {
		return false, err
	}
	a.remember(key)
	return true, nil
}

// ReleaseScope forgets the decision for one socket's subscription.
func (a *MeetingScopeAuthorizer) ReleaseScope(userID, workspaceID, scopeType, scopeID string) {
	if a == nil || scopeType != ScopeMeeting {
		return
	}
	a.mu.Lock()
	delete(a.allowed, meetingGrantKey{userID: userID, workspaceID: workspaceID, meetingID: scopeID})
	a.mu.Unlock()
}

func (a *MeetingScopeAuthorizer) cached(key meetingGrantKey) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	exp, ok := a.allowed[key]
	if !ok {
		return false
	}
	if !a.now().Before(exp) {
		delete(a.allowed, key)
		return false
	}
	return true
}

func (a *MeetingScopeAuthorizer) remember(key meetingGrantKey) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	if len(a.allowed) >= a.max {
		for k, exp := range a.allowed {
			if !now.Before(exp) {
				delete(a.allowed, k)
			}
		}
		if len(a.allowed) >= a.max {
			return
		}
	}
	a.allowed[key] = now.Add(meetingScopeTTL)
}
