package files

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// TestErrorCodesMatchTheContractTable is the files half of AC-3: every code of
// the FS-C1 section 7 table has a constructor with that code and that HTTP
// status, and the table has exactly the thirteen codes the contract lists.
func TestErrorCodesMatchTheContractTable(t *testing.T) {
	cause := errors.New("adapter refused the connection")
	cases := []struct {
		name   string
		err    *Error
		code   string
		status int
	}{
		{"purpose unknown", PurposeUnknown("x"), CodePurposeUnknown, http.StatusBadRequest},
		{"purpose disabled", PurposeDisabled(DocumentAsset), CodePurposeDisabled, http.StatusBadRequest},
		{"scope invalid", ScopeInvalid("no workspace"), CodeScopeInvalid, http.StatusBadRequest},
		{"too large", TooLarge(1), CodeTooLarge, http.StatusRequestEntityTooLarge},
		{"type rejected", TypeRejected("text/plain"), CodeTypeRejected, http.StatusUnsupportedMediaType},
		{"not found", NotFound("id"), CodeNotFound, http.StatusNotFound},
		{"not ready", NotReady("id"), CodeNotReady, http.StatusConflict},
		{"claim expired", ClaimExpired("id"), CodeClaimExpired, http.StatusConflict},
		{"already claimed", AlreadyClaimed("id"), CodeAlreadyClaimed, http.StatusConflict},
		{"upload canceled", UploadCanceled("id"), CodeUploadCanceled, http.StatusConflict},
		{"deleting", Deleting("id"), CodeDeleting, http.StatusConflict},
		{"idempotency conflict", IdempotencyConflict("key"), CodeIdempotencyConflict, http.StatusConflict},
		{"storage unavailable", StorageUnavailable(cause), CodeStorageUnavailable, http.StatusServiceUnavailable},
	}
	if len(cases) != 13 {
		t.Fatalf("the section 7 table has 13 codes, this test covers %d", len(cases))
	}

	seen := map[string]bool{}
	for _, tc := range cases {
		if seen[tc.code] {
			t.Errorf("code %q is covered twice", tc.code)
		}
		seen[tc.code] = true
		if tc.err.Code != tc.code {
			t.Errorf("%s: code = %q, want %q", tc.name, tc.err.Code, tc.code)
		}
		if tc.err.Status != tc.status {
			t.Errorf("%s: status = %d, want %d", tc.name, tc.err.Status, tc.status)
		}
		if StatusForCode(tc.code) != tc.status {
			t.Errorf("%s: StatusForCode(%q) = %d, want %d", tc.name, tc.code, StatusForCode(tc.code), tc.status)
		}
		if tc.err.Error() == "" {
			t.Errorf("%s: Error() is empty", tc.name)
		}
		if strings.TrimSpace(tc.err.Msg) == "" {
			t.Errorf("%s: an operator has nothing to read", tc.name)
		}
		// The message travels to a log and an API body; a storage locator or a
		// credential must never be in one.
		for _, secret := range []string{"http://", "https://", "s3://", "minio", "bucket"} {
			if strings.Contains(strings.ToLower(tc.err.Msg), secret) {
				t.Errorf("%s: message %q leaks %q", tc.name, tc.err.Msg, secret)
			}
		}
	}
}

func TestStatusForUnknownCodeIsInternal(t *testing.T) {
	if got := StatusForCode("something_else"); got != http.StatusInternalServerError {
		t.Errorf("StatusForCode returned %d, want 500", got)
	}
}

// A storage failure keeps its cause: the retry path has to be able to see the
// adapter error, while the client only ever sees the code.
func TestStorageUnavailableKeepsTheCause(t *testing.T) {
	cause := errors.New("dial tcp 127.0.0.1:9000: connect: connection refused")
	err := StorageUnavailable(cause)
	if !errors.Is(err, cause) {
		t.Error("the adapter cause was dropped")
	}
	if strings.Contains(err.Error(), "127.0.0.1") {
		t.Errorf("the message carries the adapter error: %q", err.Error())
	}
	var fe *Error
	if !errors.As(err, &fe) || fe.Code != CodeStorageUnavailable {
		t.Errorf("errors.As did not find the contract error: %v", err)
	}
}

func TestErrorFallsBackToTheCode(t *testing.T) {
	err := &Error{Code: CodeNotFound, Status: http.StatusNotFound}
	if err.Error() != CodeNotFound {
		t.Errorf("Error() = %q, want the code when there is no message", err.Error())
	}
}

// The two sentinels the Advisor approved on 2026-09-24 are deliberately not
// section 7 codes: they describe a caller or provider problem, so they carry no
// code and no HTTP status and the service helper passes them through unchanged
// (a 500 in the log, not a sentence for a user). A module relies on them
// through errors.Is, which filescontract pins.
func TestCallerBugSentinelsAreNotContractCodes(t *testing.T) {
	for _, err := range []error{ErrModeMismatch, ErrOutputVerification} {
		if err == nil || err.Error() == "" {
			t.Fatalf("%T has no message", err)
		}
		var fe *Error
		if errors.As(err, &fe) {
			t.Errorf("%v is a *files.Error with code %q; a caller bug is not a section 7 refusal", err, fe.Code)
		}

	}
	if ErrModeMismatch == ErrOutputVerification {
		t.Error("the two sentinels are the same value")
	}
	if !errors.Is(fmt.Errorf("wrap: %w", ErrModeMismatch), ErrModeMismatch) {
		t.Error("ErrModeMismatch does not survive wrapping")
	}
	if !errors.Is(fmt.Errorf("wrap: %w", ErrOutputVerification), ErrOutputVerification) {
		t.Error("ErrOutputVerification does not survive wrapping")
	}
}
