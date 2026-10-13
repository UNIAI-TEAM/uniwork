package sdo

// errorClassByCode is the one code -> error_class table (C-01 section 14.5,
// DOC-005 section 4). error_class is a coarse grouping the client switches
// on for its recovery path - keep both revisions on conflict, stop retrying
// on gone, run the session recovery path on session - so it never guesses
// from the HTTP status or the message text. A code absent here emits no
// error_class; no call site invents a class of its own.
var errorClassByCode = map[string]string{
	// conflict: the caller's base revision, idempotency key or upload
	// conflicts with server state. Several entries are emitted only by the
	// Documents endpoints once they ship; they sit here so those handlers
	// classify without touching the table.
	"revision_conflict":            "conflict",
	"document_version_conflict":    "conflict",
	"idempotency_payload_mismatch": "conflict",
	"idempotency_key_reuse":        "conflict",
	"idempotency_in_flight":        "conflict",
	"upload_already_committed":     "conflict",
	"copy_consent_required":        "conflict",
	"owner_requires_copy":          "conflict",
	"document_upload_invalid":      "conflict",

	// gone: the resource is deleted or purged; stop retrying and leave.
	"document_deleted": "gone",

	// quota: a usage limit refused the write; keep the draft and tell the user.
	"quota_exceeded": "quota",

	// permission: an access gate denied the caller. Account preconditions
	// (email_unverified, mfa_required) and billing gates (entitlement_required,
	// subscription_inactive, checkout_required) are deliberately absent -
	// they are not permission denials.
	"forbidden":                  "permission",
	"member_deactivated":         "permission",
	"organization_suspended":     "permission",
	"not_meeting_host":           "permission",
	"ai_context_forbidden":       "permission",
	"ai_tool_not_allowed":        "permission",
	"platform_role_insufficient": "permission",
	// The offline lease is revoked, from an older policy epoch, gone or its
	// signature no longer verifies (G5-D1 row 15): the app drops its
	// committed copy and keeps the locked drafts.
	"offline_lease_revoked": "permission",

	// missing: unknown, or not visible to this actor.
	"not_found": "missing",

	// incompatible: engine/contract/protocol outside the supported range.
	"engine_incompatible": "incompatible",

	// session: the credential presented is expired, consumed or otherwise
	// unusable, so the client runs its session recovery path (refresh,
	// re-login, restart the code/token flow). unauthorized covers both a
	// missing and an invalid/expired bearer; the recovery is the same.
	"unauthorized":   "session",
	"invalid_token":  "session",
	"invalid_code":   "session",
	"device_revoked": "session",
	"refresh_reused": "session",
}

// Deliberately unclassified codes (contract-p0 section 4). Each is
// registered here as a name with NO class, so no later writer adds one by
// reflex; the HTTP status travels with the code at its emission site.
//
//   change_cursor_expired  (410) the feed cursor is older than retention.
//     "gone" would teach the client to stop retrying and leave, which is
//     the opposite of the full resync the feed parser (G5-04) runs on
//     this code, so it must not read as gone.
//   change_cursor_invalid  (400) a forged cursor or one from another
//     scope; the refusal must not reveal the scope it failed against.
//   run_limit_reached      (429) a UniWork AI run limit, unclassified the
//     same way ai_rate_limited is: it is not a quota or permission denial.
//   office_capability_off  (403, fields.capability) a flag hides the
//     capability; it is not a permission denial, so the client must not
//     run its lost-access recovery path (CLAUDE.md > Platform Admin).
//   conversation_expired   (409) the UniWork AI transcript is gone, expired
//     or bound to another scope: the client starts a new conversation
//     instead of retrying this one (G6-03a, contract-p0 section 4).
//   ai_tool_result_too_large (413) one tool result passed the 64 KiB cap, or
//     a request's tool results the 256 KiB one (G6-D1 A6).
//   ai_uniwork_busy        (429, Retry-After: 5) the pod, organization or
//     whole-deployment concurrency bound is full (G6-D1 A11).
//   ai_provider_timeout    (504) the 55 s deadline passed before the
//     upstream answered (G6-D1 A14).
//   offline_lease_device_required (403) an offline lease needs a desktop
//     device session; a browser session asked. Not a lost permission: the
//     same person reads the document online.
//   offline_lease_limit_reached   (409, fields.limit) the device holds the
//     most leases it may (G5-D1 row 11); the user unpins something.
//   document_archived             (403) a renewal on a document in the
//     trash (G5-D1 row 14): the app keeps its copy to the lease's expiry,
//     so it must not read as permission (drop the copy) or gone.
//   offline_lease_expired is an app-side reason only: the server never
//     emits it (G5-D1 row 15), an online renewal re-checks live access.
//   comment_deleted        (409) the target comment is a tombstone (G8-03).
//     "conflict" would send the client down its reload-and-retry path; the
//     composer shows "Bình luận này đã bị xóa." and keeps its draft instead.
//   anchor_version_invalid (400) the anchor's version_id is not this
//     document's (another document, purged or unknown) (G8-04). One body for
//     every case, so the route never confirms a version exists elsewhere;
//     the editor treats its anchor as stale and retries at the next save
//     receipt.
//   commit_intent_unknown  (410, fields.outcome="unknown", plan G5-07) the
//     server holds no commit intent for the key any more (swept after the
//     resume window) or never did. "gone" would teach the client to leave;
//     it must keep reconciling and never read this as not_committed.
//     Registered with the dev retention (G5-07); G5-D2 fixes the number,
//     not the code.

// ErrorClassFor returns the error_class a wire code carries, "" when the code
// is unclassified - the field is then omitted from the envelope.
func ErrorClassFor(code string) string {
	return errorClassByCode[code]
}

// NewErrorSDO builds the envelope every error response shares, resolving
// error_class through the table so no writer re-derives it.
func NewErrorSDO(code, msg string) ErrorSDO {
	return ErrorSDO{Error: ErrorDetail{Code: code, Message: msg, ErrorClass: ErrorClassFor(code)}}
}
