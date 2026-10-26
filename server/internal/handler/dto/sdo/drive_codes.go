package sdo

// Google Drive OAuth callback result codes (spec §5.2).
// The popup page posts `{type: "uniwork:drive-oauth", ok: bool, code: string}` to its opener.
const (
	DriveOAuthConnected               = "connected"
	DriveOAuthReconnected             = "reconnected"
	DriveOAuthConsentRequired         = "consent_required"
	DriveOAuthScopeNotGranted         = "scope_not_granted"
	DriveOAuthAccountMismatch         = "account_mismatch"
	DriveOAuthStateInvalid            = "state_invalid"
	DriveOAuthRetryConnect            = "retry_connect"
	DriveOAuthBlockedByWorkspaceAdmin = "blocked_by_workspace_admin"
	DriveOAuthAccessDenied            = "access_denied"
	DriveOAuthProviderError           = "provider_error"
)

// Google Drive connection status values on DriveConnectionDTO (spec §5.2, §5.3).
const (
	DriveConnectionStatusActive         = "active"
	DriveConnectionStatusNeedsReconnect = "needs_reconnect"
)

// Google Drive per-file link outcomes on DriveFileLinkItemDTO (spec §7.2).
const (
	DriveFileLinkOutcomeLinked        = "linked"
	DriveFileLinkOutcomeAlreadyLinked = "already_linked"
	DriveFileLinkOutcomeError         = "error"
)

// Google Drive sharing state values on DriveFileDTO (spec §6.2).
const (
	DriveSharingStatePrivate = "private"
	DriveSharingStateShared  = "shared"
	DriveSharingStateUnknown = "unknown"
)

// Google Drive viewer access state values on DriveFileDTO and DriveTaskFileCardDTO (spec §6.3, §7.3, §7.4).
const (
	DriveViewerAccessGranted        = "granted"
	DriveViewerAccessLost           = "lost"
	DriveViewerAccessUnknown        = "unknown"
	DriveViewerAccessConnectionLost = "connection_lost"
)

// Google Drive assignee access state values on DriveTaskProposalItemDTO (spec §8.2).
const (
	DriveAssigneeAccessGranted = "granted"
	DriveAssigneeAccessUnknown = "unknown"
)

// Google Drive task proposal batch statuses (spec §6.5).
const (
	DriveProposalStatusReady     = "ready"
	DriveProposalStatusConverted = "converted"
	DriveProposalStatusDiscarded = "discarded"
)

// Google Drive API and domain error codes (spec §5.7, §6.3, §7.10, §8.2, §8.3, §8.3a, §8.5, §9, §10).
const (
	DriveErrGrantRequired                = "drive_grant_required"
	DriveErrBlockedByWorkspaceAdmin      = "blocked_by_workspace_admin"
	DriveErrFileNotAccessible            = "drive_file_not_accessible"
	DriveErrUnavailable                  = "drive_unavailable"
	DriveErrAuthFailed                   = "auth_failed"
	DriveErrUseRebind                    = "use_rebind"
	DriveErrAccessRequired               = "drive_access_required"
	DriveErrSourceChanged                = "drive_source_changed"
	DriveErrFormatUnsupported            = "drive_format_unsupported"
	DriveErrExtractUnavailable           = "drive_extract_unavailable"
	DriveErrProposalNotReady             = "proposal_not_ready"
	DriveErrProposalExpired              = "proposal_expired"
	DriveErrProposalItemAlreadyConverted = "proposal_item_already_converted"
	DriveErrActiveDuplicateTask          = "active_duplicate_task"
	DriveErrFeatureDisabled              = "feature_disabled"
)
