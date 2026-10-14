package sdo

import (
	"encoding/json"
	"strings"
	"testing"
)

// The table is the contract of C-01 section 14.5 / DOC-005 section 4: every
// listed code maps to its class, and a code outside the table carries no
// error_class at all.
func TestErrorClassTable(t *testing.T) {
	want := map[string]string{
		"revision_conflict":            "conflict",
		"document_version_conflict":    "conflict",
		"idempotency_payload_mismatch": "conflict",
		"idempotency_key_reuse":        "conflict",
		"idempotency_in_flight":        "conflict",
		"upload_already_committed":     "conflict",
		"copy_consent_required":        "conflict",
		"owner_requires_copy":          "conflict",
		"document_upload_invalid":      "conflict",
		"document_deleted":             "gone",
		"quota_exceeded":               "quota",
		"forbidden":                    "permission",
		"member_deactivated":           "permission",
		"organization_suspended":       "permission",
		"not_meeting_host":             "permission",
		"ai_context_forbidden":         "permission",
		"ai_tool_not_allowed":          "permission",
		"platform_role_insufficient":   "permission",
		"offline_lease_revoked":        "permission",
		"not_found":                    "missing",
		"engine_incompatible":          "incompatible",
		"unauthorized":                 "session",
		"invalid_token":                "session",
		"invalid_code":                 "session",
	}
	for code, class := range want {
		if got := ErrorClassFor(code); got != class {
			t.Errorf("ErrorClassFor(%q) = %q, want %q", code, got, class)
		}
	}

	unclassified := []string{
		"internal", "invalid_request", "invalid_json", "invalid_credentials", "password_incorrect",
		"mfa_code_incorrect", "email_confirmation_mismatch",
		"rate_limited", "conflict", "version_conflict", "last_owner",
		"owner_must_transfer", "invalid_meeting_state", "email_unverified",
		"mfa_required", "feature_disabled", "capability_unavailable",
		"entitlement_required", "subscription_inactive", "checkout_required",
		"idempotency_conflict", "file_not_found", "file_too_large",
		"too_large", "payload_too_large", "unsupported_media_type",
		"storage_unavailable", "ai_quota_exceeded", "ai_rate_limited",
		"email_hub_not_configured", "not_a_code", "",
		// The Office G5/G6 and UniWork AI G6 codes X-03 registers with no class on purpose
		// (contract-p0 section 4): a class here would teach the client the
		// wrong recovery path. commit_intent_unknown stays docs-only until
		// G5-D2 fixes intent retention, so it is checked unclassified too.
		"change_cursor_expired", "change_cursor_invalid", "run_limit_reached",
		"run_expired", "ai_tool_result_too_large", "ai_uniwork_busy",
		"ai_provider_timeout",
		"office_capability_off", "commit_intent_unknown",
		// The offline lease codes of G5-D1 row 15; offline_lease_expired is
		// app-side only and stays unregistered.
		"offline_lease_device_required", "offline_lease_limit_reached",
		"document_archived", "offline_lease_expired",
		// The comment codes with no class on purpose (contract-collab
		// section 9): comment_deleted (409) must not send the composer down
		// the reload path, and anchor_version_invalid (400) is a stale
		// editor anchor, not a conflict to retry blindly.
		"comment_deleted", "anchor_version_invalid",
	}
	for _, code := range unclassified {
		if got := ErrorClassFor(code); got != "" {
			t.Errorf("ErrorClassFor(%q) = %q, want unclassified", code, got)
		}
	}
}

// The wire field is optional: an unclassified code must not emit an
// error_class key, a classified one must emit its class.
func TestNewErrorSDOErrorClassOnWire(t *testing.T) {
	classified, err := json.Marshal(NewErrorSDO("revision_conflict", "x"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(classified), `"error_class":"conflict"`) {
		t.Fatalf("classified body missing error_class: %s", classified)
	}
	plain, err := json.Marshal(NewErrorSDO("invalid_request", "x"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(plain), "error_class") {
		t.Fatalf("unclassified body carries error_class: %s", plain)
	}
}
