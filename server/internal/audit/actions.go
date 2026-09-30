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
	ActionInvitationRevoked  = "invitation.revoked"

	ActionWorkspaceCreated         = "workspace.created"
	ActionWorkspaceUpdated         = "workspace.updated"
	ActionCalendarConnected        = "calendar.connected"
	ActionCalendarSelectionUpdated = "calendar.selection_updated"
	ActionCalendarDisconnected     = "calendar.disconnected"

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

	ActionTaskCommentUpdated     = "task.comment_updated"
	ActionTaskCommentDeleted     = "task.comment_deleted"
	ActionTaskCommentResolved    = "task.comment_resolved"
	ActionTaskCommentUnresolved  = "task.comment_unresolved"
	ActionCommentReactionAdded   = "comment.reaction_added"
	ActionCommentReactionRemoved = "comment.reaction_removed"
	ActionTaskReactionAdded      = "task.reaction_added"
	ActionTaskReactionRemoved    = "task.reaction_removed"
	ActionTaskSubscribed         = "task.subscribed"
	ActionTaskUnsubscribed       = "task.unsubscribed"
	ActionAttachmentUploaded     = "attachment.uploaded"
	ActionAttachmentDeleted      = "attachment.deleted"

	ActionTaskStatusCreated   = "task_status.created"
	ActionTaskStatusUpdated   = "task_status.updated"
	ActionTaskStatusDeleted   = "task_status.deleted"
	ActionTaskLabelCreated    = "task_label.created"
	ActionTaskLabelUpdated    = "task_label.updated"
	ActionTaskLabelDeleted    = "task_label.deleted"
	ActionTaskPropertyCreated = "task_property.created"
	ActionTaskPropertyUpdated = "task_property.updated"

	ActionTaskViewCreated           = "task_view.created"
	ActionTaskViewUpdated           = "task_view.updated"
	ActionTaskViewDeleted           = "task_view.deleted"
	ActionTaskViewPreferenceUpdated = "task_view_preference.updated"
	ActionTaskPinCreated            = "task_pin.created"
	ActionTaskPinDeleted            = "task_pin.deleted"
	ActionTaskPinReordered          = "task_pin.reordered"

	ActionProjectCreated         = "project.created"
	ActionProjectUpdated         = "project.updated"
	ActionProjectDeleted         = "project.deleted"
	ActionProjectResourceCreated = "project_resource.created"
	ActionProjectResourceUpdated = "project_resource.updated"
	ActionProjectResourceDeleted = "project_resource.deleted"

	ActionAuthLoginSucceeded          = "auth.login_succeeded"
	ActionAuthLoginFailed             = "auth.login_failed"
	ActionAuthPasswordResetRequested  = "auth.password_reset_requested"
	ActionAuthPasswordChanged         = "auth.password_changed"
	ActionAuthSessionRevoked          = "auth.session_revoked"
	ActionAuthDesktopStarted          = "auth.desktop_started"
	ActionAuthDesktopConsentApproved  = "auth.desktop_consent_approved"
	ActionAuthDesktopConsentCancelled = "auth.desktop_consent_cancelled"
	ActionAuthDesktopSessionCreated   = "auth.desktop_session_created"
	ActionAuthDesktopTokenRotated     = "auth.desktop_token_rotated"
	ActionAuthDesktopSessionRevoked   = "auth.desktop_session_revoked"
	ActionAuthMFAEnabled              = "auth.mfa_enabled"
	ActionAuthMFADisabled             = "auth.mfa_disabled"
	// The person asked for their account to be erased (Nghị định 13); the
	// row is anonymised and this is the last event that names it (F-01).
	ActionUserDeleted = "user.deleted"

	ActionChatRoomCreated       = "chat.room.created"
	ActionChatRoomMemberAdded   = "chat.room.member_added"
	ActionChatRoomMemberRemoved = "chat.room.member_removed"
	ActionChatChannelUpdated    = "chat.channel.updated"
	ActionChatChannelArchived   = "chat.channel.archived"
	ActionChatMessageLinked     = "chat.message.linked"
	ActionChatMessageUnlinked   = "chat.message.unlinked"
	ActionChatThreadTaskLinked  = "chat.thread.task_linked"
	ActionChatFollowUpCreated   = "chat.follow_up.created"
	ActionChatFollowUpUpdated   = "chat.follow_up.updated"
	ActionChatFollowUpCompleted = "chat.follow_up.completed"
	ActionChatFollowUpDeleted   = "chat.follow_up.deleted"

	ActionSubscriptionChanged = "subscription.changed"

	// Documents (UNI-675): created today through the owner seam
	// (C-01 §13.5); the public page/file commands add their own rows as
	// those lands (G1-04+).
	ActionDocumentCreated = "document.created"
	// G1-03 (UNI-677): a file version committed from a staged upload, a
	// binary restore pointing back to an earlier file, and a page asset.
	ActionDocumentVersionCreated  = "document.version_created"
	ActionDocumentVersionRestored = "document.version_restored"
	ActionDocumentAssetUploaded   = "document.asset_uploaded"

	// Document access (UNI-676): shares and public links on one document,
	// and the organization's public-link switch.
	ActionDocumentShared          = "document.shared"
	ActionDocumentShareRevoked    = "document.share_revoked"
	ActionDocumentLinkCreated     = "document.link_created"
	ActionDocumentLinkRevoked     = "document.link_revoked"
	ActionDocumentSettingsChanged = "document.settings_changed"

	// Document comments + favorites (UNI-681): the document half of the
	// shared comment core. The reaction actions stay document-scoped so
	// the outbox payload carries document_id, not a probed task_id.
	ActionDocumentCommentAdded           = "document.comment_added"
	ActionDocumentCommentUpdated         = "document.comment_updated"
	ActionDocumentCommentDeleted         = "document.comment_deleted"
	ActionDocumentCommentResolved        = "document.comment_resolved"
	ActionDocumentCommentUnresolved      = "document.comment_unresolved"
	ActionDocumentCommentReactionAdded   = "document.comment_reaction_added"
	ActionDocumentCommentReactionRemoved = "document.comment_reaction_removed"
	ActionDocumentFavorited              = "document.favorited"
	ActionDocumentUnfavorited            = "document.unfavorited"

	// Pages (UNI-678, G1-04a): a PATCH of title, icon, visibility or the
	// working copy. Metadata only - the page JSON never reaches audit.
	ActionDocumentUpdated = "document.updated"

	// Document tree and lifecycle (UNI-678, G1-04b): a move, the archive
	// and restore of a batch (one row per affected document, the batch id
	// in metadata), the retention purge of a document and the version
	// compaction sweep of the maintenance worker.
	ActionDocumentMoved             = "document.moved"
	ActionDocumentArchived          = "document.archived"
	ActionDocumentRestored          = "document.restored"
	ActionDocumentDeleted           = "document.deleted"
	ActionDocumentVersionsCompacted = "document.versions_compacted"
	ActionDocumentAssetPurged       = "document.asset_purged"

	// Office launch tickets are document-scoped business capabilities. They
	// intentionally have no outbox event; these rows are the durable audit
	// trail for create, atomic redeem and explicit revoke.
	ActionOfficeLaunchSessionCreated  = "office.launch_session_created"
	ActionOfficeLaunchSessionRedeemed = "office.launch_session_redeemed"
	ActionOfficeLaunchSessionRevoked  = "office.launch_session_revoked"

	// Platform admin (F-11). The actor is a platform_role holder, or "cli"
	// for uniwork-admin; admin_actions carries the reason beside the row.
	ActionOrganizationSuspended   = "organization.suspended"
	ActionOrganizationUnsuspended = "organization.unsuspended"
	ActionPlatformRoleGranted     = "platform_role.granted"
	ActionPlatformRoleRevoked     = "platform_role.revoked"
	ActionFlagOverrideSet         = "flag.override_set"
	ActionFlagOverrideDeleted     = "flag.override_deleted"

	ActionAuditExportRequested = "audit.export_requested"
	ActionAuditExported        = "audit.exported"
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
