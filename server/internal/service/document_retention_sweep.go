package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Retention of rows nothing reads again (RETENTION-02, UNI-1921; spec
// docs/superpowers/specs/2026-10-18-documents-purge-retention-addendum.md §6).
// Three tables whose closed rows live forever today:
//
//   - office_jobs in a terminal state (completed/failed/timed_out/cancelled):
//     the G1-03 commit path reads the row behind a staged engine output
//     (GetOfficeJobByOutputFile), so the window must outlast FileService's
//     claim window. Past that window the row is gone: a job status/output read
//     or an acceptConversion replay answers not found, and a start that reuses
//     the old idempotency key is a fresh command, not a replay - the row was
//     the only record of that key (uidx_office_jobs_idempotency).
//   - file_multipart_uploads closed (completed/aborted/expired/failed) - a
//     replay answers from the row (a completed result, a stored failure), so
//     the window must outlast the session TTL plus the validation lease.
//   - document_break_glass_grants ended (revoked or expired) - revoking an
//     already-ended grant answers an idempotent 200 from the row
//     (GetDocumentBreakGlassGrant reads every state); past the window that
//     revoke answers not found, the documented consequence.
//
// Deleting a dead row changes no business state - the transition already
// happened, with its audit row - so no sweep writes an audit row, like
// OfficeLeaseSweeper, SweepCommitIntents and EventRetention.
//
// Each window is ONE named constant so a user answer to Q-RT2-1 / Q-RT2-3 is
// a one-line change. The floor under each is the reader named above, held by
// the compile-time guard below and by TestDocumentRetentionSweepFloors.
const (
	// officeJobRetention keeps a settled job past files.ClaimTTL (24h): a
	// staged engine output can still be committed inside its claim window,
	// and that commit reads this row. Q-RT2-1 is with the user; the default
	// is 30 days (safe band 7-90).
	officeJobRetention = 30 * 24 * time.Hour
	// multipartRowRetention keeps a closed session past UploadSessionTTL plus
	// UploadSessionValidationLeaseTTL (24h + 10m): a replay of the completed
	// result and a stored failure are both answered from this row.
	// Q-RT2-2 is engineering; the default is 7 days (safe band 2-30).
	multipartRowRetention = 7 * 24 * time.Hour
	// breakGlassRetention keeps an ended grant past zero: a late revoke must
	// still answer its idempotent 200. Q-RT2-3 is with the user; the default
	// is 30 days (safe band 7-365).
	breakGlassRetention = 30 * 24 * time.Hour

	// retentionSweepBatch / MaxBatches / Pause pace one pass: 500 rows a
	// batch, at most 20 batches, a short pause between them - like
	// OfficeLeaseSweeper, so a first pass over a large backlog spreads across
	// passes instead of holding a connection.
	retentionSweepBatch      = int32(500)
	retentionSweepMaxBatches = 20
	retentionSweepPause      = 100 * time.Millisecond
)

// Compile-time floors (spec §6.2 (c)). A window at or below its floor makes
// the difference non-positive, and converting that constant to uint fails the
// build - so an edit that drops a window below what its readers need cannot
// compile, not merely fail a test.
const (
	_ = uint(officeJobRetention - files.ClaimTTL - 1)
	_ = uint(multipartRowRetention - (UploadSessionTTL + UploadSessionValidationLeaseTTL) - 1)
	_ = uint(breakGlassRetention - 1)
)

// SweepOfficeJobs deletes settled office_jobs rows older than the window
// before now, in batches, until a batch comes back short, the batch cap is
// reached, or ctx ends. It returns the rows deleted. It is system-wide by
// design: every reader of a terminal row is tenant-scoped already, so the
// sweep takes no tenant.
func (s *DocumentService) SweepOfficeJobs(ctx context.Context, now time.Time) (int64, error) {
	if s == nil || s.q == nil {
		return 0, nil
	}
	return s.sweepRetentionRows(ctx, now.Add(-officeJobRetention), func(ctx context.Context, cutoff pgtype.Timestamptz, limit int32) (int64, error) {
		return s.q.SweepOfficeJobs(ctx, db.SweepOfficeJobsParams{Cutoff: cutoff, BatchLimit: limit})
	})
}

// SweepFileMultipartUploads deletes closed file_multipart_uploads rows older
// than the window before now, in batches. System-wide for the same reason as
// SweepOfficeJobs.
func (s *DocumentService) SweepFileMultipartUploads(ctx context.Context, now time.Time) (int64, error) {
	if s == nil || s.q == nil {
		return 0, nil
	}
	return s.sweepRetentionRows(ctx, now.Add(-multipartRowRetention), func(ctx context.Context, cutoff pgtype.Timestamptz, limit int32) (int64, error) {
		return s.q.SweepFileMultipartUploads(ctx, db.SweepFileMultipartUploadsParams{Cutoff: cutoff, BatchLimit: limit})
	})
}

// SweepDocumentBreakGlassGrants deletes ended document_break_glass_grants rows
// older than the window before now, in batches. System-wide for the same
// reason as SweepOfficeJobs.
func (s *DocumentService) SweepDocumentBreakGlassGrants(ctx context.Context, now time.Time) (int64, error) {
	if s == nil || s.q == nil {
		return 0, nil
	}
	return s.sweepRetentionRows(ctx, now.Add(-breakGlassRetention), func(ctx context.Context, cutoff pgtype.Timestamptz, limit int32) (int64, error) {
		return s.q.SweepDocumentBreakGlassGrants(ctx, db.SweepDocumentBreakGlassGrantsParams{Cutoff: cutoff, BatchLimit: limit})
	})
}

// sweepRetentionRows is the one batching loop the three retention sweeps
// share: delete up to retentionSweepBatch rows a batch, up to
// retentionSweepMaxBatches batches, pausing between batches, stopping early
// when a batch comes back short.
func (s *DocumentService) sweepRetentionRows(
	ctx context.Context,
	cutoffTime time.Time,
	del func(context.Context, pgtype.Timestamptz, int32) (int64, error),
) (int64, error) {
	cutoff := pgtype.Timestamptz{Time: cutoffTime.UTC().Truncate(time.Microsecond), Valid: true}
	var total int64
	for range retentionSweepMaxBatches {
		n, err := del(ctx, cutoff, retentionSweepBatch)
		total += n
		if err != nil {
			return total, err
		}
		if n < int64(retentionSweepBatch) {
			return total, nil
		}
		if !retentionPause(ctx, retentionSweepPause) {
			return total, ctx.Err()
		}
	}
	return total, nil
}
