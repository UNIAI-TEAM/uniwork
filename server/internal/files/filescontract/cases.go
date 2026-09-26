package filescontract

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Opaque ids, shaped like the ULIDs the repository stores. The suite never
// parses them; it only needs values from two tenants to prove isolation.
const (
	orgA  = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7D"
	orgB  = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7E"
	wsA   = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7F"
	wsB   = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7G"
	userA = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7H"
	userB = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7J"

	unknownID = files.FileID("01J8ZQ0K7V9W1Y2X3Z4A5B6C7K")
)

// pngBody starts with the PNG signature, so every implementation's sniffer
// verifies it as image/png. textBody is plain text, which an image-only
// purpose must refuse.
var (
	pngBody  = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 48)...)
	webmBody = append([]byte("\x1a\x45\xdf\xa3"), make([]byte, 48)...)
	pdfBody  = []byte("%PDF-1.7\n")
	textBody = []byte("plain text, and not an image")
)

// fixture is one body whose bytes a verifier names as contentType.
type fixture struct {
	body        []byte
	contentType string
}

// fixtures are the bodies the suite can write for any purpose. Each one is a
// type every implementation's verifier names the same way the registry does.
var fixtures = []fixture{
	{pngBody, "image/png"},
	{webmBody, "video/webm"},
	{pdfBody, "application/pdf"},
	{textBody, "text/plain"},
}

func actorA() audit.Actor { return audit.User(userA) }
func actorB() audit.Actor { return audit.User(userB) }

// cases is every behaviour a module may rely on. The order groups purpose and
// scope refusals, then the upload, cancel, claim, resolve, provider and open
// paths.
var cases = []contractCase{
	{"purpose/unknown_is_refused", casePurposeUnknown},
	{"purpose/disabled_is_refused", casePurposeDisabled},
	{"scope/missing_and_extra_tenant_fields_are_refused", caseScopeFields},
	{"upload/ready_result_carries_the_verified_file", caseUploadReady},
	{"upload/checksum_follows_the_policy", caseUploadChecksum},
	{"upload/over_cap_is_refused", caseUploadTooLarge},
	{"upload/disallowed_type_is_refused", caseUploadTypeRejected},
	{"upload/every_allowlisted_type_is_verified_from_the_bytes", caseUploadVerifiedTypes},
	{"upload/filename_never_moves_bytes_to_another_family", caseUploadMisnamed},
	{"upload/purpose_canonical_types_are_stored_and_served", caseUploadCanonicalTypes},
	{"upload/idempotency_replay_returns_the_same_result", caseUploadIdempotentReplay},
	{"upload/idempotency_conflict_on_a_different_command", caseUploadIdempotencyConflict},
	{"upload/replay_after_cancel_does_not_resurrect", caseUploadReplayAfterCancel},
	{"cancel/revokes_a_staged_upload_and_repeats", caseCancelStaged},
	{"cancel/a_claimed_file_is_refused", caseCancelClaimed},
	{"cancel/unknown_foreign_scope_and_foreign_actor_are_not_found", caseCancelNotFound},
	{"claim/ready_file_is_attached_and_reusable", caseClaimReady},
	{"claim/not_ready_file_is_refused", caseClaimNotReady},
	{"claim/window_is_24h_and_claimed_files_ignore_it", caseClaimWindow},
	{"claim/window_closes_exactly_at_the_deadline", caseClaimWindowEdge},
	{"claim/foreign_scope_and_wrong_purpose_are_not_found", caseClaimForeign},
	{"claim/validates_purpose_and_scope_first", caseClaimInputValidation},
	{"claim/rollback_leaves_the_file_staged", caseClaimRollback},
	{"claim/replaces_locks_the_old_file_too", caseClaimReplaces},
	{"release/unknown_id_is_not_found", caseReleaseUnknown},
	{"release/collected_files_are_refused_everywhere", caseCollected},
	{"release/after_collecting_is_a_no_op", caseReleaseAfterCollecting},
	{"resolve/presign_and_proxy_follow_the_policy", caseResolveModes},
	{"resolve/per_id_errors_leave_the_rest_resolved", caseResolvePerIDErrors},
	{"resolve/foreign_tenant_is_not_found", caseResolveForeign},
	{"resolve/mode_must_match_the_policy", caseResolveModeMismatch},
	{"provider/output_intent_is_idempotent_per_operation", caseProviderIntentIdempotent},
	{"provider/write_target_carries_the_object_key_suffix", caseProviderKeySuffix},
	{"provider/completed_output_becomes_a_ready_file", caseProviderComplete},
	{"provider/complete_replays_and_checks_the_operation", caseProviderCompleteReplay},
	{"provider/invalid_output_is_refused", caseProviderInvalidOutput},
	{"provider/output_that_disagrees_with_the_report_is_refused", caseProviderOutputVerification},
	{"provider/storage_unavailable_is_refused_and_recovers", caseStorageUnavailable},
	{"open/reads_bytes_and_range", caseOpen},
}

// --- purpose and scope ------------------------------------------------------

func casePurposeUnknown(t *testing.T, h Harness) {
	ctx := context.Background()
	scope := files.Scope{OrganizationID: orgA, WorkspaceID: wsA}

	for _, purpose := range []files.UploadPurpose{"", "not_a_purpose", "TASK_ATTACHMENT"} {
		_, err := h.Service.Upload(ctx, files.UploadInput{
			Actor: actorA(), Purpose: purpose, Scope: scope,
			IdempotencyKey: "purpose-unknown-" + string(purpose), Filename: "note.png", Body: bytes.NewReader(pngBody),
		})
		requireError(t, err, files.CodePurposeUnknown, http.StatusBadRequest)
	}
	if _, err := h.Registry.Lookup("not_a_purpose"); err == nil {
		t.Error("registry accepted an unknown purpose")
	} else {
		requireError(t, err, files.CodePurposeUnknown, http.StatusBadRequest)
	}

	_, err := claimInTx(t, h, files.ClaimInput{
		Actor: actorA(), Purpose: "", Scope: scope, FileIDs: []files.FileID{unknownID},
	})
	requireError(t, err, files.CodePurposeUnknown, http.StatusBadRequest)

	_, err = h.Service.RegisterProviderOutput(ctx, files.ProviderOutputInput{
		Actor: actorA(), Purpose: "", Scope: scope, OperationID: "op-unknown", Deadline: h.Now().Add(time.Hour),
	})
	requireError(t, err, files.CodePurposeUnknown, http.StatusBadRequest)
}

func casePurposeDisabled(t *testing.T, h Harness) {
	if h.DisabledPurpose == "" {
		t.Skip("this registry enables every purpose, so there is no disabled purpose to refuse")
	}
	spec := specFor(t, h, h.DisabledPurpose)
	if _, err := h.Registry.Lookup(h.DisabledPurpose); err == nil {
		t.Fatal("registry returned a disabled purpose")
	} else {
		requireError(t, err, files.CodePurposeDisabled, http.StatusBadRequest)
	}

	_, err := h.Service.Upload(context.Background(), files.UploadInput{
		Actor: actorA(), Purpose: h.DisabledPurpose, Scope: scopeFor(spec),
		IdempotencyKey: "purpose-disabled", Filename: "note.png", Body: bytes.NewReader(pngBody),
	})
	requireError(t, err, files.CodePurposeDisabled, http.StatusBadRequest)
}

func caseScopeFields(t *testing.T, h Harness) {
	ctx := context.Background()

	userSpec := purposeFor(t, h, files.ScopeUser)
	orgSpec := purposeFor(t, h, files.ScopeOrg)
	wsSpec := purposeFor(t, h, files.ScopeOrgWorkspace)
	optionalSpec := purposeFor(t, h, files.ScopeOrgWorkspaceOptional)

	refused := []struct {
		name  string
		spec  files.PurposeSpec
		scope files.Scope
	}{
		{"user scope without a user", userSpec, files.Scope{}},
		{"user scope with a tenant", userSpec, files.Scope{UserID: userA, OrganizationID: orgA}},
		{"organization scope without an organization", orgSpec, files.Scope{}},
		{"organization scope with a workspace", orgSpec, files.Scope{OrganizationID: orgA, WorkspaceID: wsA}},
		{"workspace scope without a workspace", wsSpec, files.Scope{OrganizationID: orgA}},
		{"workspace scope without an organization", wsSpec, files.Scope{WorkspaceID: wsA}},
		{"optional workspace scope without an organization", optionalSpec, files.Scope{WorkspaceID: wsA}},
	}
	for i, tc := range refused {
		_, err := h.Service.Upload(ctx, files.UploadInput{
			Actor: actorA(), Purpose: tc.spec.Purpose, Scope: tc.scope,
			IdempotencyKey: "scope-invalid-" + string(rune('a'+i)), Filename: "note.png", Body: bytes.NewReader(pngBody),
		})
		if err == nil {
			t.Errorf("%s: upload was accepted", tc.name)
			continue
		}
		requireError(t, err, files.CodeScopeInvalid, http.StatusBadRequest)
	}

	// The same rule holds for the scope a claim declares: a destination scope
	// missing a field the purpose requires is refused before any id is read.
	_, err := claimInTx(t, h, files.ClaimInput{
		Actor: actorA(), Purpose: wsSpec.Purpose, Scope: files.Scope{OrganizationID: orgA},
		FileIDs: []files.FileID{unknownID},
	})
	requireError(t, err, files.CodeScopeInvalid, http.StatusBadRequest)
}

// --- upload -----------------------------------------------------------------

func caseUploadReady(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	rawFilename := "../../etc/pa\x00ss/passwd.png"

	up := uploadOK(t, h, spec, scope, "ready-1", rawFilename, pngBody)

	if up.File.ID == "" {
		t.Error("upload returned no file id")
	}
	if up.UploadSessionID == "" {
		t.Error("upload returned no session id")
	}
	if up.File.Status != files.StatusReady {
		t.Errorf("status = %q, want %q", up.File.Status, files.StatusReady)
	}
	if up.File.SizeBytes != int64(len(pngBody)) {
		t.Errorf("size = %d, want %d", up.File.SizeBytes, len(pngBody))
	}
	if up.File.ContentType != "image/png" {
		t.Errorf("content type = %q, want image/png (verified from the bytes)", up.File.ContentType)
	}
	if got, want := up.File.Filename, files.SanitizeFilename(rawFilename); got != want {
		t.Errorf("filename = %q, want %q", got, want)
	}
	if strings.ContainsAny(up.File.Filename, `/\`+"\x00") || strings.Contains(up.File.Filename, "..") {
		t.Errorf("filename %q still carries a path or a control character", up.File.Filename)
	}
	if want := h.Now().Add(files.ClaimTTL); !up.ClaimExpiresAt.Equal(want) {
		t.Errorf("claim expires at %s, want %s", up.ClaimExpiresAt, want)
	}
	if up.File.ReadyAt.IsZero() || up.File.ReadyAt.After(h.Now()) {
		t.Errorf("ready at %s, want a time at or before now (%s)", up.File.ReadyAt, h.Now())
	}
	if up.File.OrganizationID != scope.OrganizationID {
		t.Errorf("organization = %q, want %q", up.File.OrganizationID, scope.OrganizationID)
	}
}

func caseUploadChecksum(t *testing.T, h Harness) {
	var required, optional files.PurposeSpec
	for _, spec := range h.Registry.Specs() {
		if spec.Disabled || !imageAllowed(spec) {
			continue
		}
		if spec.Policy.ChecksumRequired && required.Purpose == "" {
			required = spec
		}
		if !spec.Policy.ChecksumRequired && optional.Purpose == "" {
			optional = spec
		}
	}
	if required.Purpose == "" {
		t.Skip("no enabled purpose requires a checksum")
	}
	if optional.Purpose == "" {
		t.Skip("no enabled purpose leaves the checksum optional")
	}

	sum := sha256.Sum256(pngBody)
	want := hex.EncodeToString(sum[:])

	withChecksum := uploadOK(t, h, required, scopeFor(required), "checksum-required", "note.png", pngBody)
	if withChecksum.File.ChecksumSHA256 != want {
		t.Errorf("checksum = %q, want %q", withChecksum.File.ChecksumSHA256, want)
	}
	withoutChecksum := uploadOK(t, h, optional, scopeFor(optional), "checksum-optional", "note.png", pngBody)
	if withoutChecksum.File.ChecksumSHA256 != "" {
		t.Errorf("checksum = %q, want none: the policy does not require one (T1-Q2)", withoutChecksum.File.ChecksumSHA256)
	}
}

func caseUploadTooLarge(t *testing.T, h Harness) {
	spec := smallestCap(t, h)
	body := make([]byte, spec.Policy.MaxBytes+1)
	copy(body, pngBody)

	up, err := h.Service.Upload(context.Background(), files.UploadInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scopeFor(spec),
		IdempotencyKey: "too-large", Filename: "big.png", Body: bytes.NewReader(body),
	})
	requireError(t, err, files.CodeTooLarge, http.StatusRequestEntityTooLarge)
	if up.File.ID != "" || !up.ClaimExpiresAt.IsZero() {
		t.Errorf("a refused upload returned a result: %+v", up)
	}

	// Unlike a transient failure, a permanent refusal is the stored result for
	// the key: the same command replayed answers the same file_too_large, and
	// it must come from the record - the replacement body would fail the read
	// if it were re-validated (FS-C1 section 4: same key + same command returns
	// the earlier result).
	up, err = h.Service.Upload(context.Background(), files.UploadInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scopeFor(spec),
		IdempotencyKey: "too-large", Filename: "big.png",
		Body: errReader{err: errors.New("filescontract: the stored refusal must replay without reading")},
	})
	requireError(t, err, files.CodeTooLarge, http.StatusRequestEntityTooLarge)
	if up.File.ID != "" {
		t.Errorf("a replayed refusal returned a result: %+v", up)
	}
}

// caseUploadVerifiedTypes uploads every sample to every open purpose. A type
// the policy allows (after its CanonicalTypes) is stored as that type; any
// other is refused. And
// every allowlist entry of every open purpose must be reached by a sample: a
// registry that lists a type needs a sample that verifies as it, or the entry
// is dead and must go.
func caseUploadVerifiedTypes(t *testing.T, h Harness) {
	uploadSamples(t, h, "verified", Samples(), true)
}

// caseUploadMisnamed uploads bodies whose filename claims another type: the
// verified type stays the bytes' own, so a purpose accepts them only when it
// allows that type (FS-C1 v1 errata).
func caseUploadMisnamed(t *testing.T, h Harness) {
	uploadSamples(t, h, "misnamed", MisnamedSamples(), false)
}

func uploadSamples(t *testing.T, h Harness, keyPrefix string, samples []Sample, requireEveryEntry bool) {
	t.Helper()
	ctx := context.Background()
	reached := map[string]bool{}
	for _, spec := range h.Registry.Specs() {
		if spec.Disabled {
			continue
		}
		for _, sample := range samples {
			if int64(len(sample.Body)) > spec.Policy.MaxBytes {
				continue
			}
			up, err := h.Service.Upload(ctx, files.UploadInput{
				Actor: actorA(), Purpose: spec.Purpose, Scope: scopeFor(spec),
				IdempotencyKey: keyPrefix + "-" + string(spec.Purpose) + "-" + sample.Name,
				Filename:       sample.Filename, Body: bytes.NewReader(sample.Body),
			})
			want := spec.Policy.Canonical(sample.ContentType)
			if !spec.Policy.Allows(want) {
				if err == nil {
					t.Errorf("%s/%s: accepted as %q, want file_type_rejected for %q", spec.Purpose, sample.Name, up.File.ContentType, want)
					continue
				}
				var fe *files.Error
				if !errors.As(err, &fe) || fe.Code != files.CodeTypeRejected {
					t.Errorf("%s/%s: error = %v, want %s", spec.Purpose, sample.Name, err, files.CodeTypeRejected)
				}
				continue
			}
			if err != nil {
				t.Errorf("%s/%s: upload failed: %v", spec.Purpose, sample.Name, err)
				continue
			}
			if up.File.ContentType != want {
				t.Errorf("%s/%s: content type = %q, want %q", spec.Purpose, sample.Name, up.File.ContentType, want)
			}
			reached[string(spec.Purpose)+" "+want] = true
			reached[string(spec.Purpose)+" from "+sample.ContentType] = true
		}
	}
	if !requireEveryEntry {
		return
	}
	for _, spec := range h.Registry.Specs() {
		if spec.Disabled {
			continue
		}
		for _, ct := range spec.Policy.MIMEAllowlist {
			if !reached[string(spec.Purpose)+" "+ct] {
				t.Errorf("purpose %s allows %q but no upload reached it", spec.Purpose, ct)
			}
		}
		for from := range spec.Policy.CanonicalTypes {
			if !reached[string(spec.Purpose)+" from "+from] {
				t.Errorf("purpose %s maps %q but no upload verified as it", spec.Purpose, from)
			}
		}
	}
}

// caseUploadCanonicalTypes pins each purpose-level mapping on its own: a body
// the detector names as the mapping's key is stored, returned and resolved
// as its value, never as the container type (a voice note's WebM stays
// audio/webm, as production serves it today).
func caseUploadCanonicalTypes(t *testing.T, h Harness) {
	ctx := context.Background()
	mapped := 0
	for _, spec := range h.Registry.Specs() {
		if spec.Disabled {
			continue
		}
		for from, to := range spec.Policy.CanonicalTypes {
			sample, ok := sampleVerifiedAs(from)
			if !ok {
				t.Errorf("purpose %s maps %q, which no contract sample verifies as", spec.Purpose, from)
				continue
			}
			if int64(len(sample.Body)) > spec.Policy.MaxBytes {
				continue
			}
			mapped++
			scope := scopeFor(spec)
			up := uploadOK(t, h, spec, scope, "canonical-"+string(spec.Purpose)+"-"+sample.Name, sample.Filename, sample.Body)
			if up.File.ContentType != to {
				t.Errorf("%s: %q uploaded as %q, want %q", spec.Purpose, from, up.File.ContentType, to)
			}
			resolved, err := h.Service.ResolveMany(ctx, files.ResolveInput{
				Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionInline, FileIDs: []files.FileID{up.File.ID},
			})
			if err != nil || len(resolved) != 1 || resolved[0].Err != nil {
				t.Fatalf("%s: resolve = %v, %v", spec.Purpose, resolved, err)
			}
			if resolved[0].File.ContentType != to {
				t.Errorf("%s: %q resolved as %q, want %q", spec.Purpose, from, resolved[0].File.ContentType, to)
			}
		}
	}
	if mapped == 0 {
		t.Skip("no open purpose declares a canonical type")
	}
}

func sampleVerifiedAs(contentType string) (Sample, bool) {
	for _, s := range Samples() {
		if s.ContentType == contentType {
			return s, true
		}
	}
	return Sample{}, false
}

func caseUploadTypeRejected(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, func(spec files.PurposeSpec) bool {
		return !spec.Policy.Allows("text/plain")
	})
	_, err := h.Service.Upload(context.Background(), files.UploadInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scopeFor(spec),
		IdempotencyKey: "type-rejected", Filename: "notes.txt", Body: bytes.NewReader(textBody),
	})
	requireError(t, err, files.CodeTypeRejected, http.StatusUnsupportedMediaType)
}
func caseUploadIdempotentReplay(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)

	first := uploadOK(t, h, spec, scope, "idem-replay", "note.png", pngBody)
	second := uploadOK(t, h, spec, scope, "idem-replay", "note.png", pngBody)

	if first.File.ID != second.File.ID {
		t.Errorf("replay returned file %q, want %q", second.File.ID, first.File.ID)
	}
	if first.UploadSessionID != second.UploadSessionID {
		t.Errorf("replay returned session %q, want %q", second.UploadSessionID, first.UploadSessionID)
	}
	if !first.ClaimExpiresAt.Equal(second.ClaimExpiresAt) {
		t.Errorf("replay moved the claim window to %s, want %s", second.ClaimExpiresAt, first.ClaimExpiresAt)
	}

	// A replay after time has passed still does not extend the window: the
	// client's retry is not a renewal (T1-Q8).
	h.Advance(time.Hour)
	third := uploadOK(t, h, spec, scope, "idem-replay", "note.png", pngBody)
	if !third.ClaimExpiresAt.Equal(first.ClaimExpiresAt) {
		t.Errorf("late replay moved the claim window to %s, want %s", third.ClaimExpiresAt, first.ClaimExpiresAt)
	}

	// A different key is a different logical upload, and therefore a new file.
	other := uploadOK(t, h, spec, scope, "idem-other", "note.png", pngBody)
	if other.File.ID == first.File.ID {
		t.Error("a new idempotency key returned the earlier file")
	}
}

func caseUploadIdempotencyConflict(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	uploadOK(t, h, spec, scope, "idem-conflict", "note.png", pngBody)

	other := purposeFor(t, h, spec.Scope, func(candidate files.PurposeSpec) bool {
		return candidate.Purpose != spec.Purpose
	})

	conflicts := []struct {
		name  string
		input files.UploadInput
	}{
		{"different filename", files.UploadInput{
			Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
			IdempotencyKey: "idem-conflict", Filename: "other.png", Body: bytes.NewReader(pngBody),
		}},
		{"different workspace", files.UploadInput{
			Actor: actorA(), Purpose: spec.Purpose, Scope: files.Scope{OrganizationID: orgA, WorkspaceID: wsB},
			IdempotencyKey: "idem-conflict", Filename: "note.png", Body: bytes.NewReader(pngBody),
		}},
		{"different purpose", files.UploadInput{
			Actor: actorA(), Purpose: other.Purpose, Scope: scope,
			IdempotencyKey: "idem-conflict", Filename: "note.png", Body: bytes.NewReader(pngBody),
		}},
		{"different actor", files.UploadInput{
			Actor: actorB(), Purpose: spec.Purpose, Scope: scope,
			IdempotencyKey: "idem-conflict", Filename: "note.png", Body: bytes.NewReader(pngBody),
		}},
	}
	for _, tc := range conflicts {
		_, err := h.Service.Upload(context.Background(), tc.input)
		if err == nil {
			t.Errorf("%s: the same key with a different command was accepted", tc.name)
			continue
		}
		requireError(t, err, files.CodeIdempotencyConflict, http.StatusConflict)
	}
}

func caseUploadReplayAfterCancel(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	up := uploadOK(t, h, spec, scope, "idem-cancel", "note.png", pngBody)
	if err := h.Service.CancelUpload(context.Background(), files.CancelInput{Actor: actorA(), Scope: scope, FileID: up.File.ID}); err != nil {
		t.Fatalf("cancel: %v", err)
	}

	// The same key, the same command: the session was canceled, and a replay
	// neither resurrects nor extends it (T1-Q8).
	_, err := h.Service.Upload(context.Background(), files.UploadInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
		IdempotencyKey: "idem-cancel", Filename: "note.png", Body: bytes.NewReader(pngBody),
	})
	requireError(t, err, files.CodeUploadCanceled, http.StatusConflict)
}

// --- cancel -----------------------------------------------------------------

func caseCancelStaged(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	up := uploadOK(t, h, spec, scope, "cancel-staged", "note.png", pngBody)
	ctx := context.Background()
	in := files.CancelInput{Actor: actorA(), Scope: scope, FileID: up.File.ID}

	if err := h.Service.CancelUpload(ctx, in); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	// Repeating the cancel answers the same nothing (FS-C1 section 4).
	if err := h.Service.CancelUpload(ctx, in); err != nil {
		t.Fatalf("repeated cancel: %v", err)
	}

	_, err := claimInTx(t, h, files.ClaimInput{Actor: actorA(), Purpose: spec.Purpose, Scope: scope, FileIDs: []files.FileID{up.File.ID}})
	requireError(t, err, files.CodeUploadCanceled, http.StatusConflict)

	// The cancel revokes the read grant too, so no URL is handed out; the
	// contract does not fix which refusal a canceled session answers on read.
	got := resolveOK(t, h, files.ResolveInput{Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionInline, FileIDs: []files.FileID{up.File.ID}})
	if len(got) != 1 {
		t.Fatalf("resolved %d entries, want 1", len(got))
	}
	if got[0].Err == nil {
		t.Error("a canceled session still resolved")
	}
	if got[0].URL != "" {
		t.Errorf("a canceled session returned URL %q", got[0].URL)
	}
}

func caseCancelClaimed(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	up := uploadOK(t, h, spec, scope, "cancel-claimed", "note.png", pngBody)
	claimOK(t, h, spec, scope, up.File.ID)

	err := h.Service.CancelUpload(context.Background(), files.CancelInput{Actor: actorA(), Scope: scope, FileID: up.File.ID})
	requireError(t, err, files.CodeAlreadyClaimed, http.StatusConflict)

	// The refusal is not a deletion: the module still holds the file.
	resolved := resolveOK(t, h, files.ResolveInput{Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionInline, FileIDs: []files.FileID{up.File.ID}})
	if len(resolved) != 1 || resolved[0].Err != nil {
		t.Fatalf("a claimed file stopped resolving after a refused cancel: %+v", resolved)
	}
}

func caseCancelNotFound(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	up := uploadOK(t, h, spec, scope, "cancel-not-found", "note.png", pngBody)
	ctx := context.Background()

	err := h.Service.CancelUpload(ctx, files.CancelInput{Actor: actorA(), Scope: scope, FileID: unknownID})
	requireError(t, err, files.CodeNotFound, http.StatusNotFound)

	err = h.Service.CancelUpload(ctx, files.CancelInput{
		Actor: actorA(), Scope: files.Scope{OrganizationID: orgB, WorkspaceID: wsA}, FileID: up.File.ID,
	})
	requireError(t, err, files.CodeNotFound, http.StatusNotFound)

	// Cancel verifies the actor too (FS-C1 sections 4 and 5.1), and says "not found"
	// rather than confirming the file exists.
	err = h.Service.CancelUpload(ctx, files.CancelInput{Actor: actorB(), Scope: scope, FileID: up.File.ID})
	requireError(t, err, files.CodeNotFound, http.StatusNotFound)
}

// --- claim ------------------------------------------------------------------

func caseClaimReady(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	up := uploadOK(t, h, spec, scope, "claim-ready", "note.png", pngBody)

	claimed := claimOK(t, h, spec, scope, up.File.ID)
	if len(claimed) != 1 {
		t.Fatalf("claimed %d files, want 1", len(claimed))
	}
	if claimed[0].ID != up.File.ID {
		t.Errorf("claimed %q, want %q", claimed[0].ID, up.File.ID)
	}
	if claimed[0].Filename != up.File.Filename || claimed[0].SizeBytes != up.File.SizeBytes {
		t.Errorf("claimed view %+v does not match the upload result %+v", claimed[0], up.File)
	}

	// A file may be referenced by more than one business row in the same
	// tenant (T1-Q3), so attaching it again is allowed - which is also what
	// makes a retried save safe.
	again := claimOK(t, h, spec, scope, up.File.ID)
	if len(again) != 1 || again[0].ID != up.File.ID {
		t.Errorf("second claim returned %+v, want the same file", again)
	}
}

func caseClaimNotReady(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	out := registerOK(t, h, spec, scope, "op-not-ready")

	_, err := claimInTx(t, h, files.ClaimInput{Actor: actorA(), Purpose: spec.Purpose, Scope: scope, FileIDs: []files.FileID{out.FileID}})
	requireError(t, err, files.CodeNotReady, http.StatusConflict)

	got := resolveOK(t, h, files.ResolveInput{Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionInline, FileIDs: []files.FileID{out.FileID}})
	if len(got) != 1 || got[0].Err == nil {
		t.Fatalf("a file with no verified bytes resolved: %+v", got)
	}
	requireError(t, got[0].Err, files.CodeNotReady, http.StatusConflict)
}

func caseClaimWindow(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)

	inside := uploadOK(t, h, spec, scope, "window-inside", "note.png", pngBody)
	expired := uploadOK(t, h, spec, scope, "window-expired", "note.png", pngBody)

	// Just inside the window the claim still attaches the file.
	h.Advance(files.ClaimTTL - time.Minute)
	claimOK(t, h, spec, scope, inside.File.ID)
	h.Advance(2 * time.Minute)

	// The unclaimed file is past its window and cannot be attached any more.
	_, err := claimInTx(t, h, files.ClaimInput{Actor: actorA(), Purpose: spec.Purpose, Scope: scope, FileIDs: []files.FileID{expired.File.ID}})
	requireError(t, err, files.CodeClaimExpired, http.StatusConflict)

	// A claimed file is past the window for good: the deadline belongs to the
	// staged session, not to the file (T1-Q5), so it still attaches and reads.
	claimOK(t, h, spec, scope, inside.File.ID)
	kept := resolveOK(t, h, files.ResolveInput{Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionInline, FileIDs: []files.FileID{inside.File.ID}})
	if len(kept) != 1 || kept[0].Err != nil {
		t.Fatalf("a claimed file stopped resolving after its session window closed: %+v", kept)
	}

	// A new URL is refused through the same session.
	got := resolveOK(t, h, files.ResolveInput{Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionInline, FileIDs: []files.FileID{expired.File.ID}})
	if len(got) != 1 || got[0].Err == nil {
		t.Fatalf("an expired session resolved: %+v", got)
	}
	if got[0].URL != "" {
		t.Errorf("an expired session returned URL %q", got[0].URL)
	}

	// An expired session is never resurrected by a replay either (T1-Q8): the
	// same upload key + command answers claim_expired instead of the stale
	// result or a fresh window.
	_, err = h.Service.Upload(context.Background(), files.UploadInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
		IdempotencyKey: "window-expired", Filename: "note.png", Body: bytes.NewReader(pngBody),
	})
	requireError(t, err, files.CodeClaimExpired, http.StatusConflict)
}

// caseClaimWindowEdge pins the exact instant: the window is open one tick
// before ClaimExpiresAt and closed at it (T1-Q5), for claim and for a fresh
// read grant alike, so a module test on the fake and the real service agree.
func caseClaimWindowEdge(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)

	before := uploadOK(t, h, spec, scope, "edge-before", "note.png", pngBody)
	at := uploadOK(t, h, spec, scope, "edge-at", "note.png", pngBody)
	if !before.ClaimExpiresAt.Equal(at.ClaimExpiresAt) {
		t.Fatalf("uploads at one instant got deadlines %s and %s", before.ClaimExpiresAt, at.ClaimExpiresAt)
	}

	// One microsecond - the database's precision - before the deadline.
	h.Advance(before.ClaimExpiresAt.Sub(h.Now()) - time.Microsecond)
	claimOK(t, h, spec, scope, before.File.ID)

	h.Advance(time.Microsecond)
	if !h.Now().Equal(at.ClaimExpiresAt) {
		t.Fatalf("clock at %s, want exactly the deadline %s", h.Now(), at.ClaimExpiresAt)
	}
	_, err := claimInTx(t, h, files.ClaimInput{Actor: actorA(), Purpose: spec.Purpose, Scope: scope, FileIDs: []files.FileID{at.File.ID}})
	requireError(t, err, files.CodeClaimExpired, http.StatusConflict)

	got := resolveOK(t, h, files.ResolveInput{Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionInline, FileIDs: []files.FileID{at.File.ID}})
	if len(got) != 1 || got[0].Err == nil || got[0].URL != "" {
		t.Fatalf("a session at its deadline still resolved: %+v", got)
	}
	requireError(t, got[0].Err, files.CodeClaimExpired, http.StatusConflict)
}

func caseClaimForeign(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	up := uploadOK(t, h, spec, scope, "claim-foreign", "note.png", pngBody)

	_, err := claimInTx(t, h, files.ClaimInput{
		Actor: actorA(), Purpose: spec.Purpose,
		Scope:   files.Scope{OrganizationID: orgB, WorkspaceID: wsA},
		FileIDs: []files.FileID{up.File.ID},
	})
	requireError(t, err, files.CodeNotFound, http.StatusNotFound)

	other := purposeFor(t, h, spec.Scope, func(candidate files.PurposeSpec) bool {
		return candidate.Purpose != spec.Purpose
	})
	_, err = claimInTx(t, h, files.ClaimInput{Actor: actorA(), Purpose: other.Purpose, Scope: scope, FileIDs: []files.FileID{up.File.ID}})
	requireError(t, err, files.CodeNotFound, http.StatusNotFound)
}

func caseClaimInputValidation(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)

	_, err := claimInTx(t, h, files.ClaimInput{
		Actor: actorA(), Purpose: "", Scope: files.Scope{OrganizationID: orgA, WorkspaceID: wsA},
		FileIDs: []files.FileID{unknownID},
	})
	requireError(t, err, files.CodePurposeUnknown, http.StatusBadRequest)

	_, err = claimInTx(t, h, files.ClaimInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: files.Scope{},
		FileIDs: []files.FileID{unknownID},
	})
	requireError(t, err, files.CodeScopeInvalid, http.StatusBadRequest)
}

func caseClaimRollback(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	up := uploadOK(t, h, spec, scope, "claim-rollback", "note.png", pngBody)

	// The module claims the file and then fails its own command: the claim
	// rolls back with the transaction, so the file is still staged and the user
	// can save again (FS-C1 section 4).
	rollback := errors.New("filescontract: module command failed after the claim")
	err := h.InTx(t, func(q *db.Queries) error {
		if _, err := h.Service.ClaimInTx(context.Background(), q, files.ClaimInput{
			Actor: actorA(), Purpose: spec.Purpose, Scope: scope, FileIDs: []files.FileID{up.File.ID},
		}); err != nil {
			return err
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("transaction returned %v, want the module's own failure", err)
	}

	claimOK(t, h, spec, scope, up.File.ID)
}

// caseClaimReplaces pins ClaimInput.Replaces, the field a version replace sets
// so old and new rows are locked in one order (FS-C1 section 4). The replaced
// ids are validated in the claim's own scope and a bad one refuses the whole
// batch; locking the old file never drops it - unlinking stays the module's
// own release command.
func caseClaimReplaces(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)

	old := uploadOK(t, h, spec, scope, "replaces-old", "old.png", pngBody)
	claimOK(t, h, spec, scope, old.File.ID)
	replacement := uploadOK(t, h, spec, scope, "replaces-new", "new.png", pngBody)

	claimed, err := claimInTx(t, h, files.ClaimInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
		FileIDs:  []files.FileID{replacement.File.ID},
		Replaces: []files.FileID{old.File.ID},
	})
	if err != nil {
		t.Fatalf("claim with Replaces: %v", err)
	}
	if len(claimed) != 1 || claimed[0].ID != replacement.File.ID {
		t.Fatalf("claim with Replaces returned %+v, want the new file", claimed)
	}
	kept := resolveOK(t, h, files.ResolveInput{
		Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionInline,
		FileIDs: []files.FileID{old.File.ID},
	})
	if len(kept) != 1 || kept[0].Err != nil {
		t.Fatalf("the replaced file stopped resolving: %+v", kept)
	}

	// An unknown Replaces id and one from another tenant are both
	// file_not_found (section 5.1), and each refused claim attaches nothing:
	// the new file is still staged and claims on its own afterwards.
	for _, tc := range []struct {
		name  string
		oldID files.FileID
	}{
		{"unknown id", unknownID},
		{"foreign tenant", uploadOK(t, h, spec, files.Scope{OrganizationID: orgB, WorkspaceID: wsB}, "replaces-foreign", "note.png", pngBody).File.ID},
	} {
		fresh := uploadOK(t, h, spec, scope, "replaces-fresh-"+tc.name, "note.png", pngBody)
		_, err := claimInTx(t, h, files.ClaimInput{
			Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
			FileIDs:  []files.FileID{fresh.File.ID},
			Replaces: []files.FileID{tc.oldID},
		})
		requireError(t, err, files.CodeNotFound, http.StatusNotFound)
		claimOK(t, h, spec, scope, fresh.File.ID)
	}

	if h.SimulateGC != nil {
		// The race the field exists for: the old file passed the collector's
		// barrier between the module's read and its save, so the swap is
		// file_deleting instead of locking a file that is already going away.
		gone := uploadOK(t, h, spec, scope, "replaces-gone", "gone.png", pngBody)
		claimOK(t, h, spec, scope, gone.File.ID)
		if err := releaseInTx(t, h, []files.FileID{gone.File.ID}); err != nil {
			t.Fatalf("release: %v", err)
		}
		h.SimulateGC(t, gone.File.ID)

		fresh := uploadOK(t, h, spec, scope, "replaces-fresh-gone", "note.png", pngBody)
		_, err := claimInTx(t, h, files.ClaimInput{
			Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
			FileIDs:  []files.FileID{fresh.File.ID},
			Replaces: []files.FileID{gone.File.ID},
		})
		requireError(t, err, files.CodeDeleting, http.StatusConflict)
		claimOK(t, h, spec, scope, fresh.File.ID)
	}
}

func caseReleaseUnknown(t *testing.T, h Harness) {
	err := releaseInTx(t, h, []files.FileID{unknownID})
	requireError(t, err, files.CodeNotFound, http.StatusNotFound)
}

func caseCollected(t *testing.T, h Harness) {
	if h.SimulateGC == nil {
		t.Skip("this implementation cannot force the collector's barrier")
	}
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	up := uploadOK(t, h, spec, scope, "collected", "note.png", pngBody)
	claimOK(t, h, spec, scope, up.File.ID)
	if err := releaseInTx(t, h, []files.FileID{up.File.ID}); err != nil {
		t.Fatalf("release: %v", err)
	}
	h.SimulateGC(t, up.File.ID)

	// Once the collector has committed deleting, nothing attaches or serves the
	// file again (FS-C1 section 7, file_deleting).
	_, err := claimInTx(t, h, files.ClaimInput{Actor: actorA(), Purpose: spec.Purpose, Scope: scope, FileIDs: []files.FileID{up.File.ID}})
	requireError(t, err, files.CodeDeleting, http.StatusConflict)

	err = h.Service.CancelUpload(context.Background(), files.CancelInput{Actor: actorA(), Scope: scope, FileID: up.File.ID})
	requireError(t, err, files.CodeDeleting, http.StatusConflict)

	got := resolveOK(t, h, files.ResolveInput{Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionInline, FileIDs: []files.FileID{up.File.ID}})
	if len(got) != 1 {
		t.Fatalf("resolved %d entries, want 1", len(got))
	}
	requireError(t, got[0].Err, files.CodeDeleting, http.StatusConflict)

	if _, err := h.Service.Open(context.Background(), files.OpenInput{Scope: scope, FileID: up.File.ID}); err == nil {
		t.Error("a file being deleted was readable")
	} else {
		requireError(t, err, files.CodeDeleting, http.StatusConflict)
	}
}

// caseReleaseAfterCollecting pins the unlink that races the collector: the
// module drops its reference in its own transaction at the same time the
// collector has already committed deleting, and that late release must not
// fail the transaction - the collector already owns the file (FS-C1 section 7,
// file_deleting). A second release also never resurrects the file: it stays deleting.
func caseReleaseAfterCollecting(t *testing.T, h Harness) {
	if h.SimulateGC == nil {
		t.Skip("this implementation cannot force the collector's barrier")
	}
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	up := uploadOK(t, h, spec, scope, "release-collecting", "note.png", pngBody)
	claimOK(t, h, spec, scope, up.File.ID)
	if err := releaseInTx(t, h, []files.FileID{up.File.ID}); err != nil {
		t.Fatalf("release: %v", err)
	}
	h.SimulateGC(t, up.File.ID)

	if err := releaseInTx(t, h, []files.FileID{up.File.ID}); err != nil {
		t.Errorf("an unlink after the collector took the file returned %v, want no error", err)
	}
	got := resolveOK(t, h, files.ResolveInput{Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionInline, FileIDs: []files.FileID{up.File.ID}})
	if len(got) != 1 {
		t.Fatalf("resolved %d entries, want 1", len(got))
	}
	requireError(t, got[0].Err, files.CodeDeleting, http.StatusConflict)
}

// --- resolve ----------------------------------------------------------------

func caseResolveModes(t *testing.T, h Harness) {
	presign := purposeFor(t, h, files.ScopeOrgWorkspace, func(spec files.PurposeSpec) bool {
		return spec.Policy.ReadMode == files.ReadPresign && sampleAllowed(spec)
	})
	proxy := purposeFor(t, h, files.ScopeOrgWorkspace, func(spec files.PurposeSpec) bool {
		return spec.Policy.ReadMode == files.ReadProxy && sampleAllowed(spec)
	})

	for _, spec := range []files.PurposeSpec{presign, proxy} {
		scope := scopeFor(spec)
		body, _ := sampleFor(t, spec)
		up := uploadOK(t, h, spec, scope, "resolve-"+string(spec.Purpose), "note.png", body)
		claimOK(t, h, spec, scope, up.File.ID)

		got := resolveOK(t, h, files.ResolveInput{
			Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionAttachment,
			FileIDs: []files.FileID{up.File.ID},
		})
		if len(got) != 1 || got[0].Err != nil {
			t.Fatalf("%s: resolve returned %+v", spec.Purpose, got)
		}
		if got[0].File.ID != up.File.ID {
			t.Errorf("%s: resolved %q, want %q", spec.Purpose, got[0].File.ID, up.File.ID)
		}
		switch spec.Policy.ReadMode {
		case files.ReadPresign:
			if got[0].URL == "" {
				t.Error("presign mode returned no URL")
			}
			if got[0].URLExpiresAt.IsZero() {
				t.Error("presign mode returned no expiry")
			}
			if limit := h.Now().Add(files.MaxResolveURLTTL); got[0].URLExpiresAt.After(limit) {
				t.Errorf("URL expires at %s, past the %s limit", got[0].URLExpiresAt, limit)
			}
		case files.ReadProxy:
			if got[0].URL != "" {
				t.Errorf("proxy mode returned URL %q, want none: the module serves it through Open", got[0].URL)
			}
			if !got[0].URLExpiresAt.IsZero() {
				t.Errorf("proxy mode returned URL expiry %s, want none", got[0].URLExpiresAt)
			}
		}
	}
}

func caseResolvePerIDErrors(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)

	good := uploadOK(t, h, spec, scope, "resolve-mixed", "note.png", pngBody)
	claimOK(t, h, spec, scope, good.File.ID)
	pending := registerOK(t, h, spec, scope, "op-resolve-mixed")

	got := resolveOK(t, h, files.ResolveInput{
		Scope: scope, Mode: spec.Policy.ReadMode, Disposition: files.DispositionInline,
		FileIDs: []files.FileID{unknownID, good.File.ID, pending.FileID},
	})
	if len(got) != 3 {
		t.Fatalf("resolved %d entries, want one per id", len(got))
	}
	requireError(t, got[0].Err, files.CodeNotFound, http.StatusNotFound)
	if got[1].Err != nil {
		t.Errorf("the ready file was refused: %v", got[1].Err)
	}
	if got[1].File.ID != good.File.ID {
		t.Errorf("middle entry is %q, want %q: results follow the requested order", got[1].File.ID, good.File.ID)
	}
	requireError(t, got[2].Err, files.CodeNotReady, http.StatusConflict)
}

func caseResolveForeign(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	up := uploadOK(t, h, spec, scope, "resolve-foreign", "note.png", pngBody)

	got := resolveOK(t, h, files.ResolveInput{
		Scope: files.Scope{OrganizationID: orgB, WorkspaceID: wsA}, Mode: spec.Policy.ReadMode,
		Disposition: files.DispositionInline, FileIDs: []files.FileID{up.File.ID},
	})
	if len(got) != 1 {
		t.Fatalf("resolved %d entries, want 1", len(got))
	}
	requireError(t, got[0].Err, files.CodeNotFound, http.StatusNotFound)
}

func caseResolveModeMismatch(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	up := uploadOK(t, h, spec, scope, "resolve-mode", "note.png", pngBody)

	other := files.ReadPresign
	if spec.Policy.ReadMode == files.ReadPresign {
		other = files.ReadProxy
	}
	got, err := h.Service.ResolveMany(context.Background(), files.ResolveInput{
		Scope: scope, Mode: other, Disposition: files.DispositionInline, FileIDs: []files.FileID{up.File.ID},
	})
	if err == nil {
		t.Fatalf("resolve accepted the %q mode for a purpose whose policy declares %q", other, spec.Policy.ReadMode)
	}
	// The mode is the caller's decision, so this is a caller bug rather than a
	// section 7 refusal: a module must be able to spot it with errors.Is.
	if !errors.Is(err, files.ErrModeMismatch) {
		t.Fatalf("resolve answered %v, want %v", err, files.ErrModeMismatch)
	}
	if got != nil {
		t.Errorf("a refused resolve returned %d entries", len(got))
	}
}

// --- provider output --------------------------------------------------------

func caseProviderIntentIdempotent(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)

	first := registerOK(t, h, spec, scope, "op-idempotent")
	second := registerOK(t, h, spec, scope, "op-idempotent")
	if first.FileID != second.FileID {
		t.Errorf("a retried operation reserved %q and %q, want one file", first.FileID, second.FileID)
	}
	if first.WriteTarget.URL == "" {
		t.Error("provider output carries no write target")
	}
	if first.WriteTarget.ExpiresAt.IsZero() {
		t.Error("provider output write target has no deadline")
	}

	other := purposeFor(t, h, spec.Scope, func(candidate files.PurposeSpec) bool {
		return candidate.Purpose != spec.Purpose
	})
	_, err := h.Service.RegisterProviderOutput(context.Background(), files.ProviderOutputInput{
		Actor: actorA(), Purpose: other.Purpose, Scope: scopeFor(other), OperationID: "op-idempotent",
		Deadline: h.Now().Add(time.Hour),
	})
	requireError(t, err, files.CodeIdempotencyConflict, http.StatusConflict)
}

// caseProviderKeySuffix pins Policy.ObjectKeySuffix on the write target: an
// external writer such as LiveKit egress appends ".mp4" to a key without an
// extension, so the object a provider is told to write must already end with
// the purpose's suffix, or CompleteProviderOutput would look for an object
// that was never written.
func caseProviderKeySuffix(t *testing.T, h Harness) {
	checked := 0
	for _, spec := range h.Registry.Specs() {
		if spec.Disabled || spec.Policy.ObjectKeySuffix == "" {
			continue
		}
		checked++
		out := registerOK(t, h, spec, scopeFor(spec), "op-suffix-"+string(spec.Purpose))
		target, err := url.Parse(out.WriteTarget.URL)
		if err != nil {
			t.Fatalf("%s: write target is not a URL: %v", spec.Purpose, err)
		}
		if !strings.HasSuffix(target.Path, spec.Policy.ObjectKeySuffix) {
			t.Errorf("%s: write target path does not end with %q", spec.Purpose, spec.Policy.ObjectKeySuffix)
		}
	}
	if checked == 0 {
		t.Skip("no open purpose declares an object key suffix")
	}
}

func caseProviderComplete(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)

	body, contentType := sampleFor(t, spec)
	out := registerOK(t, h, spec, scope, "op-complete")
	h.WriteProviderOutput(t, out, body, contentType)

	file, err := h.Service.CompleteProviderOutput(context.Background(), files.CompleteOutputInput{
		Actor: actorA(), Scope: scope, FileID: out.FileID, OperationID: "op-complete",
	})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if file.Status != files.StatusReady {
		t.Errorf("status = %q, want %q", file.Status, files.StatusReady)
	}
	if file.SizeBytes != int64(len(body)) {
		t.Errorf("size = %d, want %d", file.SizeBytes, len(body))
	}
	if file.ContentType != contentType {
		t.Errorf("content type = %q, want %q", file.ContentType, contentType)
	}

	claimed := claimOK(t, h, spec, scope, file.ID)
	if len(claimed) != 1 || claimed[0].ID != file.ID {
		t.Fatalf("claimed %+v, want the completed file", claimed)
	}

	reader, err := h.Service.Open(context.Background(), files.OpenInput{Scope: scope, FileID: file.ID})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer reader.Close()
	got, err := io.ReadAll(reader.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Errorf("read %d bytes, want the %d that were written", len(got), len(body))
	}
}

// caseProviderCompleteReplay covers the webhook side of CompleteProviderOutput
// (FS-C1 section 4): the operation id is what binds a job to its file, so an id
// that is not the file's is idempotency_conflict and an id that never came from
// RegisterProviderOutput is file_not_found; a replay after success returns the
// same ready file instead of writing a second result.
func caseProviderCompleteReplay(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	ctx := context.Background()

	// A file that did not come from RegisterProviderOutput has no operation to
	// complete against; it answers file_not_found like any unknown id.
	direct := uploadOK(t, h, spec, scope, "complete-direct", "note.png", pngBody)
	_, err := h.Service.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor: actorA(), Scope: scope, FileID: direct.File.ID, OperationID: "op-stray",
	})
	requireError(t, err, files.CodeNotFound, http.StatusNotFound)

	out := registerOK(t, h, spec, scope, "op-replay")

	// A webhook reporting the wrong operation id conflicts with the
	// registration instead of silently completing somebody else's job.
	_, err = h.Service.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor: actorA(), Scope: scope, FileID: out.FileID, OperationID: "op-other",
	})
	requireError(t, err, files.CodeIdempotencyConflict, http.StatusConflict)

	body, contentType := sampleFor(t, spec)
	h.WriteProviderOutput(t, out, body, contentType)
	first, err := h.Service.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor: actorA(), Scope: scope, FileID: out.FileID, OperationID: "op-replay",
	})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}

	// The provider redelivers the webhook: the replay returns the same ready
	// file rather than failing or writing a second result.
	again, err := h.Service.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor: actorA(), Scope: scope, FileID: out.FileID, OperationID: "op-replay",
	})
	if err != nil {
		t.Fatalf("replayed complete: %v", err)
	}
	if again.ID != first.ID || again.Status != files.StatusReady {
		t.Errorf("replay returned %+v, want the same ready file %+v", again, first)
	}

	// A webhook can also arrive after the collector passed the file: the
	// barrier answer is file_deleting, not a resurrection (FS-C1 section 7).
	if h.SimulateGC != nil {
		collected := registerOK(t, h, spec, scope, "op-collected")
		h.SimulateGC(t, collected.FileID)
		_, err = h.Service.CompleteProviderOutput(ctx, files.CompleteOutputInput{
			Actor: actorA(), Scope: scope, FileID: collected.FileID, OperationID: "op-collected",
		})
		requireError(t, err, files.CodeDeleting, http.StatusConflict)
	}
}

func caseProviderInvalidOutput(t *testing.T, h Harness) {
	ctx := context.Background()

	imageOnly := purposeFor(t, h, files.ScopeOrgWorkspace, func(spec files.PurposeSpec) bool {
		return !spec.Policy.Allows("text/plain")
	})
	scope := scopeFor(imageOnly)
	out := registerOK(t, h, imageOnly, scope, "op-bad-type")
	h.WriteProviderOutput(t, out, textBody, "text/plain")
	_, err := h.Service.CompleteProviderOutput(ctx, files.CompleteOutputInput{Actor: actorA(), Scope: scope, FileID: out.FileID, OperationID: "op-bad-type"})
	requireError(t, err, files.CodeTypeRejected, http.StatusUnsupportedMediaType)

	small := smallestCap(t, h)
	smallScope := scopeFor(small)
	big := registerOK(t, h, small, smallScope, "op-too-large")
	sample, sampleType := sampleFor(t, small)
	body := make([]byte, small.Policy.MaxBytes+1)
	copy(body, sample)
	h.WriteProviderOutput(t, big, body, sampleType)
	_, err = h.Service.CompleteProviderOutput(ctx, files.CompleteOutputInput{Actor: actorA(), Scope: smallScope, FileID: big.FileID, OperationID: "op-too-large"})
	requireError(t, err, files.CodeTooLarge, http.StatusRequestEntityTooLarge)
}

// caseProviderOutputVerification covers the second non-section-7 sentinel: a
// provider that reports a checksum the object does not have is an operator
// problem, not a client error, and the module that started the job has to be
// able to tell that case from a storage failure.
func caseProviderOutputVerification(t *testing.T, h Harness) {
	ctx := context.Background()
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)

	out := registerOK(t, h, spec, scope, "op-verification")
	h.WriteProviderOutput(t, out, pngBody, "image/png")

	wrong := strings.Repeat("0", 64)
	_, err := h.Service.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor: actorA(), Scope: scope, FileID: out.FileID, OperationID: "op-verification",
		ChecksumSHA256: wrong,
	})
	if err == nil {
		t.Fatal("complete accepted a checksum the object does not have")
	}
	if !errors.Is(err, files.ErrOutputVerification) {
		t.Fatalf("complete answered %v, want %v", err, files.ErrOutputVerification)
	}

	// The refusal is about the report, not the object: the same output
	// completes once the report matches the bytes.
	sum := sha256.Sum256(pngBody)
	file, err := h.Service.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor: actorA(), Scope: scope, FileID: out.FileID, OperationID: "op-verification",
		ChecksumSHA256: hex.EncodeToString(sum[:]),
	})
	if err != nil {
		t.Fatalf("complete with the matching checksum: %v", err)
	}
	if file.Status != files.StatusReady {
		t.Errorf("status = %q, want %q", file.Status, files.StatusReady)
	}
}
func caseStorageUnavailable(t *testing.T, h Harness) {
	if h.SetStorageDown == nil {
		t.Skip("this implementation cannot inject an adapter failure")
	}
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	ctx := context.Background()

	h.SetStorageDown(t, true)
	up, err := h.Service.Upload(ctx, files.UploadInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
		IdempotencyKey: "storage-down", Filename: "note.png", Body: bytes.NewReader(pngBody),
	})
	requireError(t, err, files.CodeStorageUnavailable, http.StatusServiceUnavailable)
	if up.File.ID != "" {
		t.Errorf("a failed upload returned file %q; nothing may be staged", up.File.ID)
	}

	// Nothing was staged behind the key, so a mid-outage retry answers the
	// same transient failure - not idempotency_conflict - and after the
	// adapter recovers the same key + same command succeeds as a fresh upload
	// (FS-C1 section 7: storage_unavailable keeps the job retryable).
	_, err = h.Service.Upload(ctx, files.UploadInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
		IdempotencyKey: "storage-down", Filename: "note.png", Body: bytes.NewReader(pngBody),
	})
	requireError(t, err, files.CodeStorageUnavailable, http.StatusServiceUnavailable)
	h.SetStorageDown(t, false)
	retried := uploadOK(t, h, spec, scope, "storage-down", "note.png", pngBody)
	claimOK(t, h, spec, scope, retried.File.ID)

	// The same holds when the body stream itself broke before a session
	// existed: the failure is the client's to resend, so the key stays usable.
	broken := errReader{err: errors.New("filescontract: client stream broke")}
	if _, err := h.Service.Upload(ctx, files.UploadInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
		IdempotencyKey: "body-broken", Filename: "note.png", Body: broken,
	}); err == nil {
		t.Error("an unreadable body was accepted")
	}
	resent := uploadOK(t, h, spec, scope, "body-broken", "note.png", pngBody)
	if resent.File.ID == "" {
		t.Error("a retry after a broken stream returned no file")
	}

	ready := uploadOK(t, h, spec, scope, "storage-up", "note.png", pngBody)
	claimOK(t, h, spec, scope, ready.File.ID)

	// RegisterProviderOutput and CompleteProviderOutput face the same adapter:
	// a new registration and a pending completion both answer
	// storage_unavailable instead of half-running against a dead backend.
	pending := registerOK(t, h, spec, scope, "op-storage-pending")

	h.SetStorageDown(t, true)
	if _, err := h.Service.Open(ctx, files.OpenInput{Scope: scope, FileID: ready.File.ID}); err == nil {
		t.Error("open succeeded while the adapter was down")
	} else {
		requireError(t, err, files.CodeStorageUnavailable, http.StatusServiceUnavailable)
	}
	_, err = h.Service.RegisterProviderOutput(ctx, files.ProviderOutputInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
		OperationID: "op-new-while-down", Deadline: h.Now().Add(time.Hour),
	})
	requireError(t, err, files.CodeStorageUnavailable, http.StatusServiceUnavailable)
	_, err = h.Service.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor: actorA(), Scope: scope, FileID: pending.FileID, OperationID: "op-storage-pending",
	})
	requireError(t, err, files.CodeStorageUnavailable, http.StatusServiceUnavailable)
	h.SetStorageDown(t, false)

	// And the refused calls recover: the registered file completes once the
	// adapter is back.
	body, contentType := sampleFor(t, spec)
	h.WriteProviderOutput(t, pending, body, contentType)
	if _, err := h.Service.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor: actorA(), Scope: scope, FileID: pending.FileID, OperationID: "op-storage-pending",
	}); err != nil {
		t.Fatalf("complete after recovery: %v", err)
	}
}

// --- open -------------------------------------------------------------------

func caseOpen(t *testing.T, h Harness) {
	spec := purposeFor(t, h, files.ScopeOrgWorkspace, imageAllowed)
	scope := scopeFor(spec)
	ctx := context.Background()
	up := uploadOK(t, h, spec, scope, "open", "note.png", pngBody)
	claimOK(t, h, spec, scope, up.File.ID)

	reader, err := h.Service.Open(ctx, files.OpenInput{Scope: scope, FileID: up.File.ID})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if reader.File.ID != up.File.ID || reader.File.SizeBytes != int64(len(pngBody)) {
		t.Errorf("reader view %+v does not match the file", reader.File)
	}
	got, err := io.ReadAll(reader.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if err := reader.Close(); err != nil {
		t.Errorf("close: %v", err)
	}
	if !bytes.Equal(got, pngBody) {
		t.Errorf("read %d bytes, want %d", len(got), len(pngBody))
	}

	// Range support for media: offset and length slice the object.
	part, err := h.Service.Open(ctx, files.OpenInput{Scope: scope, FileID: up.File.ID, Offset: 4, Length: 8})
	if err != nil {
		t.Fatalf("range open: %v", err)
	}
	defer part.Close()
	got, err = io.ReadAll(part.Body)
	if err != nil {
		t.Fatalf("range read: %v", err)
	}
	if !bytes.Equal(got, pngBody[4:12]) {
		t.Errorf("range read %q, want %q", got, pngBody[4:12])
	}

	if _, err := h.Service.Open(ctx, files.OpenInput{Scope: scope, FileID: unknownID}); err == nil {
		t.Error("open returned an unknown file")
	} else {
		requireError(t, err, files.CodeNotFound, http.StatusNotFound)
	}
	if _, err := h.Service.Open(ctx, files.OpenInput{
		Scope: files.Scope{OrganizationID: orgB, WorkspaceID: wsA}, FileID: up.File.ID,
	}); err == nil {
		t.Error("open returned a file from another tenant")
	} else {
		requireError(t, err, files.CodeNotFound, http.StatusNotFound)
	}

	pending := registerOK(t, h, spec, scope, "op-open-pending")
	if _, err := h.Service.Open(ctx, files.OpenInput{Scope: scope, FileID: pending.FileID}); err == nil {
		t.Error("open returned a file with no verified bytes")
	} else {
		requireError(t, err, files.CodeNotReady, http.StatusConflict)
	}
}

// --- helpers ----------------------------------------------------------------

// errReader is a body whose stream fails, like a client that stopped sending.
type errReader struct{ err error }

func (r errReader) Read([]byte) (int, error) { return 0, r.err }

func requireError(t *testing.T, err error, code string, status int) {
	t.Helper()
	if err == nil {
		t.Fatalf("want %s, got no error", code)
	}
	var fe *files.Error
	if !errors.As(err, &fe) {
		t.Fatalf("want *files.Error %s, got %T: %v", code, err, err)
	}
	if fe.Code != code {
		t.Fatalf("code = %q, want %q (%v)", fe.Code, code, err)
	}
	if fe.Status != status {
		t.Fatalf("status for %s = %d, want %d", code, fe.Status, status)
	}
}

func specFor(t *testing.T, h Harness, purpose files.UploadPurpose) files.PurposeSpec {
	t.Helper()
	for _, spec := range h.Registry.Specs() {
		if spec.Purpose == purpose {
			return spec
		}
	}
	t.Fatalf("registry has no row for %q", purpose)
	return files.PurposeSpec{}
}

// purposeFor picks the first enabled row of a scope shape that also matches the
// predicates, in registry order, so a case runs against whatever the
// implementation has open instead of a hardcoded purpose.
func purposeFor(t *testing.T, h Harness, shape files.ScopeShape, match ...func(files.PurposeSpec) bool) files.PurposeSpec {
	t.Helper()
	for _, spec := range h.Registry.Specs() {
		if spec.Disabled || spec.Scope != shape {
			continue
		}
		ok := true
		for _, m := range match {
			if !m(spec) {
				ok = false
				break
			}
		}
		if ok {
			return spec
		}
	}
	t.Fatalf("registry has no enabled %q purpose matching the case", shape)
	return files.PurposeSpec{}
}

func imageAllowed(spec files.PurposeSpec) bool { return spec.Policy.Allows("image/png") }

// sampleFor returns a fixture the purpose policy accepts, and skips the case
// when none of them is allowed: the suite runs against whatever purposes an
// implementation has open instead of hardcoding one.
func sampleFor(t *testing.T, spec files.PurposeSpec) ([]byte, string) {
	t.Helper()
	for _, f := range fixtures {
		if spec.Policy.Allows(f.contentType) {
			return f.body, f.contentType
		}
	}
	t.Skipf("no contract fixture is allowed by purpose %s", spec.Purpose)
	return nil, ""
}

// sampleAllowed reports whether sampleFor has anything to write for a purpose,
// for use inside a purposeFor predicate.
func sampleAllowed(spec files.PurposeSpec) bool {
	for _, f := range fixtures {
		if spec.Policy.Allows(f.contentType) {
			return true
		}
	}
	return false
}

func smallestCap(t *testing.T, h Harness) files.PurposeSpec {
	t.Helper()
	var smallest files.PurposeSpec
	for _, spec := range h.Registry.Specs() {
		if spec.Disabled {
			continue
		}
		if smallest.Purpose == "" || spec.Policy.MaxBytes < smallest.Policy.MaxBytes {
			smallest = spec
		}
	}
	if smallest.Purpose == "" {
		t.Fatal("registry has no enabled purpose")
	}
	return smallest
}

func scopeFor(spec files.PurposeSpec) files.Scope {
	switch spec.Scope {
	case files.ScopeUser:
		return files.Scope{UserID: userA}
	case files.ScopeOrg:
		return files.Scope{OrganizationID: orgA}
	default:
		return files.Scope{OrganizationID: orgA, WorkspaceID: wsA}
	}
}

func uploadOK(t *testing.T, h Harness, spec files.PurposeSpec, scope files.Scope, key, filename string, body []byte) files.Upload {
	t.Helper()
	out, err := h.Service.Upload(context.Background(), files.UploadInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
		IdempotencyKey: key, Filename: filename, Body: bytes.NewReader(body),
	})
	if err != nil {
		t.Fatalf("upload %s: %v", spec.Purpose, err)
	}
	return out
}

func claimOK(t *testing.T, h Harness, spec files.PurposeSpec, scope files.Scope, ids ...files.FileID) []files.File {
	t.Helper()
	out, err := claimInTx(t, h, files.ClaimInput{Actor: actorA(), Purpose: spec.Purpose, Scope: scope, FileIDs: ids})
	if err != nil {
		t.Fatalf("claim %s: %v", spec.Purpose, err)
	}
	return out
}

func claimInTx(t *testing.T, h Harness, in files.ClaimInput) ([]files.File, error) {
	t.Helper()
	var out []files.File
	err := h.InTx(t, func(q *db.Queries) error {
		var callErr error
		out, callErr = h.Service.ClaimInTx(context.Background(), q, in)
		return callErr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func releaseInTx(t *testing.T, h Harness, ids []files.FileID) error {
	t.Helper()
	return h.InTx(t, func(q *db.Queries) error {
		return h.Service.ReleaseInTx(context.Background(), q, ids)
	})
}

func resolveOK(t *testing.T, h Harness, in files.ResolveInput) []files.Resolved {
	t.Helper()
	out, err := h.Service.ResolveMany(context.Background(), in)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	return out
}

func registerOK(t *testing.T, h Harness, spec files.PurposeSpec, scope files.Scope, operation string) files.ProviderOutput {
	t.Helper()
	out, err := h.Service.RegisterProviderOutput(context.Background(), files.ProviderOutputInput{
		Actor: actorA(), Purpose: spec.Purpose, Scope: scope,
		OperationID: operation, Deadline: h.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("register provider output %s: %v", spec.Purpose, err)
	}
	return out
}
