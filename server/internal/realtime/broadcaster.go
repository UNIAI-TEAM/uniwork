package realtime

// Scope types recognised by the broadcaster. Producers and consumers should
// use these constants rather than raw strings so a typo can never silently
// route an event to a non-existent room.
const (
	ScopeWorkspace = "workspace"
	ScopeUser      = "user"
	// ScopeOrganization carries changes that belong to the company rather
	// than to one workspace — the people directory and departments (F-03).
	// Every connection joins it at connect time from the organization that
	// owns its workspace.
	ScopeOrganization = "organization"
	ScopeTask         = "task"
	ScopeChat         = "chat"
	// ScopeMeeting is a member socket that holds one meeting open (its room
	// or its detail page). It is subscribed on request, through the
	// ScopeAuthorizer, and carries the topics the catalogue scopes to the
	// meeting.
	ScopeMeeting = "meeting"
	// ScopeMeetingLobby is a guest's lobby socket, joined at connect time
	// from the meeting the lobby handler admitted it to. It hears only the
	// topics in meetingLobbyEventTypes; nobody subscribes to it by name.
	ScopeMeetingLobby = "meeting_lobby"
)

// Broadcaster is the abstraction every realtime event producer should depend
// on instead of *Hub directly.
//
// Phase 1 (MUL-1138) extends the surface with BroadcastToScope so events can
// be fanned out to high-frequency per-resource scopes (`task:{id}`,
// `chat:{id}`) instead of the whole workspace. The legacy methods continue to
// work and now route through BroadcastToScope under the hood.
type Broadcaster interface {
	// BroadcastToScope fans a message out to every connection currently
	// subscribed to ({scopeType, scopeID}) on this node.
	BroadcastToScope(scopeType, scopeID string, message []byte)

	// BroadcastToWorkspace is a back-compat shortcut for
	// BroadcastToScope("workspace", workspaceID, message).
	BroadcastToWorkspace(workspaceID string, message []byte)

	// SendToUser is a back-compat shortcut for
	// BroadcastToScope("user", userID, message). The optional
	// excludeWorkspace argument is preserved for the `member:added`
	// dedup path: connections whose workspaceID matches excludeWorkspace
	// are skipped.
	SendToUser(userID string, message []byte, excludeWorkspace ...string)

	// Broadcast fans a message out to every connection on this node.
	// Used for events that have no workspace scope.
	Broadcast(message []byte)
}

// Compile-time assertion that *Hub continues to satisfy Broadcaster.
var _ Broadcaster = (*Hub)(nil)
