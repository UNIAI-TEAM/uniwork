package realtime

import (
	"context"
	"time"
)

// ChatScopeGate is implemented by ChatService to authorize chat:{roomId}
// subscriptions without importing the service package into the hub.
type ChatScopeGate interface {
	AuthorizeChatScope(ctx context.Context, userID, workspaceID, roomID string) (bool, error)
}

// chatScopeTTL is how long a positive decision is reused. Every socket
// replays its chat scopes on reconnect, so a deploy or network blip would
// otherwise cost several queries per room per socket. Unlike meetings the
// decision is not released on unsubscribe: it is that replay the cache is
// for. A kick does not wait out the TTL: AccessRevoker's RevokeScope forgets
// the grant and re-asks for every socket holding the room.
const chatScopeTTL = 30 * time.Second

// ChatScopeAuthorizer adapts ChatScopeGate to ScopeAuthorizer and keeps
// positive decisions for chatScopeTTL, keyed by user, workspace and room.
type ChatScopeAuthorizer struct {
	gate ChatScopeGate
	*grantCache
}

// NewChatScopeAuthorizer returns an authorizer asking gate. A nil gate
// refuses every subscription.
func NewChatScopeAuthorizer(gate ChatScopeGate) *ChatScopeAuthorizer {
	return &ChatScopeAuthorizer{gate: gate, grantCache: newGrantCache(chatScopeTTL)}
}

func (a *ChatScopeAuthorizer) AuthorizeScope(
	ctx context.Context, userID, workspaceID, scopeType, scopeID string,
) (bool, error) {
	if a == nil || a.gate == nil || scopeType != ScopeChat {
		return false, nil
	}
	key := scopeGrantKey{userID: userID, workspaceID: workspaceID, scopeID: scopeID}
	return a.authorize(ctx, key, func(ctx context.Context) (bool, error) {
		return a.gate.AuthorizeChatScope(ctx, userID, workspaceID, scopeID)
	})
}
