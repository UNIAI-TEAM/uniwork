package sdo

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/files"
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
		"folder_name_taken":            "conflict",
		"document_deleted":             "gone",
		"quota_exceeded":               "quota",
		"forbidden":                    "permission",
		"member_deactivated":           "permission",
		"organization_suspended":       "permission",
		"workspace_seat_required":      "permission",
		"not_meeting_host":             "permission",
		"ai_context_forbidden":         "permission",
		"ai_tool_not_allowed":          "permission",
		"platform_role_insufficient":   "permission",
		"offline_lease_revoked":        "permission",
		"document_restricted":          "permission",
		"break_glass_required":         "permission",
		"not_found":                    "missing",
		"engine_incompatible":          "incompatible",
		"unauthorized":                 "session",
		"invalid_token":                "session",
		"invalid_code":                 "session",
		"device_revoked":               "session",
		"refresh_reused":               "session",
	}
	for code, class := range want {
		if got := ErrorClassFor(code); got != class {
			t.Errorf("ErrorClassFor(%q) = %q, want %q", code, got, class)
		}
	}
	// want is the whole table: a code added to errorClassByCode without a
	// line here (or the reverse) fails.
	if len(want) != len(errorClassByCode) {
		t.Errorf("want has %d codes, errorClassByCode has %d", len(want), len(errorClassByCode))
	}
	for code := range errorClassByCode {
		if _, ok := want[code]; !ok {
			t.Errorf("errorClassByCode has %q, missing from want", code)
		}
	}

	unclassified := []string{
		"internal", "invalid_request", "invalid_json", "invalid_credentials",
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
		// The share refusals of the permission files (addendum section 4):
		// 409 is the work product's call, 422 a bad principal - neither is a
		// permission denial of the caller.
		"document_owned_by_work_product", "principal_not_in_organization",
		// A field validation of the break-glass reason (422, fields
		// min/max/length): the composer renders its own sentence.
		"break_glass_reason_invalid",
		// Count limits with no class on purpose: neither a usage meter nor a
		// conflict to reload (UNI-1641 batch share cap, document link cap).
		"share_batch_too_large", "document_link_limit",
		// The access report export's row cap (UNI-1643, 422 fields.max_rows):
		// the same kind of count limit, the web asks to narrow the filter.
		"access_report_too_large",
	}
	for _, code := range unclassified {
		if got := ErrorClassFor(code); got != "" {
			t.Errorf("ErrorClassFor(%q) = %q, want unclassified", code, got)
		}
	}

	// Every code the document permission / share / break-glass files emit is
	// decided here, classified or unclassified on purpose (addendum G8-18 /
	// DOC-05 section 4), and so is every code of the access report files
	// (UNI-1643), which read through the same gates, and of the file save
	// routes (document_files.go, document_commit.go), which write some codes
	// through the document./files. constants. Only these files are scanned:
	// the rest of the service package predates the rule.
	decided := map[string]bool{}
	for code := range want {
		decided[code] = true
	}
	for _, code := range unclassified {
		decided[code] = true
	}
	found := map[string]bool{}
	for _, name := range []string{
		"document_permissions.go", "document_shares.go", "document_break_glass.go",
		"document_files.go", "document_commit.go",
		"document_access_report.go", "document_access_report_export.go",
	} {
		src, err := os.ReadFile("../../../service/" + name)
		if errors.Is(err, fs.ErrNotExist) && name == "document_break_glass.go" {
			continue // lands with the break-glass routes
		}
		if err != nil {
			t.Fatal(err)
		}
		codes, unknown := permissionFileCodes(string(src))
		for _, ident := range unknown {
			t.Errorf("%s writes a code through %s, which codeConstants cannot resolve; add the constant and the string it holds", name, ident)
		}
		for _, code := range codes {
			found[code] = true
			if !decided[code] {
				t.Errorf("%s emits %q, which is neither in want nor in unclassified", name, code)
			}
		}
	}
	// The first four are literal emissions in the files above; the last two
	// are written only through a Go constant (document.ErrCodeUnsupportedMedia,
	// files.CodeStorageUnavailable), so a scan that stopped at string literals
	// fails here even with the file listed.
	for _, code := range []string{
		"document_restricted", "break_glass_required", "document_owned_by_work_product",
		"access_report_too_large", "unsupported_media_type", "storage_unavailable",
	} {
		if !found[code] {
			t.Errorf("scan did not find %q: the emission pattern changed, update permissionFileCodes", code)
		}
	}
}

var (
	codedErrorLiteral   = regexp.MustCompile(`CodedError\{[^}]*?Code:\s*"([a-z0-9_]+)"`)
	codedHelperCall     = regexp.MustCompile(`\bcoded\([^,()]+,\s*"([a-z0-9_]+)"`)
	codedErrorConstant  = regexp.MustCompile(`CodedError\{[^}]*?Code:\s*([A-Za-z_][A-Za-z0-9_.]*)`)
	codedHelperConstant = regexp.MustCompile(`\bcoded\([^,()]+,\s*([A-Za-z_][A-Za-z0-9_.]*)`)
)

// codeConstants resolves the Go constants the scanned files pass as a code:
// the scan reads source text, so an identifier is only known once it is listed
// here, and the value side is the constant itself, so a change in its declaring
// file cannot drift from this table. An identifier that is not listed fails
// TestErrorClassTable, and the value it resolves to faces the same two-way
// check a literal does.
var codeConstants = map[string]string{
	"document.ErrCodeUnsupportedMedia": document.ErrCodeUnsupportedMedia, // internal/document/file_validation.go
	"files.CodeStorageUnavailable":     files.CodeStorageUnavailable,     // internal/files/errors.go
}

// permissionFileCodes lists the codes a Go source emits through a
// CodedError{Code: ...} field or a coded(status, ...) call: a string literal
// directly, a known constant through codeConstants. unknown lists the
// identifiers codeConstants did not resolve; the caller fails on each.
func permissionFileCodes(src string) (codes, unknown []string) {
	for _, re := range []*regexp.Regexp{codedErrorLiteral, codedHelperCall} {
		for _, m := range re.FindAllStringSubmatch(src, -1) {
			codes = append(codes, m[1])
		}
	}
	for _, re := range []*regexp.Regexp{codedErrorConstant, codedHelperConstant} {
		for _, m := range re.FindAllStringSubmatch(src, -1) {
			if code, ok := codeConstants[m[1]]; ok {
				codes = append(codes, code)
				continue
			}
			unknown = append(unknown, m[1])
		}
	}
	return codes, unknown
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
