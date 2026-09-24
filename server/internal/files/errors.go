package files

import (
	"fmt"
	"net/http"
)

// Error is the error every documented FileService failure carries. This
// package cannot import internal/service, so the service tier turns a *Error
// into its own CodedError in one place (internal/service/file_errors.go): the
// code and status travel unchanged, the sentinel from the section 7 table is
// wrapped so errors.Is keeps matching, and mapServiceError needs no new branch.
//
// A module switches on Code, because FS-C1 section 7 lets it re-map a code to
// its own error (Documents turns file_not_ready into a version error, say)
// without changing any code the repository already publishes.
type Error struct {
	// Code is the machine-readable code from the section 7 table.
	Code string
	// Status is the HTTP status that code maps to.
	Status int
	// Msg is an English, operator-facing sentence. It never carries a storage
	// locator, credential or signed URL.
	Msg string
	// Err is the underlying cause when one exists (an adapter failure). It is
	// nil for a contract-level refusal, which is not a wrapped cause.
	Err error
}

func (e *Error) Error() string {
	if e.Msg != "" {
		return e.Msg
	}
	return e.Code
}

func (e *Error) Unwrap() error { return e.Err }

// The codes of the FS-C1 section 7 table, spelled exactly as the contract does.
const (
	CodePurposeUnknown      = "file_purpose_unknown"
	CodePurposeDisabled     = "file_purpose_disabled"
	CodeScopeInvalid        = "file_scope_invalid"
	CodeTooLarge            = "file_too_large"
	CodeTypeRejected        = "file_type_rejected"
	CodeNotFound            = "file_not_found"
	CodeNotReady            = "file_not_ready"
	CodeClaimExpired        = "file_claim_expired"
	CodeAlreadyClaimed      = "file_already_claimed"
	CodeUploadCanceled      = "file_upload_canceled"
	CodeDeleting            = "file_deleting"
	CodeIdempotencyConflict = "idempotency_conflict"
	CodeStorageUnavailable  = "storage_unavailable"
)

// StatusForCode is the HTTP status the section 7 table gives a code. A code
// outside the table is a programming error and answers 500.
func StatusForCode(code string) int {
	switch code {
	case CodePurposeUnknown, CodePurposeDisabled, CodeScopeInvalid:
		return http.StatusBadRequest
	case CodeTooLarge:
		return http.StatusRequestEntityTooLarge
	case CodeTypeRejected:
		return http.StatusUnsupportedMediaType
	case CodeNotFound:
		return http.StatusNotFound
	case CodeNotReady, CodeClaimExpired, CodeAlreadyClaimed, CodeUploadCanceled, CodeDeleting, CodeIdempotencyConflict:
		return http.StatusConflict
	case CodeStorageUnavailable:
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

// NewError builds a *Error whose status comes from the code table, so a caller
// never restates it (and cannot disagree with it).
func NewError(code, msg string) *Error {
	return &Error{Code: code, Status: StatusForCode(code), Msg: msg}
}

// PurposeUnknown: the purpose is empty, outside the enum, or has no registry
// row. Refused before a byte is read or a row is written.
func PurposeUnknown(purpose UploadPurpose) *Error {
	return NewError(CodePurposeUnknown, fmt.Sprintf("upload purpose %q is not declared", string(purpose)))
}

// PurposeDisabled: the enum declares the purpose but the real registry has not
// opened it - its policy or reference provider is missing (FS-C1 section 5.6).
func PurposeDisabled(purpose UploadPurpose) *Error {
	return NewError(CodePurposeDisabled, fmt.Sprintf("upload purpose %q is not enabled", string(purpose)))
}

// ScopeInvalid: the scope is missing a field the purpose requires, or carries
// a tenant branch the purpose has none of. The module builds Scope from an
// authorized context; this is not a client input to be defaulted.
func ScopeInvalid(reason string) *Error {
	return NewError(CodeScopeInvalid, "invalid file scope: "+reason)
}

// TooLarge: the stream passed the purpose policy's byte cap. The cap is
// measured on the stream, never trusted from Content-Length.
func TooLarge(limit int64) *Error {
	return NewError(CodeTooLarge, fmt.Sprintf("file exceeds the %d byte limit for this purpose", limit))
}

// TypeRejected: the type verified from the content is not in the purpose
// policy's allowlist. The client's Content-Type and filename extension are not
// evidence and are never used to accept a file.
func TypeRejected(contentType string) *Error {
	return NewError(CodeTypeRejected, fmt.Sprintf("content type %q is not allowed for this purpose", contentType))
}

// NotFound: the id does not exist, belongs to another tenant, or is outside
// the scope the caller authorized. One code for all three, so the answer never
// reveals that a file exists (T1-Q10).
func NotFound(id FileID) *Error {
	return NewError(CodeNotFound, fmt.Sprintf("file %q not found", string(id)))
}

// NotReady: the file has no verified bytes yet, so it can neither be claimed
// nor served.
func NotReady(id FileID) *Error {
	return NewError(CodeNotReady, fmt.Sprintf("file %q is not ready", string(id)))
}

// ClaimExpired: the 24 hour claim window (T1-Q5) closed before the file was
// claimed. Refreshing the page or retrying the save does not extend it.
func ClaimExpired(id FileID) *Error {
	return NewError(CodeClaimExpired, fmt.Sprintf("claim window for file %q has expired", string(id)))
}

// AlreadyClaimed: cancel arrived after a module had claimed the file. Dropping
// it is the module's unlink command, not an upload cancel.
func AlreadyClaimed(id FileID) *Error {
	return NewError(CodeAlreadyClaimed, fmt.Sprintf("file %q is already claimed", string(id)))
}

// UploadCanceled: the session was canceled, and a canceled or expired session
// is never resurrected by a replay (T1-Q8).
func UploadCanceled(id FileID) *Error {
	return NewError(CodeUploadCanceled, fmt.Sprintf("upload session for file %q was canceled", string(id)))
}

// Deleting: a garbage collector moved the file to deleting before this call
// won the row lock, so the bytes are on their way out and no new claim,
// cancel or URL is granted (FS-C1 section 9.3).
func Deleting(id FileID) *Error {
	return NewError(CodeDeleting, fmt.Sprintf("file %q is being deleted", string(id)))
}

// IdempotencyConflict: the same idempotency key arrived with a different
// command (actor, scope, purpose or filename) than the one it was bound to.
func IdempotencyConflict(key string) *Error {
	return NewError(CodeIdempotencyConflict, fmt.Sprintf("idempotency key %q was used for a different command", key))
}

// StorageUnavailable: the adapter failed. The intent (and any job) stays so
// the work can be retried; the caller must not turn this into a ready file or
// a missing reference.
func StorageUnavailable(cause error) *Error {
	e := NewError(CodeStorageUnavailable, "file storage is unavailable")
	e.Err = cause
	return e
}
