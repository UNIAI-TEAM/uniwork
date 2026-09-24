package filesfake

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// errStreamTooLarge is internal: it is turned into file_too_large before it
// leaves the fake, so callers only ever see the contract code.
var errStreamTooLarge = errors.New("filesfake: stream passed the purpose byte cap")

// Upload stages one logical upload. The body is read once, under the purpose
// cap, and the verified type comes from the bytes.
func (f *Fake) Upload(_ context.Context, in files.UploadInput) (files.Upload, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	spec, err := f.registry.Lookup(in.Purpose)
	if err != nil {
		return files.Upload{}, err
	}
	if err := spec.ValidateScope(in.Scope); err != nil {
		return files.Upload{}, err
	}
	if strings.TrimSpace(in.IdempotencyKey) == "" {
		return files.Upload{}, errIdempotencyKeyRequired
	}
	if in.Body == nil {
		return files.Upload{}, errBodyRequired
	}

	fingerprint := commandFingerprint(in)
	if prev, ok := f.uploads[in.IdempotencyKey]; ok {
		switch {
		case prev.fingerprint != fingerprint:
			return files.Upload{}, files.IdempotencyConflict(in.IdempotencyKey)
		case prev.transient:
			// Nothing was staged, so the retry starts over instead of replaying
			// an error the client cannot fix.
			delete(f.uploads, in.IdempotencyKey)
		case prev.failure != nil:
			return files.Upload{}, prev.failure
		default:
			// A committed attempt: the same result, and neither the session nor
			// its claim window is revived or extended (T1-Q8).
			if e, ok := f.entries[prev.result.File.ID]; ok {
				if err := f.sessionAgreement(e); err != nil {
					return files.Upload{}, err
				}
			}
			return prev.result, nil
		}
	}

	if f.storageDown {
		f.uploads[in.IdempotencyKey] = &uploadAttempt{fingerprint: fingerprint, transient: true}
		return files.Upload{}, files.StorageUnavailable(errStorageDown)
	}

	body, err := readCapped(in.Body, spec.Policy.MaxBytes)
	if err != nil {
		if errors.Is(err, errStreamTooLarge) {
			failure := files.TooLarge(spec.Policy.MaxBytes)
			f.uploads[in.IdempotencyKey] = &uploadAttempt{fingerprint: fingerprint, failure: failure}
			return files.Upload{}, failure
		}
		// The stream broke before a session existed; the bytes of a retry are
		// the client's to resend, so the key stays usable.
		f.uploads[in.IdempotencyKey] = &uploadAttempt{fingerprint: fingerprint, transient: true}
		return files.Upload{}, fmt.Errorf("%w: %v", errBodyUnreadable, err)
	}

	contentType := detectedType(body)
	if !spec.Policy.Allows(contentType) {
		failure := files.TypeRejected(contentType)
		f.uploads[in.IdempotencyKey] = &uploadAttempt{fingerprint: fingerprint, failure: failure}
		return files.Upload{}, failure
	}

	readyAt := f.now()
	file := files.File{
		ID:             files.FileID(f.newID()),
		OrganizationID: in.Scope.OrganizationID,
		Filename:       files.SanitizeFilename(in.Filename),
		ContentType:    contentType,
		SizeBytes:      int64(len(body)),
		Status:         files.StatusReady,
		ReadyAt:        readyAt,
	}
	if spec.Policy.ChecksumRequired {
		file.ChecksumSHA256 = checksumSHA256(body)
	}

	e := &entry{
		file:           file,
		spec:           spec,
		scope:          in.Scope,
		actor:          in.Actor,
		session:        files.SessionStaged,
		sessionID:      f.newID(),
		claimExpiresAt: readyAt.Add(files.ClaimTTL),
		bytes:          body,
		written:        true,
		writtenType:    contentType,
	}
	f.entries[file.ID] = e

	result := files.Upload{File: file, UploadSessionID: e.sessionID, ClaimExpiresAt: e.claimExpiresAt}
	f.uploads[in.IdempotencyKey] = &uploadAttempt{fingerprint: fingerprint, result: result}
	return result, nil
}

// CancelUpload revokes a staged upload. The actor and the scope must be the
// ones that staged it, and repeating the cancel answers the same nothing
// (FS-C1 section 7.3).
func (f *Fake) CancelUpload(_ context.Context, in files.CancelInput) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	e, err := f.entryInScope(in.FileID, in.Scope)
	if err != nil {
		return err
	}
	if e.actor != in.Actor {
		return files.NotFound(in.FileID)
	}
	switch {
	case e.file.Status == files.StatusDeleting:
		return files.Deleting(in.FileID)
	case e.file.Status == files.StatusDeleted:
		return files.NotFound(in.FileID)
	case e.referenced, e.session == files.SessionClaimed:
		// A module attached the file while the cancel was in flight. Dropping it
		// is the module's unlink command, not an upload cancel.
		return files.AlreadyClaimed(in.FileID)
	case e.session == files.SessionCanceled:
		return nil
	default:
		e.session = files.SessionCanceled
		return nil
	}
}

// ClaimInTx attaches files inside the module's transaction. The fake holds no
// database transaction - the caller owns it - but it validates the whole batch
// before changing anything, so a refusal leaves every file exactly as it was,
// which is what a rolled-back module transaction observes.
func (f *Fake) ClaimInTx(_ context.Context, _ *db.Queries, in files.ClaimInput) ([]files.File, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	spec, err := f.registry.Lookup(in.Purpose)
	if err != nil {
		return nil, err
	}
	if err := spec.ValidateScope(in.Scope); err != nil {
		return nil, err
	}
	if len(in.FileIDs) == 0 {
		return nil, errEmptyClaim
	}

	attached := uniqueInOrder(in.FileIDs)
	// Files are taken in increasing id order before the module locks its own
	// rows (FS-C1 section 5.4); validation follows that order so the same batch
	// answers the same way every time.
	for _, id := range sortedIDs(attached) {
		e, err := f.entryInScope(id, in.Scope)
		if err != nil {
			return nil, err
		}
		if e.spec.Purpose != in.Purpose {
			return nil, files.NotFound(id)
		}
		if err := f.claimable(e); err != nil {
			return nil, err
		}
	}
	for _, id := range in.Replaces {
		e, err := f.entryInScope(id, in.Scope)
		if err != nil {
			return nil, err
		}
		switch e.file.Status {
		case files.StatusDeleting:
			return nil, files.Deleting(id)
		case files.StatusDeleted:
			return nil, files.NotFound(id)
		}
	}

	out := make([]files.File, 0, len(attached))
	for _, id := range attached {
		e := f.entries[id]
		e.referenced = true
		e.session = files.SessionClaimed
		out = append(out, e.file)
	}
	return out, nil
}

// ReleaseInTx records that a module dropped its references. Bytes are not
// touched here: only the collector decides that, and only after every provider
// has been asked again (FS-C1 section 9).
func (f *Fake) ReleaseInTx(_ context.Context, _ *db.Queries, ids []files.FileID) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	for _, id := range ids {
		e, ok := f.entries[id]
		if !ok || e.file.Status == files.StatusDeleted {
			return files.NotFound(id)
		}
		if e.file.Status == files.StatusDeleting {
			// The collector already owns this file; an unlink that arrives
			// afterwards must not fail the module's transaction.
			continue
		}
		e.referenced = false
	}
	return nil
}

// ResolveMany returns per-id results: one refused file never hides the others,
// and a refusal reveals neither that the id exists nor where its bytes live.
func (f *Fake) ResolveMany(_ context.Context, in files.ResolveInput) ([]files.Resolved, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	out := make([]files.Resolved, 0, len(in.FileIDs))
	for _, id := range in.FileIDs {
		e, ok := f.entries[id]
		if !ok || !scopeEqual(e.scope, in.Scope) {
			out = append(out, files.Resolved{Err: files.NotFound(id)})
			continue
		}
		if in.Mode != e.spec.Policy.ReadMode {
			// The policy picks the mode; asking for the other one is a module
			// bug, not a per-file refusal.
			return nil, files.ErrModeMismatch
		}
		switch e.file.Status {
		case files.StatusDeleting:
			out = append(out, files.Resolved{Err: files.Deleting(id)})
			continue
		case files.StatusDeleted:
			out = append(out, files.Resolved{Err: files.NotFound(id)})
			continue
		case files.StatusReady:
		default:
			out = append(out, files.Resolved{Err: files.NotReady(id)})
			continue
		}
		if !e.referenced {
			if err := f.sessionAgreement(e); err != nil {
				out = append(out, files.Resolved{Err: err})
				continue
			}
		}
		resolved := files.Resolved{File: e.file}
		if in.Mode == files.ReadPresign {
			expires := f.now().Add(files.MaxResolveURLTTL)
			// A URL never outlives the grant behind it: the preview URL of an
			// unclaimed file stops with its claim window (T1-Q7).
			if !e.referenced && e.claimExpiresAt.Before(expires) {
				expires = e.claimExpiresAt
			}
			resolved.URL = "fake://presign/" + string(id)
			resolved.URLExpiresAt = expires
		}
		out = append(out, resolved)
	}
	return out, nil
}

// Open is the proxy read path: the module has already authorized the actor, so
// this only checks tenant scope and file state and streams the requested bytes.
func (f *Fake) Open(_ context.Context, in files.OpenInput) (files.Reader, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.storageDown {
		return files.Reader{}, files.StorageUnavailable(errStorageDown)
	}
	if in.Offset < 0 || in.Length < 0 {
		return files.Reader{}, errInvalidRange
	}
	e, err := f.entryInScope(in.FileID, in.Scope)
	if err != nil {
		return files.Reader{}, err
	}
	switch e.file.Status {
	case files.StatusDeleting:
		return files.Reader{}, files.Deleting(in.FileID)
	case files.StatusDeleted:
		return files.Reader{}, files.NotFound(in.FileID)
	case files.StatusReady:
	default:
		return files.Reader{}, files.NotReady(in.FileID)
	}
	if !e.referenced {
		if err := f.sessionAgreement(e); err != nil {
			return files.Reader{}, err
		}
	}

	start := in.Offset
	if start > int64(len(e.bytes)) {
		start = int64(len(e.bytes))
	}
	end := int64(len(e.bytes))
	if in.Length > 0 && start+in.Length < end {
		end = start + in.Length
	}
	return files.Reader{File: e.file, Body: io.NopCloser(bytes.NewReader(e.bytes[start:end]))}, nil
}

// RegisterProviderOutput reserves the id and the write target before an
// external writer starts, so a crash between the two is reconcilable and a
// retried operation finds the same file instead of a second one.
func (f *Fake) RegisterProviderOutput(_ context.Context, in files.ProviderOutputInput) (files.ProviderOutput, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	spec, err := f.registry.Lookup(in.Purpose)
	if err != nil {
		return files.ProviderOutput{}, err
	}
	if err := spec.ValidateScope(in.Scope); err != nil {
		return files.ProviderOutput{}, err
	}
	if strings.TrimSpace(in.OperationID) == "" {
		return files.ProviderOutput{}, errOperationRequired
	}
	if !in.Deadline.After(f.now()) {
		return files.ProviderOutput{}, errDeadlinePassed
	}
	if id, ok := f.operations[in.OperationID]; ok {
		e := f.entries[id]
		if e.spec.Purpose != in.Purpose || !scopeEqual(e.scope, in.Scope) {
			return files.ProviderOutput{}, files.IdempotencyConflict(in.OperationID)
		}
		return files.ProviderOutput{FileID: id, WriteTarget: f.writeTarget(id, in.Deadline)}, nil
	}
	if f.storageDown {
		return files.ProviderOutput{}, files.StorageUnavailable(errStorageDown)
	}

	id := files.FileID(f.newID())
	f.entries[id] = &entry{
		file:        files.File{ID: id, OrganizationID: in.Scope.OrganizationID, Status: files.StatusPending},
		spec:        spec,
		scope:       in.Scope,
		actor:       in.Actor,
		session:     files.SessionReceiving,
		sessionID:   f.newID(),
		operationID: in.OperationID,
	}
	f.operations[in.OperationID] = id
	return files.ProviderOutput{FileID: id, WriteTarget: f.writeTarget(id, in.Deadline)}, nil
}

// writeTarget is scoped to exactly one object and one deadline. The fake's
// target names the file so a test hook can write through it; the real service
// signs a PUT URL for the same object and deadline.
func (f *Fake) writeTarget(id files.FileID, deadline time.Time) files.WriteTarget {
	return files.WriteTarget{
		URL:       "fake://provider-put/" + string(id),
		Method:    http.MethodPut,
		Headers:   map[string]string{},
		ExpiresAt: deadline,
	}
}

// CompleteProviderOutput verifies the object the provider wrote and marks the
// file ready and staged. A webhook replay after success returns the same file
// instead of writing a second result.
func (f *Fake) CompleteProviderOutput(_ context.Context, in files.CompleteOutputInput) (files.File, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	e, err := f.entryInScope(in.FileID, in.Scope)
	if err != nil {
		return files.File{}, err
	}
	if e.operationID == "" {
		return files.File{}, files.NotFound(in.FileID)
	}
	if in.OperationID != "" && in.OperationID != e.operationID {
		return files.File{}, files.IdempotencyConflict(in.OperationID)
	}
	switch e.file.Status {
	case files.StatusReady:
		return e.file, nil
	case files.StatusDeleting:
		return files.File{}, files.Deleting(in.FileID)
	case files.StatusDeleted:
		return files.File{}, files.NotFound(in.FileID)
	}
	if f.storageDown {
		return files.File{}, files.StorageUnavailable(errStorageDown)
	}
	if !e.written {
		// The provider has not written the object yet; there is nothing to
		// verify and nothing to mark ready.
		return files.File{}, files.NotReady(in.FileID)
	}
	if int64(len(e.bytes)) > e.spec.Policy.MaxBytes {
		return files.File{}, files.TooLarge(e.spec.Policy.MaxBytes)
	}
	contentType := detectedType(e.bytes)
	if !e.spec.Policy.Allows(contentType) {
		return files.File{}, files.TypeRejected(contentType)
	}
	sum := checksumSHA256(e.bytes)
	if in.ChecksumSHA256 != "" && !strings.EqualFold(in.ChecksumSHA256, sum) {
		// A checksum that does not match the object is not a section 7 refusal:
		// the provider's report and the bytes disagree, which is an operator
		// problem to reconcile, not a client error. The sentinel is wrapped so
		// the provider module can pick that case out with errors.Is.
		return files.File{}, fmt.Errorf("%w: provider output %s", files.ErrOutputVerification, string(in.FileID))
	}

	readyAt := f.now()
	e.file.ContentType = contentType
	e.file.SizeBytes = int64(len(e.bytes))
	e.file.Status = files.StatusReady
	e.file.ReadyAt = readyAt
	// T1-Q2: a checksum is stored when the policy requires one or the provider
	// supplied one we just verified against the bytes - never an unverified
	// claim.
	if e.spec.Policy.ChecksumRequired || in.ChecksumSHA256 != "" {
		e.file.ChecksumSHA256 = sum
	}
	e.session = files.SessionStaged
	e.claimExpiresAt = readyAt.Add(files.ClaimTTL)
	return e.file, nil
}

// claimable is the state a claim may attach: ready, not being collected, and
// either already referenced in this tenant - reuse across business rows is
// allowed (T1-Q3), which is also what makes a retried save work - or still
// inside its claim window.
func (f *Fake) claimable(e *entry) error {
	switch e.file.Status {
	case files.StatusReady:
	case files.StatusDeleting:
		return files.Deleting(e.file.ID)
	case files.StatusDeleted:
		return files.NotFound(e.file.ID)
	default:
		return files.NotReady(e.file.ID)
	}
	if e.referenced {
		return nil
	}
	return f.sessionAgreement(e)
}

// sessionAgreement is the one rule every read or claim of an unreferenced file
// makes: a canceled session is refused, and the 24 hour window is measured from
// ready/staged (T1-Q5). Opening a preview or retrying a save never extends it.
func (f *Fake) sessionAgreement(e *entry) error {
	switch e.session {
	case files.SessionCanceled:
		return files.UploadCanceled(e.file.ID)
	case files.SessionClaimed:
		return nil
	}
	if f.now().After(e.claimExpiresAt) {
		e.session = files.SessionExpired
		return files.ClaimExpired(e.file.ID)
	}
	return nil
}

// detectedType is the type the fake verifies from the bytes. It uses the
// standard library's sniffer - the same rule the avatar and chat pipelines
// publish today - and never the client's Content-Type or the filename.
func detectedType(body []byte) string {
	return files.NormalizeContentType(http.DetectContentType(body))
}

// readCapped reads at most cap bytes and reports file_too_large without
// pulling a large upload into memory.
func readCapped(r io.Reader, capBytes int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r, capBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > capBytes {
		return nil, errStreamTooLarge
	}
	return body, nil
}

func checksumSHA256(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func uniqueInOrder(ids []files.FileID) []files.FileID {
	seen := make(map[files.FileID]bool, len(ids))
	out := make([]files.FileID, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func sortedIDs(ids []files.FileID) []files.FileID {
	out := make([]files.FileID, len(ids))
	copy(out, ids)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
