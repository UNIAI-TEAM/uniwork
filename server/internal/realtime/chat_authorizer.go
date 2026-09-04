package realtime

import "context"

// ChatScopeGate is implemented by ChatService to authorize chat:{roomId}
// subscriptions without importing the service package into the hub.
type ChatScopeGate interface {
	AuthorizeChatScope(ctx context.Context, userID, workspaceID, roomID string) (bool, error)
}

// ChatScopeAuthorizer adapts ChatScopeGate to ScopeAuthorizer.
type ChatScopeAuthorizer struct {
	Gate ChatScopeGate
}

func (a ChatScopeAuthorizer) AuthorizeScope(
	ctx context.Context, userID, workspaceID, scopeType, scopeID string,
) (bool, error) {
	if scopeType != ScopeChat {
		return false, nil
	}
	if a.Gate == nil {
		return false, nil
	}
	return a.Gate.AuthorizeChatScope(ctx, userID, workspaceID, scopeID)
}
