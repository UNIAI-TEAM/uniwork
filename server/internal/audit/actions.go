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
	// The sole owner closes the organization (ADR 0032): it is archived, not
	// erased, and the owner is free to join or found another.
	ActionOrganizationClosed = "organization.closed"

	// People and departments (F-03). profile.updated covers both the self-edit
	// and the administrator's edit; the row records which company-owned facts
	// changed, never the person's own free text.
	ActionProfileUpdated     = "profile.updated"
	ActionDepartmentCreated  = "department.created"
	ActionDepartmentUpdated  = "department.updated"
	ActionDepartmentArchived = "department.archived"
	ActionPeopleExported     = "people.exported"
	ActionInvitationRevoked  = "invitation.revoked"
	// Shareable membership invite links (UNI-2226): create and revoke only;
	// joining still writes member.joined.
	ActionMembershipInviteLinkCreated = "membership_invite_link.created"
	ActionMembershipInviteLinkRevoked = "membership_invite_link.revoked"

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
	ActionTaskTrashed      = "task.trashed"
	ActionTaskRestored     = "task.restored"
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
	ActionProjectTrashed         = "project.trashed"
	ActionProjectRestored        = "project.restored"
	ActionProjectResourceCreated = "project_resource.created"
	ActionProjectResourceUpdated = "project_resource.updated"
	ActionProjectResourceDeleted = "project_resource.deleted"

	ActionAuthLoginSucceeded         = "auth.login_succeeded"
	ActionAuthLoginFailed            = "auth.login_failed"
	ActionAuthPasswordResetRequested = "auth.password_reset_requested"
	ActionAuthPasswordChanged        = "auth.password_changed"
	// The account's first password (ADR 0049): metadata.via is settings (a
	// step-up, signed in) or reset_token (the set-a-password mail an account
	// without one gets from forgot password). A later one is
	// auth.password_changed, with the same via values.
	ActionAuthPasswordSet             = "auth.password_set"
	ActionAuthSessionRevoked          = "auth.session_revoked"
	ActionAuthDesktopStarted          = "auth.desktop_started"
	ActionAuthDesktopConsentApproved  = "auth.desktop_consent_approved"
	ActionAuthDesktopConsentCancelled = "auth.desktop_consent_cancelled"
	ActionAuthDesktopSessionCreated   = "auth.desktop_session_created"
	ActionAuthDesktopTokenRotated     = "auth.desktop_token_rotated"
	ActionAuthDesktopSessionRevoked   = "auth.desktop_session_revoked"
	ActionAuthMFAEnabled              = "auth.mfa_enabled"
	ActionAuthMFADisabled             = "auth.mfa_disabled"
	// A Google or Apple identity now opens the account (ADR 0049); metadata
	// names the provider and how: email_match, reclaim (the mailbox's owner
	// took back an account registered before the address was proved),
	// ticket (the choice screen's "I already have an account"), email_claim
	// (a code mailed to another address proved it), move (it left an empty
	// account for this one), settings (the owner linked it from Settings,
	// with a step-up).
	ActionAuthSignInMethodLinked = "auth.sign_in_method_linked"
	// A Google or Apple identity no longer opens the account (ADR 0049);
	// metadata names the provider and how: settings (the owner unlinked it,
	// with a step-up), move (the person who proved the identity moved it into
	// another account and this empty one was erased).
	ActionAuthSignInMethodUnlinked = "auth.sign_in_method_unlinked"
	// The person asked for their account to be erased (Nghị định 13); the
	// row is anonymised and this is the last event that names it (F-01).
	ActionUserDeleted = "user.deleted"
	// The person's answer to the AI processing notice UniChat mobile shows
	// before its first AI request (Apple 5.1.2(i)); withdrawing asks again.
	ActionUserAIConsentGranted   = "user.ai_consent_granted"
	ActionUserAIConsentWithdrawn = "user.ai_consent_withdrawn"
	// The person chose whether a chat push shows the message's words on their
	// phones (audit "Security & privacy", push-preview-plaintext).
	ActionUserPushPreviewsChanged = "user.push_previews_changed"

	ActionChatRoomCreated         = "chat.room.created"
	ActionChatRoomMemberAdded     = "chat.room.member_added"
	ActionChatRoomMemberRemoved   = "chat.room.member_removed"
	ActionChatChannelUpdated      = "chat.channel.updated"
	ActionChatChannelArchived     = "chat.channel.archived"
	ActionChatMessageLinked       = "chat.message.linked"
	ActionChatMessageUnlinked     = "chat.message.unlinked"
	ActionChatThreadTaskLinked    = "chat.thread.task_linked"
	ActionChatThreadTaskUnlinked  = "chat.thread.task_unlinked"
	ActionChatFollowUpCreated     = "chat.follow_up.created"
	ActionChatFollowUpUpdated     = "chat.follow_up.updated"
	ActionChatFollowUpCompleted   = "chat.follow_up.completed"
	ActionChatFollowUpDeleted     = "chat.follow_up.deleted"
	ActionChatMessageDeleted      = "chat.message.deleted"
	ActionChatRoomMemberUpdated   = "chat.room.member_updated"
	ActionChatRoomSettingsUpdated = "chat.room.settings_updated"
	ActionChatVoiceCallLogged     = "chat.voice_call.logged"
	ActionChatVoiceTranscribed    = "chat.voice_message.transcribed"
	ActionChatMessageForwarded    = "chat.message.forwarded"
	// A member reported a message or a person (store UGC policy); the
	// organization's owners and admins read it in the audit trail.
	ActionChatReportCreated = "chat.report.created"
	// The platform operator closed a report from the console's queue (store UGC policy: every report
	// is acted on within 24 hours); the organization's owners and admins see that it was handled.
	ActionChatReportResolved = "chat.report.resolved"
	// The platform operator took a reported message down from the console (store UGC policy, Apple 1.2): the
	// message is gone for everyone, as its sender's own deletion would be; the organization sees who and why.
	ActionChatMessageRemoved = "chat.message.removed"

	ActionSubscriptionChanged          = "subscription.changed"
	ActionBillingInvoiceRefunded       = "billing.invoice_refunded"
	ActionBillingInvoiceRefundReverted = "billing.invoice_refund_reverted"

	// Documents (UNI-675): created today through the owner seam
	// (C-01 §13.5); the public page/file commands add their own rows as
	// those lands (G1-04+).
	ActionDocumentCreated = "document.created"
	// G1-03 (UNI-677): a file version committed from a staged upload, a
	// binary restore pointing back to an earlier file, and a page asset.
	ActionDocumentVersionCreated  = "document.version_created"
	ActionDocumentVersionRestored = "document.version_restored"
	ActionDocumentAssetUploaded   = "document.asset_uploaded"
	// G5-07 (UNI-1345): a commit attempt took over a logical intent whose
	// previous attempt's claim expired, fencing that attempt for good.
	ActionDocumentCommitIntentRenewed = "document.commit_intent_renewed"

	// Document access (UNI-676): shares and public links on one document,
	// and the organization's public-link switch.
	ActionDocumentShared       = "document.shared"
	ActionDocumentShareRevoked = "document.share_revoked"
	// Emergency view access for a workspace admin on a restricted document
	// (DOC-05; UNI-1628).
	ActionDocumentBreakGlassGranted = "document.break_glass_granted"
	ActionDocumentBreakGlassRevoked = "document.break_glass_revoked"
	// SH-S1 (UNI-1780): the workspace home row turned on, off or changed
	// level - the (visibility, workspace_level) pair of one document. One row
	// per home-row change, the plain visibility PATCH included; the level of
	// a home row never exceeds edit (Q-S1).
	ActionDocumentWorkspaceAccessChanged = "document.workspace_access_changed"
	ActionDocumentLinkCreated            = "document.link_created"
	ActionDocumentLinkRevoked            = "document.link_revoked"
	ActionDocumentSettingsChanged        = "document.settings_changed"
	// Folder bulk access (UNI-2244 §6): one row per completed bulk access
	// batch (sync in the command's transaction; background when the worker
	// finishes), with the folder as the resource and the outcome counts.
	ActionDocumentContentsAccessUpdated = "document.contents_access_updated"
	// ActionDocumentsAccessReportExported is one access report export
	// (UNI-1643): ids, the filter and counts, never a name.
	ActionDocumentsAccessReportExported = "documents.access_report_exported"
	// ActionDocumentsDownloadJobCreated is one multi-document zip download
	// requested (UNI-2045 SV-9): the job id and the requested document ids, never a title.
	ActionDocumentsDownloadJobCreated = "documents.download_job_created"
	// Folder upload (UNI-2052): one row per PLAN (the batch, its folders and
	// counts, never a filename), per cancel and per sweep expiry. Each folder
	// and document the batch creates also gets its own document.created row.
	ActionDocumentsFolderUploadPlanned  = "documents.folder_upload_planned"
	ActionDocumentsFolderUploadCanceled = "documents.folder_upload_canceled"
	ActionDocumentsFolderUploadExpired  = "documents.folder_upload_expired"

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
	ActionDocumentCommentAnchorsUpdated  = "document.comment_anchors_updated"
	ActionDocumentFavorited              = "document.favorited"
	ActionDocumentUnfavorited            = "document.unfavorited"

	// Pages (UNI-678, G1-04a): a PATCH of title, icon or the working copy.
	// Metadata only - the page JSON never reaches audit. The visibility half
	// of a PATCH moved to document.workspace_access_changed with SH-S1.
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

	// Document edit lock (UNI-1645, addendum §5.1): the one editor of a
	// document. Acquire covers a handover claim and "edit here"; release
	// carries the end reason in metadata (the holder, the sweeper, the
	// consumer, an archive); a take-over is its own row. The heartbeat is
	// never audited. Requests (D3) are created, answered and cancelled.
	ActionDocumentEditLockAcquired    = "document.edit_lock_acquired"
	ActionDocumentEditLockReleased    = "document.edit_lock_released"
	ActionDocumentEditLockTakenOver   = "document.edit_lock_taken_over"
	ActionDocumentEditHoldStarted     = "document.edit_hold_started"
	ActionDocumentEditHoldRenewed     = "document.edit_hold_renewed"
	ActionDocumentEditHoldEnded       = "document.edit_hold_ended"
	ActionDocumentEditRequestCreated  = "document.edit_request_created"
	ActionDocumentEditRequestAnswered = "document.edit_request_answered"
	ActionDocumentEditRequestCanceled = "document.edit_request_cancelled"

	// Shelved state (ARCHIVE-01, UNI-1845): the real archive, kept forever
	// and read-only - "archived" is the trash. One row per document of the
	// batch, the batch id in metadata and in the event payload.
	ActionDocumentShelved   = "document.shelved"
	ActionDocumentUnshelved = "document.unshelved"

	// Templates (UNI-2225): a workspace file marked, or no longer marked, as a
	// template of the workspace's library.
	ActionDocumentTemplateMarked   = "document.template_marked"
	ActionDocumentTemplateUnmarked = "document.template_unmarked"

	// Document access requests (DOC-07, UNI-1631): a person who cannot read a
	// document asked its managers for access. The requester is the actor, the
	// metadata carries the request id, the level and whether a message was
	// sent - never the message text, which lives only in the request row.
	// A manager's answer is its own row: approved carries the granted level and
	// the share it created (absent when the requester was already at the
	// level), declined carries nothing but the request id. The requester is
	// never the actor of either.
	ActionDocumentAccessRequested = "document.access_requested"
	// The manager's answers (w2), plus the cancellation recorded when a pending
	// request closes because the document was archived or the requester is no
	// longer an active member.
	ActionDocumentAccessRequestApproved  = "document.access_request_approved"
	ActionDocumentAccessRequestDeclined  = "document.access_request_declined"
	ActionDocumentAccessRequestCancelled = "document.access_request_cancelled"

	// Document owner transfer (DOC-06, UNI-2084): the ACL owner slot moved to
	// another person. Changes carries acl_owner_id before -> after; metadata
	// carries from_user_id (the previous owner, "" when the slot was empty)
	// and previous_owner_level (edit, comment, view or none); the bulk route
	// adds bulk_id. The previous owner's share is its own document.shared row.
	ActionDocumentOwnerTransferred = "document.owner_transferred"

	// Bulk owner transfer (DOC-06b, UNI-2092): one call of
	// POST /orgs/{org}/members/{userID}/document-ownership moved documents of
	// the member (ResourceID) to to_user_id. Written only when the call moved
	// at least one; each moved document has its own document.owner_transferred
	// row with the same bulk_id. Metadata: bulk_id, to_user_id, transferred,
	// skipped{recipient_not_member, self_restricted}.
	ActionDocumentOwnersBulkTransferred = "document.owners_bulk_transferred"

	// Office launch tickets are document-scoped business capabilities. They
	// intentionally have no outbox event; these rows are the durable audit
	// trail for create, atomic redeem and explicit revoke.
	ActionOfficeLaunchSessionCreated  = "office.launch_session_created"
	ActionOfficeLaunchSessionRedeemed = "office.launch_session_redeemed"
	ActionOfficeLaunchSessionRevoked  = "office.launch_session_revoked"
	ActionOfficeDesktopDownloaded     = "office.desktop_downloaded"

	// Office offline leases (G5-08s, decision G5-D1 row 16): grant, renew,
	// release and revoke of one device's lease on one document, each with an
	// office_lease.* outbox row; a revoke names its reason in metadata. The
	// policy bump is the uniwork-admin org-wide revoke (admin_actions too).
	ActionOfficeOfflineLeaseGranted  = "office.offline_lease_granted"
	ActionOfficeOfflineLeaseRenewed  = "office.offline_lease_renewed"
	ActionOfficeOfflineLeaseReleased = "office.offline_lease_released"
	ActionOfficeOfflineLeaseRevoked  = "office.offline_lease_revoked"
	ActionOfficeOfflinePolicyBumped  = "office.offline_policy_bumped"

	// Saved signatures (UNI-925 B6): a person's reusable signature images,
	// stored server-side. Rows are personal and only the owner's own editor
	// consumes them, so they audit without an outbox event.
	ActionSignatureCreated = "signature.created"
	ActionSignatureDeleted = "signature.deleted"

	// Email Hub (UNI-1237): the owner connects (or reconnects) a mailbox and
	// disconnects one (cache dropped);
	// a mailbox whose provider refused its credential is marked needs-reconnect
	// instead (cache kept), so no node keeps retrying a revoked password.
	ActionEmailHubAccountConnected    = "email_hub_account.connected"
	ActionEmailHubAccountDisconnected = "email_hub_account.disconnected"
	ActionEmailHubAccountAuthFailed   = "email_hub_account.auth_failed"

	// Google Drive connector (UNI-2172, spec §11): the owner connects or
	// reconnects a Google Drive account, a callback is refused for a policy/scope/account
	// mismatch reason, a refresh grant is refused at Google (invalid_grant), or
	// the connection is disconnected (manually or by organization/account lifecycle).
	ActionDriveConnectionConnected      = "drive_connection.connected"
	ActionDriveConnectionReconnected    = "drive_connection.reconnected"
	ActionDriveConnectionRefused        = "drive_connection.refused"
	ActionDriveConnectionAuthFailed     = "drive_connection.auth_failed"
	ActionDriveConnectionDisconnected   = "drive_connection.disconnected"
	ActionDriveFileLinked               = "drive_file.linked"
	ActionDriveFileAccessGranted        = "drive_file.access_granted"
	ActionDriveFileAccessChanged        = "drive_file.access_changed"
	ActionDriveFileAccessLost           = "drive_file.access_lost"
	ActionDriveFileUnlinked             = "drive_file.unlinked"
	ActionDriveFileRebound              = "drive_file.rebound"
	ActionDriveFileRead                 = "drive_file.read"
	ActionTaskDriveFileLinked           = "task.drive_file_linked"
	ActionTaskDriveFileUnlinked         = "task.drive_file_unlinked"
	ActionDriveTaskProposalCreated      = "drive_task_proposal.created"
	ActionDriveTaskProposalDiscarded    = "drive_task_proposal.discarded"
	ActionDriveTaskProposalTasksCreated = "drive_task_proposal.tasks_created"
	ActionDriveFolderNamed              = "drive_folder.named"

	// Platform admin (F-11). The actor is a platform_role holder, or "cli"
	// for uniwork-admin; admin_actions carries the reason beside the row.
	ActionOrganizationSuspended    = "organization.suspended"
	ActionOrganizationUnsuspended  = "organization.unsuspended"
	ActionPlatformRoleGranted      = "platform_role.granted"
	ActionPlatformRoleRevoked      = "platform_role.revoked"
	ActionFlagOverrideSet          = "flag.override_set"
	ActionFlagOverrideDeleted      = "flag.override_deleted"
	ActionPlanCreated              = "plan.created"
	ActionDemoRequestCreated       = "demo_request.created"
	ActionDemoRequestStatusUpdated = "demo_request.status_updated"
	ActionPlanUpdated              = "plan.updated"
	ActionPlanFeatureUpdated       = "plan.feature_updated"

	// An operator closed a desktop device session family on the owner's behalf.
	ActionDesktopDeviceRevoked = "desktop_device.revoked"

	// MCP connector (UNI-1308): consent creates a grant; a person or an org
	// admin revokes it; a replayed code or refresh token closes its family.
	ActionMcpGrantCreated                   = "mcp_grant.created"
	ActionMcpGrantRevoked                   = "mcp_grant.revoked"
	ActionMcpGrantScopeChanged              = "mcp_grant.scope_changed"
	ActionMcpTokenFamilyRevoked             = "mcp_token.family_revoked"
	ActionOrganizationMcpPolicyChanged      = "organization.mcp_policy_changed"
	ActionOrganizationMcpWritePolicyChanged = "organization.mcp_write_policy_changed"
	// An owner or admin hid (or showed again) the message's words in every
	// chat push of the organization (OrganizationService.SetPushPreviewPolicy).
	ActionOrganizationPushPreviewPolicyChanged = "organization.push_preview_policy_changed"
	// An owner or admin required (or stopped requiring) the UniChat app lock or
	// screen-capture blocking on members' phones
	// (OrganizationService.SetMobileSecurityPolicy).
	ActionOrganizationMobileSecurityPolicyChanged = "organization.mobile_security_policy_changed"

	// An organization owner/admin chose which Claude models Ask UNI offers
	// (AskUNIService.SetAskModels).
	ActionOrganizationAskModelsChanged = "organization.ask_models_changed"

	// An organization owner/admin set the highest permission mode Ask UNI may use
	// (AskUNIService.SetAskWritePolicy).
	ActionOrganizationAskWritePolicyChanged = "organization.ask_uni_write_policy_changed"

	// An Ask UNI proposal (agent_action_proposals, ADR 0044) was applied,
	// rejected or undone by the person who asked (AskUNIService). The business
	// command's own row carries metadata.via with the proposal id.
	ActionAIProposalApplied  = "ai_proposal.applied"
	ActionAIProposalRejected = "ai_proposal.rejected"
	ActionAIProposalUndone   = "ai_proposal.undone"

	// Ask UNI memory (P4, AiMemoryService): entries the person keeps. Metadata
	// carries kind, source and length, never the text.
	ActionAIMemoryCreated          = "ai_memory.created"
	ActionAIMemoryUpdated          = "ai_memory.updated"
	ActionAIMemoryDeleted          = "ai_memory.deleted"
	ActionAIMemoryCleared          = "ai_memory.cleared"
	ActionAIMemoryProposalRejected = "ai_memory_proposal.rejected"

	// A cancelled meeting brought back (MeetingService.Restore).
	ActionMeetingRestored = "meeting.restored"

	// The action items of a meeting (UNI-1998). A clerk turned pending items
	// into tasks: one row for the batch, beside the task.created row of each
	// task, metadata action_item_ids and task_ids
	// (MeetingService.ConvertActionItems; replaces meeting_summary.tasks_created).
	// A clerk added an item by hand, dismissed one (changes.reason) or
	// restored a dismissed one.
	ActionMeetingActionItemsConverted = "meeting.action_items_converted"
	ActionMeetingActionItemCreated    = "meeting.action_item_created"
	ActionMeetingActionItemDismissed  = "meeting.action_item_dismissed"
	ActionMeetingActionItemRestored   = "meeting.action_item_restored"
	// A clerk linked a pending item to a task that already exists, instead
	// of creating one (follow-5, MeetingService.LinkActionItem, metadata
	// task_id).
	ActionMeetingActionItemLinked = "meeting.action_item_linked"
	// A clerk took back their own fresh conversion (UNI-2285): one row for
	// the batch, beside the task.deleted row of each task, metadata
	// action_item_ids and task_ids (MeetingService.UndoConvertActionItems).
	ActionMeetingActionItemsUnconverted = "meeting.action_items_unconverted"

	// The minutes of a meeting (UNI-2003): a clerk made the minutes page
	// (MeetingService.CreateMinutes, metadata document_id), finalized it as a
	// document version (FinalizeMinutes, metadata version_id) or reopened it
	// (ReopenMinutes; the version stays in the page's history).
	ActionMeetingMinutesCreated   = "meeting.minutes_created"
	ActionMeetingMinutesFinalized = "meeting.minutes_finalized"
	ActionMeetingMinutesReopened  = "meeting.minutes_reopened"

	// A clerk generated the meeting's AI summary (MeetingService.Summarize),
	// or the system did when the meeting ended (SummarizeAuto, actor
	// system:meeting_auto_summary);
	// metadata names the summary, the usage row that paid for it, and what
	// became of the meeting's action items: replaced_pending, kept,
	// skipped_duplicates.
	ActionMeetingSummaryCreated = "meeting.summary_created"

	// An organization owner/admin switched the summary the system makes when a
	// meeting ends off or back on, or changed the AI scribe policy (MeetingService.SetMeetingSettings,
	// UNI-2026, UNI-1995); changes carry auto_summary_enabled and/or scribe_policy.
	ActionMeetingSettingsChanged = "meeting.settings_changed"

	// A host or admin switched the AI scribe off or back on for one meeting
	// (MeetingService.SetScribe, UNI-2023).
	ActionMeetingScribeToggled = "meeting.scribe_toggled"

	// The host or a clerk shared the meeting's AI content (transcript,
	// summary, evidence, catch-up) with the whole workspace, or took it back
	// to the people of the meeting (MeetingService.SetAIContentShared,
	// UNI-1995 access); changes carry ai_content_shared.
	ActionMeetingAISharingChanged = "meeting.ai_sharing_changed"

	// A clerk marked a participant as the room's shared microphone, or
	// lifted it (MeetingService.SetSharedMic, UNI-2024).
	ActionMeetingSharedMicToggled = "meeting.shared_mic_toggled"

	// A clerk assigned a speaker label to a member or a free name, or
	// cleared it (MeetingService.AssignSpeakerLabel, UNI-2024).
	ActionMeetingSpeakerLabelAssigned = "meeting.speaker_label_assigned"

	// A workspace member added a shared note to a meeting (MeetingService.AddNote,
	// UNI-2153); the body stays out of the row, which names the note by id.
	ActionMeetingNoteAdded = "meeting.note_added"

	// The author or a meeting clerk edited or deleted a shared note
	// (MeetingService.UpdateNote / DeleteNote, UNI-2217); like note_added, the
	// row names the note by id and never carries its text.
	ActionMeetingNoteUpdated = "meeting.note_updated"
	ActionMeetingNoteDeleted = "meeting.note_deleted"

	// A host or admin recorded that a meeting was held without a room:
	// SCHEDULED → ENDED at the reported times (MeetingService.RecordHeld,
	// UNI-2001).
	ActionMeetingHeldRecorded = "meeting.held_recorded"

	// An uploaded meeting recording was queued for transcription (metadata
	// consent_confirmed: the clerk confirmed attendees were told it was
	// recorded), and the job finished or failed for good (UNI-2001).
	ActionMeetingTranscriptionRequested = "meeting.transcription_requested"
	ActionMeetingTranscriptionCompleted = "meeting.transcription_completed"
	ActionMeetingTranscriptionFailed    = "meeting.transcription_failed"
	// A clerk corrected or removed transcript lines, or deleted an uploaded
	// transcription with its recording; the retention sweep removed lines
	// past the organization's window (UNI-1995 #5). Rows say how many lines
	// changed, never what they said.
	ActionMeetingTranscriptSegmentEdited  = "meeting.transcript_segment_edited"
	ActionMeetingTranscriptSegmentDeleted = "meeting.transcript_segment_deleted"
	ActionMeetingTranscriptRangeDeleted   = "meeting.transcript_range_deleted"
	ActionMeetingTranscriptDeleted        = "meeting.transcript_deleted"
	ActionMeetingTranscriptionDeleted     = "meeting.transcription_deleted"
	ActionMeetingTranscriptExpired        = "meeting.transcript_expired"
	// A host or admin, or the server when another meeting holds the PIN,
	// drew a new dial-in PIN (MeetingService.RotateDialInPin, UNI-2029).
	ActionMeetingDialInPinRotated = "meeting.dial_in_pin_rotated"

	ActionAuditExportRequested = "audit.export_requested"
	ActionAuditExported        = "audit.exported"
	ActionAuditRetentionSet    = "audit.retention_set"

	ActionPrivacyExportRequested     = "privacy.export_requested"
	ActionPrivacyExported            = "privacy.exported"
	ActionPrivacyDeletionRequested   = "privacy.deletion_requested"
	ActionPrivacyDeletionCancelled   = "privacy.deletion_cancelled"
	ActionPrivacyOrganizationDeleted = "privacy.organization_deleted"

	// Multipart upload sessions for large files (BIGUP S1-b / UNI-1862).
	ActionDocumentUploadSessionOpened    = "document.upload_session_opened"
	ActionDocumentUploadSessionCompleted = "document.upload_session_completed"
	ActionDocumentUploadSessionAborted   = "document.upload_session_aborted"
	ActionDocumentUploadSessionExpired   = "document.upload_session_expired"
)

// Chat message create and update are deliberately not audited: the volume is
// large and chat_messages already holds the history (OPEN_QUESTIONS A4).

// NoOrganization is the organization_id used for credential events. Logging in
// has no organization context — the user may belong to none, one or several —
// so auth rows are scoped to a sentinel and are visible to platform admins
// only. An org admin sees membership through the member.* actions instead
// (OPEN_QUESTIONS A1).
const NoOrganization = ""
