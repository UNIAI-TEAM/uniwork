package audit

// The action vocabulary. Every command that changes business state writes one
// of these; server/internal/service/audit_coverage_test.go fails when a name
// here has no command behind it, or when a command listed there writes nothing.
//
// Actions read `<entity>.<verb>`, verb in the past. They are not the same
// vocabulary as outbox topics: an action names what a person did, a topic
// names what other parts of the system must react to. Many pairs happen to
// share a name; that is a coincidence worth keeping, not a rule to enforce.
const (
	ActionOrganizationCreated = "organization.created"
	ActionOrganizationUpdated = "organization.updated"

	ActionMemberInvited     = "member.invited"
	ActionMemberJoined      = "member.joined"
	ActionMemberRoleChanged = "member.role_changed"
	ActionMemberRemoved     = "member.removed"
	// Organization membership lifecycle (F-03). Deactivation is reversible and
	// keeps the row; leaving is voluntary and deletes it. Ownership transfer is
	// its own action because it is the one change that cannot be undone by the
	// person who made it.
	ActionMemberDeactivated            = "member.deactivated"
	ActionMemberReactivated            = "member.reactivated"
	ActionMemberLeft                   = "member.left"
	ActionOrganizationOwnershipChanged = "organization.ownership_transferred"

	// People and departments (F-03). profile.updated covers both the self-edit
	// and the administrator's edit; the row records which company-owned facts
	// changed, never the person's own free text.
	ActionProfileUpdated     = "profile.updated"
	ActionDepartmentCreated  = "department.created"
	ActionDepartmentUpdated  = "department.updated"
	ActionDepartmentArchived = "department.archived"
	ActionPeopleExported     = "people.exported"

	ActionWorkspaceCreated = "workspace.created"
	ActionWorkspaceUpdated = "workspace.updated"

	ActionWorkspaceMemberAdded       = "workspace_member.added"
	ActionWorkspaceMemberRoleChanged = "workspace_member.role_changed"
	ActionWorkspaceMemberRemoved     = "workspace_member.removed"

	ActionAgentCreated        = "agent.created"
	ActionAgentUpdated        = "agent.updated"
	ActionWorkspaceAgentAdded = "workspace_agent.added"

	ActionTaskCreated      = "task.created"
	ActionTaskUpdated      = "task.updated"
	ActionTaskDeleted      = "task.deleted"
	ActionTaskCommentAdded = "task.comment_added"

	ActionAuthLoginSucceeded         = "auth.login_succeeded"
	ActionAuthLoginFailed            = "auth.login_failed"
	ActionAuthPasswordResetRequested = "auth.password_reset_requested"
	ActionAuthPasswordChanged        = "auth.password_changed"
	ActionAuthSessionRevoked         = "auth.session_revoked"

	ActionChatRoomCreated       = "chat.room.created"
	ActionChatRoomMemberAdded   = "chat.room.member_added"
	ActionChatRoomMemberRemoved = "chat.room.member_removed"

	ActionSubscriptionChanged = "subscription.changed"

	// Platform admin (F-11). The actor is a platform_role holder, or "cli"
	// for uniwork-admin; admin_actions carries the reason beside the row.
	ActionOrganizationSuspended   = "organization.suspended"
	ActionOrganizationUnsuspended = "organization.unsuspended"
	ActionPlatformRoleGranted     = "platform_role.granted"
	ActionPlatformRoleRevoked     = "platform_role.revoked"
	ActionFlagOverrideSet         = "flag.override_set"
	ActionFlagOverrideDeleted     = "flag.override_deleted"

	ActionAuditExportRequested = "audit.export_requested"
	ActionAuditRetentionSet    = "audit.retention_set"
)

// Chat message create and update are deliberately not audited: the volume is
// large and chat_messages already holds the history (OPEN_QUESTIONS A4). A
// chat.message.deleted action belongs here the day a delete command exists;
// listing it before then would be a promise the coverage test cannot check.

// NoOrganization is the organization_id used for credential events. Logging in
// has no organization context — the user may belong to none, one or several —
// so auth rows are scoped to a sentinel and are visible to platform admins
// only. An org admin sees membership through the member.* actions instead
// (OPEN_QUESTIONS A1).
const NoOrganization = ""
