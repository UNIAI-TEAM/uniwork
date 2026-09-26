package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Reconcile (T5, spec 9.4). The upload pipeline records its intent - file
// row, session with a write lease, and a reconcile job due when the lease
// ends - before a byte reaches storage. The collector drains those jobs in the
// same daily sweep and settles what the writer left:
//
//   - ready: the writer finished; the object must still be there, and a
//     missing one is reported and kept (a lost object is a recovery case,
//     never a reason to drop the business reference);
//   - pending with the lease still running: wait for the lease;
//   - pending after the lease, plain upload: the writer was this API and its
//     lease lapsed, so the attempt is abandoned - the lease is withdrawn (a
//     late finalize then fails its own lease check), the file is marked failed
//     and handed to cleanup, and the tombstone is checked again for a late Put;
//   - pending after the deadline, provider output: an expired lease does not
//     prove the provider stopped. An object that is there is verified and
//     finished (late completion); no object is quarantined, never deleted;
//   - failed or deleting: cleanup owns it;
//   - deleted (tombstone): a managed key that has an object again got a late
//     write, which is removed - nothing can reference a deleted file.
//
// abort_multipart jobs are kept with a code until an adapter can abort a
// multipart upload: no adapter exposes it yet, and dropping the intent would
// leak the parts silently.

// fileGCSystemActor completes a late provider output on the provider's
// behalf; the provider already reported its operation.
var fileGCSystemActor = audit.Actor{Kind: audit.KindSystem, ID: "file-gc"}

// FileGCWouldConfirm is the dry-run form of FileGCConfirmed.
const FileGCWouldConfirm FileGCAction = "would_confirm"

// reconcileOutcome is the decision for one reconcile job. apply, when set, is
// the destructive change that goes with it, run under the file lock in the
// transaction that also closes or retries the job.
type reconcileOutcome struct {
	action  FileGCAction
	reason  string
	retryAt time.Time
	apply   func(ctx context.Context, q *db.Queries) error
}

func (r *fileGCRun) reconcileJob(ctx context.Context, job db.FileJob) {
	s := r.svc
	out := r.judgeReconcile(ctx, job)
	entry := FileGCEntry{FileID: files.FileID(job.FileID), JobID: job.ID, Operation: job.Operation, Action: out.action, Reason: out.reason}
	if !r.destructive {
		switch out.action {
		case FileGCDeleted:
			entry.Action = FileGCWouldDelete
		case FileGCConfirmed:
			entry.Action = FileGCWouldConfirm
		}
		r.rep.add(entry)
		return
	}
	err := s.inTx(ctx, func(q *db.Queries) error {
		if _, err := q.LockFilesInIDOrder(ctx, []string{job.FileID}); err != nil {
			return fmt.Errorf("files: reconcile lock file: %w", err)
		}
		if out.apply != nil {
			if err := out.apply(ctx, q); err != nil {
				return err
			}
		}
		switch out.action {
		case FileGCRetry, FileGCQuarantined:
			return retryJob(ctx, q, job, out.retryAt, out.reason)
		default:
			return completeJob(ctx, q, job, s.now())
		}
	})
	if err != nil {
		slog.Warn("files gc: reconcile not applied, retried next sweep", "file", job.FileID, "err", err)
		entry.Action, entry.Reason = FileGCRetry, "reconcile_failed"
	}
	r.rep.add(entry)
}

// judgeReconcile reads the job's file and session, talks to storage when it
// must (Stat, a late-object delete, a late provider completion - only in
// destructive mode for the last two) and returns the outcome.
func (r *fileGCRun) judgeReconcile(ctx context.Context, job db.FileJob) reconcileOutcome {
	s := r.svc
	now := s.now()
	retry := func(code string) reconcileOutcome {
		return reconcileOutcome{action: FileGCRetry, reason: code, retryAt: s.retryBackoff(job, now)}
	}
	quarantine := func(code string) reconcileOutcome {
		return reconcileOutcome{action: FileGCQuarantined, reason: code, retryAt: s.retryBackoff(job, now)}
	}
	if job.Operation != fileJobReconcile {
		slog.Warn("files gc: multipart abort is not supported by the adapter; intent kept", "file", job.FileID)
		return quarantine("abort_multipart_unsupported")
	}
	file, err := s.q.GetFileByID(ctx, job.FileID)
	if errors.Is(err, pgx.ErrNoRows) {
		return reconcileOutcome{action: FileGCDone, reason: "file_missing"}
	}
	if err != nil {
		return retry("db_unavailable")
	}
	handToCleanup := func(ctx context.Context, q *db.Queries) error {
		return s.enqueueJob(ctx, q, file, fileJobCleanup, s.now())
	}

	switch files.Status(file.Status) {
	case files.StatusReady:
		return s.reconcileReady(ctx, file, retry, quarantine)
	case files.StatusFailed, files.StatusDeleting:
		return reconcileOutcome{action: FileGCDone, reason: "cleanup_owns_" + file.Status, apply: handToCleanup}
	case files.StatusDeleted:
		return r.reconcileTombstone(ctx, file, retry)
	}

	// pending / processing: the intent-before-Put window.
	sess, err := s.q.GetUploadSessionByFile(ctx, file.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		// A technical retry repointed the session at a newer attempt; this
		// one is only tracked for cleanup (spec 9.4).
		return reconcileOutcome{action: FileGCDone, reason: "superseded_attempt", apply: func(ctx context.Context, q *db.Queries) error {
			if _, err := q.MarkFileFailed(ctx, file.ID); err != nil {
				return fmt.Errorf("files: reconcile fail attempt: %w", err)
			}
			return handToCleanup(ctx, q)
		}}
	}
	if err != nil {
		return retry("db_unavailable")
	}
	switch files.SessionStatus(sess.Status) {
	case files.SessionCanceled, files.SessionExpired:
		return reconcileOutcome{action: FileGCDone, reason: "canceled_intent", apply: func(ctx context.Context, q *db.Queries) error {
			if _, err := q.MarkFileFailed(ctx, file.ID); err != nil {
				return fmt.Errorf("files: reconcile fail canceled: %w", err)
			}
			return handToCleanup(ctx, q)
		}}
	case files.SessionReceiving:
	default:
		return quarantine("session_state_mismatch")
	}
	if sess.LeaseExpiresAt.Valid && sess.LeaseExpiresAt.Time.After(now) {
		return reconcileOutcome{action: FileGCRetry, reason: "writer_active", retryAt: sess.LeaseExpiresAt.Time}
	}
	if sess.ProviderOperationID.Valid {
		return r.reconcileProviderOutput(ctx, file, sess, quarantine, retry)
	}
	// Plain upload whose lease lapsed: withdraw the lease only if nobody
	// renewed it since this read, then fail the attempt.
	observed := sess
	return reconcileOutcome{action: FileGCDone, reason: "abandoned_intent", apply: func(ctx context.Context, q *db.Queries) error {
		cur, err := q.GetUploadSessionByIDForUpdate(ctx, observed.ID)
		if err != nil {
			return fmt.Errorf("files: reconcile lock session: %w", err)
		}
		if cur.Status != string(files.SessionReceiving) || cur.FileID != file.ID ||
			cur.LeaseOwner != observed.LeaseOwner || cur.LeaseExpiresAt != observed.LeaseExpiresAt {
			return errReconcileRaced
		}
		if cur.LeaseOwner.Valid {
			if _, err := q.ReleaseUploadSessionLease(ctx, db.ReleaseUploadSessionLeaseParams{ID: cur.ID, LeaseOwner: cur.LeaseOwner}); err != nil {
				return fmt.Errorf("files: reconcile withdraw lease: %w", err)
			}
		}
		if _, err := q.MarkFileFailed(ctx, file.ID); err != nil {
			return fmt.Errorf("files: reconcile fail abandoned: %w", err)
		}
		return handToCleanup(ctx, q)
	}}
}

// errReconcileRaced: the writer moved between the read and the lock; the job
// is retried on a later sweep with a fresh read.
var errReconcileRaced = errors.New("files: reconcile raced a writer")

// reconcileReady confirms that a ready file still has its object. A missing
// object keeps everything and raises the alarm (spec 10.1).
func (s *FileService) reconcileReady(ctx context.Context, file db.File, retry, quarantine func(string) reconcileOutcome) reconcileOutcome {
	loc := locator(file)
	if loc.Storage != s.backend || loc.Bucket != s.bucket {
		return retry("storage_adapter_missing")
	}
	_, err := s.store.Stat(ctx, loc)
	switch {
	case err == nil:
		return reconcileOutcome{action: FileGCDone, reason: "ready"}
	case errors.Is(err, storage.ErrNotFound):
		slog.Warn("files gc: ready file has no object; references kept, recovery needed", "file", file.ID)
		return quarantine("object_missing")
	default:
		return retry(files.CodeStorageUnavailable)
	}
}

// reconcileTombstone looks for a late write at a deleted file's key.
func (r *fileGCRun) reconcileTombstone(ctx context.Context, file db.File, retry func(string) reconcileOutcome) reconcileOutcome {
	s := r.svc
	if ok, _ := s.managedLocator(file, db.FileUploadSession{}, false); !ok {
		return reconcileOutcome{action: FileGCDone, reason: "tombstone_unmanaged"}
	}
	loc := locator(file)
	info, err := s.store.Stat(ctx, loc)
	switch {
	case errors.Is(err, storage.ErrNotFound):
		return reconcileOutcome{action: FileGCDone, reason: "tombstone_clean"}
	case err != nil:
		return retry(files.CodeStorageUnavailable)
	}
	// A late writer put bytes at a key whose file is gone for good.
	if !r.destructive {
		return reconcileOutcome{action: FileGCDeleted, reason: "late_object"}
	}
	if info.VersionID != "" {
		loc.Version = info.VersionID
	}
	late := file
	late.ObjectVersion = fileText(loc.Version)
	if err := s.removeObject(ctx, late); err != nil {
		return retry(gcStorageCode(err))
	}
	return reconcileOutcome{action: FileGCDeleted, reason: "late_object"}
}

// reconcileProviderOutput settles a provider output past its deadline: the
// object is verified and finished when it is there, and quarantined when it
// is not - the provider may still be writing.
func (r *fileGCRun) reconcileProviderOutput(ctx context.Context, file db.File, sess db.FileUploadSession, quarantine, retry func(string) reconcileOutcome) reconcileOutcome {
	s := r.svc
	loc := locator(file)
	if loc.Storage != s.backend || loc.Bucket != s.bucket {
		return retry("storage_adapter_missing")
	}
	_, err := s.store.Stat(ctx, loc)
	switch {
	case errors.Is(err, storage.ErrNotFound):
		slog.Warn("files gc: provider output missing after its deadline; kept for confirmation", "file", file.ID)
		return quarantine("writer_unconfirmed")
	case err != nil:
		return retry(files.CodeStorageUnavailable)
	}
	if !r.destructive {
		return reconcileOutcome{action: FileGCConfirmed, reason: "late_completion"}
	}
	_, err = s.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor: fileGCSystemActor, Scope: sessionScope(sess), FileID: files.FileID(file.ID),
		OperationID: sess.ProviderOperationID.String,
	})
	if err != nil {
		code := "output_unverified"
		var fe *files.Error
		if errors.As(err, &fe) {
			code = fe.Code
		}
		slog.Warn("files gc: late provider output did not verify; kept", "file", file.ID, "code", code)
		return quarantine(code)
	}
	return reconcileOutcome{action: FileGCConfirmed, reason: "late_completion"}
}
