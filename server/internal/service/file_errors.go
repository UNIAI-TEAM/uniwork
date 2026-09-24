package service

import (
	"errors"

	"github.com/unicomhub/uniwork/server/internal/files"
)

// filesError maps the FileService contract's *files.Error onto the API error
// shape of FS-C1 section 7, and it is the only seam that does.
//
// internal/files cannot import this package (arch_test.go keeps it a leaf), so
// the contract carries its own error type; this helper copies the code and the
// status so they travel unchanged, wraps the sentinel the table names -
// ErrNotFound for file_not_found, ErrConflict for the five conflict codes - so
// errors.Is keeps matching for callers that already ask that way, and leaves
// every other code without a sentinel.
//
// Two consequences worth stating: mapServiceError needs no branch for this
// package (a CodedError is already what it renders), and the message stays the
// contract's English sentence, because a module is expected to re-map a file
// code to its own user-facing error (FS-C1 section 7) rather than show the
// transport's copy.
func filesError(err error) error {
	var fe *files.Error
	if !errors.As(err, &fe) {
		return err
	}

	out := CodedError{Code: fe.Code, Status: fe.Status, Msg: fe.Msg}
	switch fe.Code {
	case files.CodeNotFound:
		out.Err = ErrNotFound
	case files.CodeNotReady, files.CodeClaimExpired, files.CodeAlreadyClaimed,
		files.CodeUploadCanceled, files.CodeDeleting, files.CodeIdempotencyConflict:
		out.Err = ErrConflict
	default:
		// No sentinel in the table. Keep the adapter cause when there is one,
		// so the retry path and the logs still see what the storage said.
		out.Err = fe.Err
	}
	return out
}
