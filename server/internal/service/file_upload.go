package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// uploadAttempt is one writer's hold on a session: the file row it writes,
// the lease it owns and the generation it was granted.
type uploadAttempt struct {
	file       db.File
	session    db.FileUploadSession
	leaseOwner string
}

// Upload streams one logical upload (FS-C1 section 4, T1-Q8).
//
//  1. Purpose, scope, key and actor are checked before anything is read or
//     written, so a bad purpose has no side effect at all.
//  2. One short transaction finds the key. A different command under it is
//     idempotency_conflict; a recorded result or refusal is returned without
//     touching the body; a live writer is not joined by a second one. A new
//     key records the intent - file row, session with its write lease, and a
//     reconcile job - before any byte is stored.
//  3. The body is copied to a local spool under the purpose cap while its
//     head is kept for type detection; no transaction is open meanwhile.
//  4. A permanent refusal (cap, type) is stored on the session; a transient
//     failure (stream, storage) gives the lease back so the same key retries
//     with a fresh file; success publishes ready + staged only if this writer
//     still holds the lease, so a cancel that won the race keeps its word.
func (s *FileService) Upload(ctx context.Context, in files.UploadInput) (files.Upload, error) {
	spec, err := s.registry.Lookup(in.Purpose)
	if err != nil {
		return files.Upload{}, err
	}
	if err := spec.ValidateScope(in.Scope); err != nil {
		return files.Upload{}, err
	}
	if strings.TrimSpace(in.IdempotencyKey) == "" {
		return files.Upload{}, errFileIdempotencyKeyRequired
	}
	if in.Body == nil {
		return files.Upload{}, errFileBodyRequired
	}
	if !validActor(in.Actor) {
		return files.Upload{}, errFileActorRequired
	}

	att, replay, err := s.openUploadAttempt(ctx, spec, in)
	if err != nil || replay != nil {
		if replay != nil {
			return *replay, nil
		}
		return files.Upload{}, err
	}

	spool, err := spoolBody(s.spoolDir, in.Body, spec.Policy.MaxBytes)
	if err != nil {
		if errors.Is(err, errSpoolOverCap) {
			return files.Upload{}, s.refuseAttempt(ctx, att, files.TooLarge(spec.Policy.MaxBytes))
		}
		s.abandonAttempt(ctx, att)
		return files.Upload{}, fmt.Errorf("%w: %v", errFileBodyUnreadable, err)
	}
	defer spool.close()

	contentType := spec.Policy.Canonical(files.DetectContentType(spool.head, in.Filename))
	if !spec.Policy.Allows(contentType) {
		return files.Upload{}, s.refuseAttempt(ctx, att, files.TypeRejected(contentType))
	}

	if s.quota != nil && in.Scope.OrganizationID != "" {
		if err := s.quota.ReserveFileBytes(ctx, in.Scope.OrganizationID, files.FileID(att.file.ID), spool.size); err != nil {
			s.abandonAttempt(ctx, att)
			return files.Upload{}, err
		}
	}

	put, err := s.store.Put(ctx, locator(att.file), spool.reader(), storage.WriteInfo{
		ContentType: contentType, SizeBytes: spool.size, Filename: att.file.OriginalFilename,
	})
	if err != nil {
		s.abandonAttempt(ctx, att)
		return files.Upload{}, files.StorageUnavailable(err)
	}

	checksum := ""
	if spec.Policy.ChecksumRequired {
		checksum = spool.sha256
	}
	return s.publishUpload(ctx, att, contentType, spool.size, checksum, put.VersionID)
}

// openUploadAttempt is step 2 of Upload. It returns either an attempt this
// caller now owns, or a replayed result, or the refusal the key is bound to.
func (s *FileService) openUploadAttempt(ctx context.Context, spec files.PurposeSpec, in files.UploadInput) (uploadAttempt, *files.Upload, error) {
	fingerprint := uploadFingerprint(in)
	var att uploadAttempt
	var replay *files.Upload
	// A concurrent first use of the same key loses the insert race on the
	// unique index; the second pass then finds the winner's row.
	for pass := 0; pass < 2; pass++ {
		att, replay = uploadAttempt{}, nil
		err := s.inTx(ctx, func(q *db.Queries) error {
			now := s.now()
			sess, err := s.findSessionByKey(ctx, q, in)
			if err == nil {
				// Serialize a replay and a retry of the same key on the row.
				sess, err = q.GetUploadSessionByIDForUpdate(ctx, sess.ID)
			}
			if errors.Is(err, pgx.ErrNoRows) {
				att, err = s.recordIntent(ctx, q, spec, in, fingerprint, now)
				return err
			}
			if err != nil {
				return fmt.Errorf("files: find key: %w", err)
			}
			if sess.CommandFingerprint != fingerprint {
				return files.IdempotencyConflict(in.IdempotencyKey)
			}
			switch files.SessionStatus(sess.Status) {
			case files.SessionStaged, files.SessionClaimed:
				if err := sessionGrant(sess, now); err != nil {
					return err
				}
				file, err := q.GetFileByID(ctx, sess.FileID)
				if err != nil {
					return fmt.Errorf("files: replay: %w", err)
				}
				if err := fileState(file); err != nil {
					return err
				}
				result := files.Upload{File: fileView(file), UploadSessionID: sess.ID, ClaimExpiresAt: sess.ClaimExpiresAt.Time}
				replay = &result
				return nil
			case files.SessionCanceled:
				return storedRefusal(sess, spec)
			case files.SessionExpired:
				return files.ClaimExpired(files.FileID(sess.FileID))
			default:
				att, err = s.retryAttempt(ctx, q, spec, in.Scope, sess, now)
				return err
			}
		})
		if err != nil && isUniqueViolation(err) && pass == 0 {
			continue
		}
		return att, replay, err
	}
	return att, replay, nil
}

func (s *FileService) findSessionByKey(ctx context.Context, q *db.Queries, in files.UploadInput) (db.FileUploadSession, error) {
	if in.Scope.OrganizationID != "" {
		return q.FindUploadSessionByIdempotencyKey(ctx, db.FindUploadSessionByIdempotencyKeyParams{
			OrganizationID: fileText(in.Scope.OrganizationID), IdempotencyKey: in.IdempotencyKey,
		})
	}
	return q.FindUserUploadSessionByIdempotencyKey(ctx, db.FindUserUploadSessionByIdempotencyKeyParams{
		CreatedBy: in.Actor.ID, IdempotencyKey: in.IdempotencyKey,
	})
}

// storedRefusal replays how a canceled session ended: the permanent refusal
// it recorded, or the cancel itself. Neither is ever resurrected (T1-Q8).
func storedRefusal(sess db.FileUploadSession, spec files.PurposeSpec) error {
	switch sess.FailureCode.String {
	case files.CodeTooLarge:
		return files.TooLarge(spec.Policy.MaxBytes)
	case files.CodeTypeRejected:
		return files.NewError(files.CodeTypeRejected, "content type is not allowed for this purpose")
	default:
		return files.UploadCanceled(files.FileID(sess.FileID))
	}
}

// recordIntent writes the file row, the session holding this writer's lease
// and a reconcile job due when the lease ends. If the process dies between the
// Put and the finalize, that job is what finds the object (spec 9.4).
func (s *FileService) recordIntent(ctx context.Context, q *db.Queries, spec files.PurposeSpec, in files.UploadInput, fingerprint string, now time.Time) (uploadAttempt, error) {
	file, err := s.insertIntentFile(ctx, q, spec, in.Scope, files.SanitizeFilename(in.Filename), now)
	if err != nil {
		return uploadAttempt{}, err
	}
	sess, err := q.InsertUploadSession(ctx, db.InsertUploadSessionParams{
		ID:                 s.newID(),
		FileID:             file.ID,
		CreatedBy:          in.Actor.ID,
		CreatedByKind:      string(in.Actor.Kind),
		Purpose:            string(spec.Purpose),
		OrganizationID:     fileText(in.Scope.OrganizationID),
		WorkspaceID:        fileText(in.Scope.WorkspaceID),
		UserID:             fileText(in.Scope.UserID),
		IdempotencyKey:     in.IdempotencyKey,
		CommandFingerprint: fingerprint,
	})
	if err != nil {
		return uploadAttempt{}, fmt.Errorf("files: record session: %w", err)
	}
	owner, err := s.takeLease(ctx, q, sess.ID, "upload:"+s.newID(), now.Add(s.lease), now)
	if err != nil {
		return uploadAttempt{}, err
	}
	if err := s.enqueueJob(ctx, q, file, fileJobReconcile, now.Add(s.lease)); err != nil {
		return uploadAttempt{}, err
	}
	return uploadAttempt{file: file, session: sess, leaseOwner: owner}, nil
}

// retryAttempt takes over a receiving session whose writer gave up or whose
// lease expired. The earlier write result is not known, so the retry writes a
// new file with a new key and a new generation; the old file stays for
// reconcile and cleanup (spec 9.4). A live lease is another writer: refuse,
// never open a second one.
func (s *FileService) retryAttempt(ctx context.Context, q *db.Queries, spec files.PurposeSpec, scope files.Scope, sess db.FileUploadSession, now time.Time) (uploadAttempt, error) {
	if sess.LeaseExpiresAt.Valid && now.Before(sess.LeaseExpiresAt.Time) {
		return uploadAttempt{}, files.NewError(files.CodeIdempotencyConflict, "an upload with this idempotency key is still in progress")
	}
	old, err := q.GetFileByID(ctx, sess.FileID)
	if err != nil {
		return uploadAttempt{}, fmt.Errorf("files: retry: %w", err)
	}
	if _, err := q.MarkFileFailed(ctx, old.ID); err != nil {
		return uploadAttempt{}, fmt.Errorf("files: retire attempt: %w", err)
	}
	if err := s.enqueueJob(ctx, q, old, fileJobCleanup, now); err != nil {
		return uploadAttempt{}, err
	}
	file, err := s.insertIntentFile(ctx, q, spec, scope, old.OriginalFilename, now)
	if err != nil {
		return uploadAttempt{}, err
	}
	// The session row is locked by openUploadAttempt, so the bump and the
	// new lease cannot interleave with another writer.
	if _, err := q.BumpUploadSessionFile(ctx, db.BumpUploadSessionFileParams{ID: sess.ID, FileID: file.ID}); err != nil {
		return uploadAttempt{}, fmt.Errorf("files: retry session: %w", err)
	}
	owner, err := s.takeLease(ctx, q, sess.ID, "upload:"+s.newID(), now.Add(s.lease), now)
	if err != nil {
		return uploadAttempt{}, err
	}
	if err := s.enqueueJob(ctx, q, file, fileJobReconcile, now.Add(s.lease)); err != nil {
		return uploadAttempt{}, err
	}
	sess.FileID = file.ID
	sess.Generation++
	return uploadAttempt{file: file, session: sess, leaseOwner: owner}, nil
}

func (s *FileService) insertIntentFile(ctx context.Context, q *db.Queries, spec files.PurposeSpec, scope files.Scope, filename string, now time.Time) (db.File, error) {
	id := files.FileID(s.newID())
	key, err := mintObjectKey(spec, scope, id, now)
	if err != nil {
		return db.File{}, err
	}
	file, err := q.InsertFile(ctx, db.InsertFileParams{
		ID:               string(id),
		OrganizationID:   fileText(scope.OrganizationID),
		Storage:          string(s.backend),
		Bucket:           fileText(s.bucket),
		ObjectKey:        key,
		OriginalFilename: filename,
		Metadata:         []byte("{}"),
	})
	if err != nil {
		return db.File{}, fmt.Errorf("files: record intent: %w", err)
	}
	return file, nil
}

// refuseAttempt stores a permanent refusal on the session, so the same key and
// command replay it from the record (T1-Q8). Nothing was stored, so the file
// fails and its reconcile job is voided; no bytes need cleaning.
func (s *FileService) refuseAttempt(ctx context.Context, att uploadAttempt, refusal *files.Error) error {
	err := s.inTx(ctx, func(q *db.Queries) error {
		if held, err := s.stillHolds(ctx, q, att); err != nil || !held {
			// A cancel or a takeover got there first; its outcome stands.
			return err
		}
		if _, err := q.RefuseUploadSession(ctx, db.RefuseUploadSessionParams{
			ID: att.session.ID, FailureCode: fileText(refusal.Code), ClosedAt: fileTime(s.now()),
		}); err != nil {
			return err
		}
		if _, err := q.MarkFileFailed(ctx, att.file.ID); err != nil {
			return err
		}
		_, err := q.CancelPendingFileJobs(ctx, db.CancelPendingFileJobsParams{FileID: att.file.ID, Operation: fileJobReconcile, FinishedAt: fileTime(s.now())})
		return err
	})
	if err != nil {
		// The refusal still stands for this call; the reconcile job that is
		// left behind finds the failed intent later.
		return errors.Join(refusal, err)
	}
	return refusal
}

// abandonAttempt gives the lease back after a transient failure. The session
// stays receiving, so the same key may retry at once; the file fails and a
// cleanup job covers whatever part of the object the adapter wrote. Errors
// here are left to the reconcile job the intent already queued.
func (s *FileService) abandonAttempt(ctx context.Context, att uploadAttempt) {
	ctx = context.WithoutCancel(ctx)
	_ = s.inTx(ctx, func(q *db.Queries) error {
		now := s.now()
		if _, err := q.ReleaseUploadSessionLease(ctx, db.ReleaseUploadSessionLeaseParams{
			ID: att.session.ID, LeaseOwner: fileText(att.leaseOwner),
		}); err != nil {
			return err
		}
		if _, err := q.MarkFileFailed(ctx, att.file.ID); err != nil {
			return err
		}
		if _, err := q.CancelPendingFileJobs(ctx, db.CancelPendingFileJobsParams{FileID: att.file.ID, Operation: fileJobReconcile, FinishedAt: fileTime(s.now())}); err != nil {
			return err
		}
		return s.enqueueJob(ctx, q, att.file, fileJobCleanup, now)
	})
}

// publishUpload marks the stored file ready and the session staged, with the
// claim window starting now (T1-Q5). It only succeeds for the writer that
// still holds the lease: a cancel that landed while the body streamed leaves
// zero rows, and the upload answers upload_canceled with the stored object
// handed to cleanup.
func (s *FileService) publishUpload(ctx context.Context, att uploadAttempt, contentType string, size int64, checksum, version string) (files.Upload, error) {
	var result files.Upload
	ctx = context.WithoutCancel(ctx)
	err := s.inTx(ctx, func(q *db.Queries) error {
		now := s.now()
		claimExpires := now.Add(files.ClaimTTL)
		held, err := s.stillHolds(ctx, q, att)
		if err != nil {
			return err
		}
		if !held {
			return errAttemptSuperseded
		}
		if _, err := q.MarkUploadSessionStaged(ctx, db.MarkUploadSessionStagedParams{
			ID: att.session.ID, ClaimExpiresAt: fileTime(claimExpires),
		}); err != nil {
			return fmt.Errorf("files: stage session: %w", err)
		}
		if _, err := q.MarkFileReady(ctx, db.MarkFileReadyParams{
			ID: att.file.ID, ContentType: fileText(contentType), SizeBytes: pgtype.Int8{Int64: size, Valid: true},
			ChecksumSha256: fileText(checksum), Metadata: []byte("{}"), ObjectVersion: fileText(version),
			ReadyAt: fileTime(now),
		}); err != nil {
			return fmt.Errorf("files: mark ready: %w", err)
		}
		if _, err := q.CancelPendingFileJobs(ctx, db.CancelPendingFileJobsParams{FileID: att.file.ID, Operation: fileJobReconcile, FinishedAt: fileTime(s.now())}); err != nil {
			return fmt.Errorf("files: void reconcile: %w", err)
		}
		file, err := q.GetFileByID(ctx, att.file.ID)
		if err != nil {
			return fmt.Errorf("files: read back: %w", err)
		}
		result = files.Upload{File: fileView(file), UploadSessionID: att.session.ID, ClaimExpiresAt: claimExpires}
		return nil
	})
	if errors.Is(err, errAttemptSuperseded) {
		s.abandonAttempt(ctx, att)
		return files.Upload{}, files.UploadCanceled(files.FileID(att.file.ID))
	}
	if err != nil {
		// The object is stored but the finalize did not commit: the reconcile
		// job from the intent is still pending and finds it (spec 9.4).
		return files.Upload{}, err
	}
	return result, nil
}

// takeLease gives owner the session's write lease until expires, or refuses
// while another writer's lease is live.
func (s *FileService) takeLease(ctx context.Context, q *db.Queries, sessionID, owner string, expires, now time.Time) (string, error) {
	n, err := q.AcquireUploadSessionLease(ctx, db.AcquireUploadSessionLeaseParams{
		ID: sessionID, LeaseOwner: fileText(owner), LeaseExpiresAt: fileTime(expires), Now: fileTime(now),
	})
	if err != nil {
		return "", fmt.Errorf("files: take lease: %w", err)
	}
	if n == 0 {
		return "", files.NewError(files.CodeIdempotencyConflict, "an upload with this idempotency key is still in progress")
	}
	return owner, nil
}

// stillHolds locks the session and reports whether this writer still owns it:
// still receiving, still bound to this attempt's file, and the lease still
// this writer's. A cancel that won the race, or a retry that took over after
// the lease expired, makes it false.
func (s *FileService) stillHolds(ctx context.Context, q *db.Queries, att uploadAttempt) (bool, error) {
	cur, err := q.GetUploadSessionByIDForUpdate(ctx, att.session.ID)
	if err != nil {
		return false, fmt.Errorf("files: lock session: %w", err)
	}
	return cur.Status == string(files.SessionReceiving) && cur.FileID == att.file.ID &&
		cur.LeaseOwner.String == att.leaseOwner, nil
}

// errAttemptSuperseded: the session left this writer's hands (canceled, or
// taken over after the lease expired) before the finalize.
var errAttemptSuperseded = errors.New("files: upload attempt was superseded")

// uploadFingerprint is what an idempotency key is bound to: the same key with
// a different actor, scope, purpose or filename is another command (T1-Q8).
// Without a checksum it cannot tell two different bodies apart, and it does
// not claim to.
func uploadFingerprint(in files.UploadInput) string {
	h := sha256.New()
	for _, part := range []string{
		"upload", string(in.Purpose), in.Scope.OrganizationID, in.Scope.WorkspaceID, in.Scope.UserID,
		string(in.Actor.Kind), in.Actor.ID, in.Filename,
	} {
		h.Write([]byte(part))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// --- spool ------------------------------------------------------------------

var errSpoolOverCap = errors.New("files: stream passed the purpose byte cap")

// spooledBody is a validated copy of an upload body on local disk: its size
// measured on the stream, the head the detector reads and the SHA-256 of
// every byte (stored only when the policy asks, T1-Q2).
type spooledBody struct {
	file   *os.File
	size   int64
	head   []byte
	sha256 string
}

func spoolBody(dir string, body io.Reader, capBytes int64) (*spooledBody, error) {
	f, err := os.CreateTemp(dir, "uniwork-upload-*")
	if err != nil {
		return nil, err
	}
	sp := &spooledBody{file: f}
	h := sha256.New()
	head := &headBuffer{limit: files.DetectHeadBytes}
	n, err := io.Copy(io.MultiWriter(f, h, head), io.LimitReader(body, capBytes+1))
	if err != nil {
		sp.close()
		return nil, err
	}
	if n > capBytes {
		sp.close()
		return nil, errSpoolOverCap
	}
	sp.size = n
	sp.head = head.buf.Bytes()
	sp.sha256 = hex.EncodeToString(h.Sum(nil))
	return sp, nil
}

func (sp *spooledBody) reader() io.ReadSeeker {
	_, _ = sp.file.Seek(0, io.SeekStart)
	return sp.file
}

func (sp *spooledBody) close() {
	name := sp.file.Name()
	_ = sp.file.Close()
	_ = os.Remove(name)
}

// headBuffer keeps the first limit bytes written to it.
type headBuffer struct {
	buf   bytes.Buffer
	limit int
}

func (h *headBuffer) Write(p []byte) (int, error) {
	if room := h.limit - h.buf.Len(); room > 0 {
		if len(p) > room {
			h.buf.Write(p[:room])
		} else {
			h.buf.Write(p)
		}
	}
	return len(p), nil
}

// --- cancel -------------------------------------------------------------------

// CancelUpload revokes an unclaimed upload. The actor and the scope must be
// the ones that staged it - anything else is file_not_found - and repeating
// the cancel answers the same nothing. The file keeps its ready_at and joins
// the ordinary garbage schedule (T1-Q5): its cleanup job is due when the claim
// window would have closed, not later.
func (s *FileService) CancelUpload(ctx context.Context, in files.CancelInput) error {
	return s.inTx(ctx, func(q *db.Queries) error {
		now := s.now()
		fileByID, sessByFile, err := lockForClaim(ctx, q, []files.FileID{in.FileID})
		if err != nil {
			return err
		}
		file, fok := fileByID[in.FileID]
		sess, sok := sessByFile[in.FileID]
		if !fok || !inScope(file, sess, sok, in.Scope) ||
			sess.CreatedByKind != string(in.Actor.Kind) || sess.CreatedBy != in.Actor.ID {
			return files.NotFound(in.FileID)
		}
		switch files.Status(file.Status) {
		case files.StatusDeleting:
			return files.Deleting(in.FileID)
		case files.StatusDeleted:
			return files.NotFound(in.FileID)
		}
		switch files.SessionStatus(sess.Status) {
		case files.SessionClaimed:
			return files.AlreadyClaimed(in.FileID)
		case files.SessionCanceled, files.SessionExpired:
			return nil
		}
		if _, err := q.CancelUploadSession(ctx, db.CancelUploadSessionParams{ID: sess.ID, ClosedAt: fileTime(now)}); err != nil {
			return fmt.Errorf("files: cancel: %w", err)
		}
		due := now
		if sess.ClaimExpiresAt.Valid {
			due = sess.ClaimExpiresAt.Time
		}
		return s.enqueueJob(ctx, q, file, fileJobCleanup, due)
	})
}

// --- provider output ------------------------------------------------------------

// RegisterProviderOutput records the intent and file id before an external
// writer starts (T8 recordings, Office outputs). The operation id is the
// idempotency key: a retry or webhook replay finds the same file. The write
// target comes from the ProviderWriteSigner seam and covers exactly the key
// minted here, which carries the purpose's ObjectKeySuffix.
func (s *FileService) RegisterProviderOutput(ctx context.Context, in files.ProviderOutputInput) (files.ProviderOutput, error) {
	spec, err := s.registry.Lookup(in.Purpose)
	if err != nil {
		return files.ProviderOutput{}, err
	}
	if err := spec.ValidateScope(in.Scope); err != nil {
		return files.ProviderOutput{}, err
	}
	if strings.TrimSpace(in.OperationID) == "" {
		return files.ProviderOutput{}, errFileOperationRequired
	}
	if !validActor(in.Actor) {
		return files.ProviderOutput{}, errFileActorRequired
	}
	now := s.now()
	if !in.Deadline.After(now) {
		return files.ProviderOutput{}, errFileDeadlinePassed
	}

	existing, err := s.q.GetUploadSessionByProviderOp(ctx, fileText(in.OperationID))
	switch {
	case err == nil:
		if existing.Purpose != string(in.Purpose) || sessionScope(existing) != in.Scope {
			return files.ProviderOutput{}, files.IdempotencyConflict(in.OperationID)
		}
		file, err := s.q.GetFileByID(ctx, existing.FileID)
		if err != nil {
			return files.ProviderOutput{}, fmt.Errorf("files: provider replay: %w", err)
		}
		return s.signProviderOutput(ctx, file, in.Deadline, now)
	case !errors.Is(err, pgx.ErrNoRows):
		return files.ProviderOutput{}, fmt.Errorf("files: find operation: %w", err)
	}

	// Sign before recording: an adapter that cannot sign leaves no intent.
	id := files.FileID(s.newID())
	key, err := mintObjectKey(spec, in.Scope, id, now)
	if err != nil {
		return files.ProviderOutput{}, err
	}
	loc := storage.ObjectLocator{Storage: s.backend, Bucket: s.bucket, Key: key}
	target, err := s.writeTarget(ctx, loc, in.Deadline, now)
	if err != nil {
		return files.ProviderOutput{}, err
	}
	err = s.inTx(ctx, func(q *db.Queries) error {
		file, err := q.InsertFile(ctx, db.InsertFileParams{
			ID: string(id), OrganizationID: fileText(in.Scope.OrganizationID), Storage: string(s.backend),
			Bucket: fileText(s.bucket), ObjectKey: key,
			OriginalFilename: files.SanitizeFilename("") + spec.Policy.ObjectKeySuffix, Metadata: []byte("{}"),
		})
		if err != nil {
			return fmt.Errorf("files: record provider intent: %w", err)
		}
		sess, err := q.InsertUploadSession(ctx, db.InsertUploadSessionParams{
			ID: s.newID(), FileID: file.ID, CreatedBy: in.Actor.ID, CreatedByKind: string(in.Actor.Kind),
			Purpose: string(spec.Purpose), OrganizationID: fileText(in.Scope.OrganizationID),
			WorkspaceID: fileText(in.Scope.WorkspaceID), UserID: fileText(in.Scope.UserID),
			IdempotencyKey: providerKey(in.OperationID), CommandFingerprint: providerFingerprint(in),
			ProviderOperationID: fileText(in.OperationID),
		})
		if err != nil {
			return fmt.Errorf("files: record provider session: %w", err)
		}
		// The provider is the writer until its deadline.
		if _, err := s.takeLease(ctx, q, sess.ID, providerKey(in.OperationID), in.Deadline, now); err != nil {
			return err
		}
		// A provider that never reports back is found by this job.
		return s.enqueueJob(ctx, q, file, fileJobReconcile, in.Deadline)
	})
	if err != nil {
		if isUniqueViolation(err) {
			// A concurrent registration of the same operation won; answer as
			// its replay.
			return s.RegisterProviderOutput(ctx, in)
		}
		return files.ProviderOutput{}, err
	}
	return files.ProviderOutput{FileID: id, WriteTarget: target}, nil
}

func (s *FileService) signProviderOutput(ctx context.Context, file db.File, deadline, now time.Time) (files.ProviderOutput, error) {
	target, err := s.writeTarget(ctx, locator(file), deadline, now)
	if err != nil {
		return files.ProviderOutput{}, err
	}
	return files.ProviderOutput{FileID: files.FileID(file.ID), WriteTarget: target}, nil
}

// writeTarget signs a PUT for exactly loc, valid until deadline on the
// service clock. An adapter that cannot sign writes (local) answers
// storage_unavailable, never a URL that looks usable.
func (s *FileService) writeTarget(ctx context.Context, loc storage.ObjectLocator, deadline, now time.Time) (files.WriteTarget, error) {
	signed, err := s.signer.SignWrite(ctx, loc, storage.SignOptions{TTL: deadline.Sub(now)})
	if err != nil {
		return files.WriteTarget{}, files.StorageUnavailable(err)
	}
	return files.WriteTarget{URL: signed.URL, Method: signed.Method, Headers: map[string]string{}, ExpiresAt: deadline}, nil
}

func providerKey(operationID string) string { return "provider:" + operationID }

func providerFingerprint(in files.ProviderOutputInput) string {
	h := sha256.New()
	for _, part := range []string{"provider", string(in.Purpose), in.Scope.OrganizationID, in.Scope.WorkspaceID, in.Scope.UserID, in.OperationID} {
		h.Write([]byte(part))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// CompleteProviderOutput verifies what the provider wrote - the stored size
// against the cap, the verified type from the object's own head, and the
// SHA-256 only when the policy requires one or the provider reported one - and
// then marks the file ready and staged for ClaimInTx. A replay after success
// returns the same file. A refusal leaves the file as it was, so a corrected
// report or a rewritten object completes later.
func (s *FileService) CompleteProviderOutput(ctx context.Context, in files.CompleteOutputInput) (files.File, error) {
	records, err := s.loadInScope(ctx, s.q, in.Scope, []files.FileID{in.FileID})
	if err != nil {
		return files.File{}, err
	}
	rec, ok := records[in.FileID]
	if !ok || !rec.session.ProviderOperationID.Valid {
		return files.File{}, files.NotFound(in.FileID)
	}
	operation := rec.session.ProviderOperationID.String
	if in.OperationID != "" && in.OperationID != operation {
		return files.File{}, files.IdempotencyConflict(in.OperationID)
	}
	switch files.Status(rec.file.Status) {
	case files.StatusReady:
		return fileView(rec.file), nil
	case files.StatusDeleting:
		return files.File{}, files.Deleting(in.FileID)
	case files.StatusDeleted, files.StatusFailed:
		return files.File{}, files.NotFound(in.FileID)
	}
	if files.SessionStatus(rec.session.Status) == files.SessionCanceled {
		return files.File{}, files.UploadCanceled(in.FileID)
	}
	spec, err := s.registry.Lookup(files.UploadPurpose(rec.session.Purpose))
	if err != nil {
		return files.File{}, err
	}

	loc := locator(rec.file)
	info, err := s.store.Stat(ctx, loc)
	if errors.Is(err, storage.ErrNotFound) {
		return files.File{}, files.NotReady(in.FileID)
	}
	if err != nil {
		return files.File{}, files.StorageUnavailable(err)
	}
	size := info.SizeBytes
	if size > spec.Policy.MaxBytes {
		return files.File{}, files.TooLarge(spec.Policy.MaxBytes)
	}
	head, err := s.readObjectHead(ctx, loc)
	if err != nil {
		return files.File{}, files.StorageUnavailable(err)
	}
	// A provider output carries no filename (FS-C1 section 4): only the bytes
	// speak, so the extension-hinted text types stay text/plain here.
	contentType := spec.Policy.Canonical(files.DetectContentType(head, ""))
	if !spec.Policy.Allows(contentType) {
		return files.File{}, files.TypeRejected(contentType)
	}
	checksum := ""
	if spec.Policy.ChecksumRequired || in.ChecksumSHA256 != "" {
		sum, err := s.hashObject(ctx, loc)
		if err != nil {
			return files.File{}, files.StorageUnavailable(err)
		}
		if in.ChecksumSHA256 != "" && !strings.EqualFold(in.ChecksumSHA256, sum) {
			return files.File{}, fmt.Errorf("%w: provider output %s", files.ErrOutputVerification, string(in.FileID))
		}
		checksum = sum
	}

	att := uploadAttempt{file: rec.file, session: rec.session, leaseOwner: providerKey(operation)}
	up, err := s.publishUpload(ctx, att, contentType, size, checksum, info.VersionID)
	if err != nil {
		return files.File{}, err
	}
	return up.File, nil
}
