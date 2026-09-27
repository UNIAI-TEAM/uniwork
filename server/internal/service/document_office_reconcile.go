package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Reconciliation: Go's office_jobs row is the durable outcome; the engine's
// in-memory state and the FileService provider-output intent are the two
// sources it is reconciled against. Every write below is a compare-and-set,
// so a status poll, a cancel, the reconciler and a late engine answer can
// race freely - the first transition out of a live state wins and the rest
// read the row back.

func isLiveOfficeState(state string) bool {
	return state == string(office.JobAccepted) || state == string(office.JobRunning)
}

// Refresh brings a live job up to date with the engine. A settled job is
// returned as it is: a late engine answer never changes a settled row.
func (s *DocumentOfficeService) Refresh(ctx context.Context, row db.OfficeJob) (db.OfficeJob, error) {
	if !isLiveOfficeState(row.State) || s.engine == nil {
		return row, nil
	}
	grant, err := s.grantFor(row, nil, nil)
	if err != nil {
		return row, err
	}
	js, err := s.engine.Status(ctx, row.ID, grant)
	switch {
	case err == nil:
		return s.apply(ctx, row, js)
	case office.ErrorCode(err) == "not_found":
		return s.reconcileLost(ctx, row)
	default:
		// Engine unreachable or refusing: the row stays live until Go's own
		// clock says the deadline has passed.
		if s.pastDeadline(row) {
			return s.settle(ctx, row, office.JobTimedOut, "engine_timeout", "engine_unreachable")
		}
		return row, nil
	}
}

func (s *DocumentOfficeService) pastDeadline(row db.OfficeJob) bool {
	return s.now().After(row.DeadlineAt.Time.Add(officeDeadlineGrace))
}

// apply maps one engine status onto the row.
func (s *DocumentOfficeService) apply(ctx context.Context, row db.OfficeJob, js office.JobStatus) (db.OfficeJob, error) {
	if js.JobID != row.ID {
		return row, office.NewEngineError("engine_result_invalid", "job_id")
	}
	reason := ""
	code := ""
	if js.Error != nil {
		code, reason = js.Error.Code, js.Error.Reason
	}
	switch js.State {
	case office.JobCompleted:
		return s.verifyOutput(ctx, row, js.OutputChecksum, js.OutputLength)
	case office.JobFailed, office.JobCrashed:
		if code == "" {
			code = "engine_crashed"
		}
		return s.settle(ctx, row, office.JobFailed, code, reason)
	case office.JobTimedOut:
		return s.settle(ctx, row, office.JobTimedOut, "engine_timeout", reason)
	case office.JobCancelled:
		return s.cancelRow(ctx, row, "engine_cancelled")
	default: // accepted or running on the engine
		if s.pastDeadline(row) {
			if grant, err := s.grantFor(row, nil, nil); err == nil {
				_, _ = s.engine.Cancel(ctx, row.ID, grant)
			}
			return s.settle(ctx, row, office.JobTimedOut, "engine_timeout", "deadline")
		}
		if row.State == string(office.JobAccepted) {
			running, err := s.q.MarkOfficeJobRunning(ctx, db.MarkOfficeJobRunningParams{
				Now: s.ts(), ID: row.ID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return s.get(ctx, row.OrganizationID, row.WorkspaceID, row.ID)
			}
			return running, err
		}
		return row, nil
	}
}

// reconcileLost handles an engine that does not know the job (restart, or
// the dispatch never arrived). The provider-output intent decides: an object
// that verifies was written in full before the engine went away (the engine
// uploads only a measured, finished output), so the job completed; no object
// means the work was lost.
func (s *DocumentOfficeService) reconcileLost(ctx context.Context, row db.OfficeJob) (db.OfficeJob, error) {
	settled, err := s.verifyOutput(ctx, row, "", nil)
	if err == nil && settled.State != row.State {
		return settled, nil
	}
	var fe *files.Error
	if errors.As(err, &fe) && fe.Code == files.CodeNotReady {
		if row.DispatchedAt.Valid {
			return s.settle(ctx, row, office.JobFailed, "engine_crashed", "engine_lost_job")
		}
		if s.pastDeadline(row) {
			return s.settle(ctx, row, office.JobTimedOut, "engine_timeout", "never_dispatched")
		}
		return row, nil
	}
	return settled, err
}

// verifyOutput asks FileService to verify the object (stat, size, MIME, and
// the engine's checksum when it reported one) and completes the job with
// FileService's measured values - never with the engine's claim alone.
func (s *DocumentOfficeService) verifyOutput(ctx context.Context, row db.OfficeJob, checksum string, length *int64) (db.OfficeJob, error) {
	if !row.OutputFileID.Valid {
		return s.settle(ctx, row, office.JobFailed, "engine_result_invalid", "no_output_file")
	}
	f, err := s.files.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor:          audit.Actor{Kind: audit.Kind(row.CreatedByKind), ID: row.CreatedBy},
		Scope:          files.Scope{OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID},
		FileID:         files.FileID(row.OutputFileID.String),
		OperationID:    officeOperationID(row.ID),
		ChecksumSHA256: checksum,
	})
	var fe *files.Error
	switch {
	case err == nil:
	case errors.Is(err, files.ErrOutputVerification):
		return s.settle(ctx, row, office.JobFailed, "engine_checksum_mismatch", "output_checksum")
	case errors.As(err, &fe) && fe.Code == files.CodeTooLarge:
		return s.settle(ctx, row, office.JobFailed, "upload_bounds", "output_limit")
	case errors.As(err, &fe) && fe.Code == files.CodeTypeRejected:
		return s.settle(ctx, row, office.JobFailed, "engine_result_invalid", "output_type")
	case errors.As(err, &fe) && fe.Code == files.CodeNotReady && checksum != "":
		// The engine says completed but the object is not there.
		return s.settle(ctx, row, office.JobFailed, "object_missing", "output_not_written")
	default:
		return row, err
	}
	if length != nil && *length != f.SizeBytes {
		return s.settle(ctx, row, office.JobFailed, "engine_checksum_mismatch", "output_length")
	}
	sum := f.ChecksumSHA256
	if sum == "" {
		sum = checksum
	}
	done, err := s.q.CompleteOfficeJob(ctx, db.CompleteOfficeJobParams{
		OutputChecksum: pgtype.Text{String: sum, Valid: sum != ""},
		OutputLength:   pgtype.Int8{Int64: f.SizeBytes, Valid: true},
		Now:            s.ts(), ID: row.ID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Cancel or another settle won the race; the output stays unclaimed.
		return s.get(ctx, row.OrganizationID, row.WorkspaceID, row.ID)
	}
	if err != nil {
		return row, err
	}
	s.observe(done)
	return done, nil
}

// settle moves a live job to failed or timed_out.
func (s *DocumentOfficeService) settle(ctx context.Context, row db.OfficeJob, state office.JobState, code, reason string) (db.OfficeJob, error) {
	out, err := s.q.SettleOfficeJob(ctx, db.SettleOfficeJobParams{
		State:       string(state),
		ErrorCode:   pgtype.Text{String: code, Valid: code != ""},
		ErrorReason: pgtype.Text{String: reason, Valid: reason != ""},
		Now:         s.ts(), ID: row.ID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return s.get(ctx, row.OrganizationID, row.WorkspaceID, row.ID)
	}
	if err != nil {
		return row, err
	}
	s.observe(out)
	return out, nil
}

func (s *DocumentOfficeService) cancelRow(ctx context.Context, row db.OfficeJob, reason string) (db.OfficeJob, error) {
	out, err := s.q.CancelOfficeJob(ctx, db.CancelOfficeJobParams{
		ErrorReason: pgtype.Text{String: reason, Valid: true}, Now: s.ts(),
		ID: row.ID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return s.get(ctx, row.OrganizationID, row.WorkspaceID, row.ID)
	}
	if err != nil {
		return row, err
	}
	s.observe(out)
	return out, nil
}

func (s *DocumentOfficeService) observe(row db.OfficeJob) {
	if s.metrics == nil || !row.FinishedAt.Valid {
		return
	}
	s.metrics.ObserveOfficeJob(row.Operation, row.State, row.FinishedAt.Time.Sub(row.CreatedAt.Time))
}

// ReconcileOfficeJobs sweeps live jobs once (system work: the reconciler has
// no actor, and each row is refreshed through its own tenant scope). It
// returns how many rows it looked at.
func (s *DocumentOfficeService) ReconcileOfficeJobs(ctx context.Context) (int, error) {
	if s.engine == nil {
		return 0, nil
	}
	rows, err := s.q.ListLiveOfficeJobs(ctx, officeReconcileBatch)
	if err != nil {
		return 0, err
	}
	for _, row := range rows {
		if ctx.Err() != nil {
			break
		}
		if _, err := s.Refresh(ctx, row); err != nil {
			s.log.Warn("office: reconcile job", "job_id", row.ID, "err", err)
		}
	}
	return len(rows), nil
}

// EngineReady probes the engine on its own. The API's /readyz never calls
// this: an engine outage must not take the API (or Documents list/download)
// out of rotation.
func (s *DocumentOfficeService) EngineReady(ctx context.Context) (office.Readiness, error) {
	if s.engine == nil {
		return office.Readiness{}, office.ErrNotConfigured
	}
	r, err := s.engine.Ready(ctx)
	if s.metrics != nil {
		depth := r.QueueDepth
		if err != nil {
			depth = -1 // unknown: keep the last depth instead of reading as idle
		}
		s.metrics.SetOfficeEngine(err == nil, depth)
	}
	return r, err
}

// RunReconciler sweeps live jobs and probes the engine until ctx ends. The
// composition root runs it under the shutdown sequence.
func (s *DocumentOfficeService) RunReconciler(ctx context.Context) {
	if s.engine == nil {
		return
	}
	t := time.NewTicker(s.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_, _ = s.EngineReady(ctx)
			if _, err := s.ReconcileOfficeJobs(ctx); err != nil && ctx.Err() == nil {
				s.log.Warn("office: reconcile sweep", "err", err)
			}
		}
	}
}

// OfficeJobOutputProvider holds an office job's output file while the job is
// live - the engine may still be writing it. A settled job holds nothing:
// the commit path's version row holds a committed output, and an uncommitted
// one is left for FileService to collect after its claim window.
type OfficeJobOutputProvider struct{}

func (OfficeJobOutputProvider) Name() string { return "office.jobs" }

func (OfficeJobOutputProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.DocumentFile}
}

func (OfficeJobOutputProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := make(map[files.FileID]files.HoldReason, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.ListOfficeJobOutputHolds(ctx, fileIDStrings(ids))
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.Valid && r.String != "" {
			out[files.FileID(r.String)] = files.HoldActive
		}
	}
	return out, nil
}
