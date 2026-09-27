package service

import (
	"errors"
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
)

// TestFilesErrorMapsEveryContractCode is AC-3: each code of the FS-C1 section 7
// table reaches a handler as a CodedError carrying that code and that HTTP
// status, and the rows whose table entry names a sentinel still answer
// errors.Is for it.
func TestFilesErrorMapsEveryContractCode(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		code     string
		status   int
		sentinel error
	}{
		{"purpose unknown", files.PurposeUnknown("x"), files.CodePurposeUnknown, http.StatusBadRequest, nil},
		{"purpose disabled", files.PurposeDisabled(files.DocumentAsset), files.CodePurposeDisabled, http.StatusBadRequest, nil},
		{"scope invalid", files.ScopeInvalid("no workspace"), files.CodeScopeInvalid, http.StatusBadRequest, nil},
		{"too large", files.TooLarge(1), files.CodeTooLarge, http.StatusRequestEntityTooLarge, nil},
		{"type rejected", files.TypeRejected("text/plain"), files.CodeTypeRejected, http.StatusUnsupportedMediaType, nil},
		{"not found", files.NotFound("id"), files.CodeNotFound, http.StatusNotFound, ErrNotFound},
		{"not ready", files.NotReady("id"), files.CodeNotReady, http.StatusConflict, ErrConflict},
		{"claim expired", files.ClaimExpired("id"), files.CodeClaimExpired, http.StatusConflict, ErrConflict},
		{"already claimed", files.AlreadyClaimed("id"), files.CodeAlreadyClaimed, http.StatusConflict, ErrConflict},
		{"upload canceled", files.UploadCanceled("id"), files.CodeUploadCanceled, http.StatusConflict, ErrConflict},
		{"deleting", files.Deleting("id"), files.CodeDeleting, http.StatusConflict, ErrConflict},
		{"idempotency conflict", files.IdempotencyConflict("key"), files.CodeIdempotencyConflict, http.StatusConflict, ErrConflict},
		{"storage unavailable", files.StorageUnavailable(errors.New("boom")), files.CodeStorageUnavailable, http.StatusServiceUnavailable, nil},
	}
	if len(cases) != 13 {
		t.Fatalf("the section 7 table has 13 codes, this test covers %d", len(cases))
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mapped := filesError(tc.err)
			var ce CodedError
			if !errors.As(mapped, &ce) {
				t.Fatalf("mapped %T, want service.CodedError", mapped)
			}
			if ce.Code != tc.code {
				t.Errorf("code = %q, want %q", ce.Code, tc.code)
			}
			if ce.Status != tc.status {
				t.Errorf("status = %d, want %d", ce.Status, tc.status)
			}
			if ce.Msg == "" {
				t.Error("the mapped error carries no message")
			}
			if tc.sentinel != nil {
				if !errors.Is(mapped, tc.sentinel) {
					t.Errorf("errors.Is(%v) = false, want true", tc.sentinel)
				}
				return
			}
			// A code without a sentinel in the table must not start matching
			// one: a handler that answered 404 for file_too_large would hide a
			// limit from the user.
			if errors.Is(mapped, ErrNotFound) || errors.Is(mapped, ErrConflict) {
				t.Errorf("%s matched a sentinel the table does not name", tc.code)
			}
		})
	}
}

func TestFilesErrorKeepsTheAdapterCause(t *testing.T) {
	cause := errors.New("dial tcp: connection refused")
	mapped := filesError(files.StorageUnavailable(cause))
	if !errors.Is(mapped, cause) {
		t.Error("the adapter cause was dropped; the retry path needs it")
	}
}

func TestFilesErrorPassesOtherErrorsThrough(t *testing.T) {
	if got := filesError(nil); got != nil {
		t.Errorf("nil became %v", got)
	}
	if got := filesError(ErrForbidden); !errors.Is(got, ErrForbidden) {
		t.Errorf("a foreign error was rewritten: %v", got)
	}
	// A CodedError is not comparable (Fields is a map), so compare by type.
	wrapped := CodedError{Code: "quota_exceeded", Status: http.StatusForbidden, Msg: "quota"}
	got, ok := filesError(wrapped).(CodedError)
	if !ok {
		t.Fatalf("a CodedError was rewritten as %T", filesError(wrapped))
	}
	if got.Code != "quota_exceeded" || got.Status != http.StatusForbidden {
		t.Errorf("a CodedError was rewritten: %+v", got)
	}
}
