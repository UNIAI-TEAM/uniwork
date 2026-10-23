package realtime

import (
	"context"
	"time"
)

// MeetingScopeGate is implemented by MeetingService to authorize
// meeting:{meetingId} subscriptions from a workspace socket, the way
// ChatScopeGate does for chat rooms.
type MeetingScopeGate interface {
	AuthorizeMeetingScope(ctx context.Context, userID, workspaceID, meetingID string) (bool, error)
}

// meetingScopeTTL is how long a positive decision is reused. A whole room
// resubscribes at once after a network blip; within this window that costs
// no database read. A refusal or a failed lookup is never cached.
const meetingScopeTTL = 30 * time.Second

// MeetingScopeAuthorizer adapts MeetingScopeGate to ScopeAuthorizer and keeps
// positive decisions for meetingScopeTTL. A subscription is checked when it
// is made; leaving the scope or disconnecting releases the decision, so the
// next subscription asks the gate again.
type MeetingScopeAuthorizer struct {
	gate MeetingScopeGate
	*grantCache
}

// NewMeetingScopeAuthorizer returns an authorizer asking gate. A nil gate
// refuses every subscription.
func NewMeetingScopeAuthorizer(gate MeetingScopeGate) *MeetingScopeAuthorizer {
	return &MeetingScopeAuthorizer{gate: gate, grantCache: newGrantCache(meetingScopeTTL)}
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
	key := scopeGrantKey{userID: userID, workspaceID: workspaceID, scopeID: scopeID}
	return a.authorize(ctx, key, func(ctx context.Context) (bool, error) {
		return a.gate.AuthorizeMeetingScope(ctx, userID, workspaceID, scopeID)
	})
}

// ReleaseScope forgets the decision for one socket's subscription.
func (a *MeetingScopeAuthorizer) ReleaseScope(userID, workspaceID, scopeType, scopeID string) {
	if a == nil || scopeType != ScopeMeeting {
		return
	}
	a.forget(scopeGrantKey{userID: userID, workspaceID: workspaceID, scopeID: scopeID})
}
