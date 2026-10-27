package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Retention sweep for Google Drive task proposal batches (B7, UNI-2182; spec
// docs/superpowers/specs/2026-10-26-google-drive-connector-design.md §6.5, §6.6, §8.6).
//
// Every hour, the sweeper runs rounds of up to 500 rows, each in its own
// transaction:
//
//	DELETE FROM drive_task_proposals
//	WHERE id IN (
//	  SELECT p.id FROM drive_task_proposals p
//	  WHERE p.expires_at < now() OR p.status <> 'ready'
//	  ORDER BY p.expires_at ASC, p.id ASC
//	  LIMIT 500
//	  FOR UPDATE SKIP LOCKED
//	)
//
// repeating until a round deletes fewer than 500 rows. Thus an unhandled ready
// batch's excerpt lives at most 7 days + 1 hour, while converted and discarded
// batches (whose items were already cleared to NULL in the status-transition
// transaction) are cleaned up on the next hourly pass. Durable provenance rows
// in drive_task_proposal_links (§6.6, §8.8) are never touched.
//
// Deleting a settled or expired proposal row changes no business state, so no
// round writes an audit row (following document_retention_sweep.go); purged
// rows are counted via drive_task_proposals_purged_total.
const (
	DriveProposalRetentionSweepInterval = time.Hour
	DriveProposalRetentionSweepBatch    = int32(500)
)

// DriveProposalRetentionMetrics records the number of Drive task proposal rows
// purged by the retention sweep (spec §8.6). Implemented by *metrics.Drive.
type DriveProposalRetentionMetrics interface {
	ObserveTaskProposalsPurged(n int64)
}

// DriveProposalRetentionSweeper periodically purges expired and settled rows
// from drive_task_proposals. cmd/server/main.go starts Run under runCtx and
// awaits its completion in the shutdown sequence (ADR 0025).
type DriveProposalRetentionSweeper struct {
	svc        *DriveTaskProposalService
	pool       *pgxpool.Pool
	q          *db.Queries
	log        *slog.Logger
	metrics    DriveProposalRetentionMetrics
	now        func() time.Time
	interval   time.Duration
	batchLimit int32

	// testBeforeRoundCommit runs in tests inside a round's transaction after
	// SweepDriveTaskProposals executes and before tx.Commit so concurrent
	// SKIP LOCKED behavior is deterministic.
	testBeforeRoundCommit func(round int, deleted int64)
}

// NewDriveProposalRetentionSweeper constructs a retention sweeper for
// drive_task_proposals. A nil logger defaults to slog.Default().
func NewDriveProposalRetentionSweeper(svc *DriveTaskProposalService, log *slog.Logger) *DriveProposalRetentionSweeper {
	w := &DriveProposalRetentionSweeper{
		svc:        svc,
		log:        log,
		interval:   DriveProposalRetentionSweepInterval,
		batchLimit: DriveProposalRetentionSweepBatch,
	}
	if svc != nil {
		w.pool = svc.pool
		w.q = svc.q
		if w.log == nil {
			w.log = svc.log
		}
		if m, ok := svc.metrics.(DriveProposalRetentionMetrics); ok {
			w.metrics = m
		}
	}
	if w.log == nil {
		w.log = slog.Default()
	}
	return w
}

// NewRetentionSweeper constructs a DriveProposalRetentionSweeper bound to s.
func (s *DriveTaskProposalService) NewRetentionSweeper() *DriveProposalRetentionSweeper {
	var log *slog.Logger
	if s != nil {
		log = s.log
	}
	return NewDriveProposalRetentionSweeper(s, log)
}

// SetMetrics attaches the Prometheus counter for purged proposal rows.
func (w *DriveProposalRetentionSweeper) SetMetrics(m DriveProposalRetentionMetrics) {
	if w != nil {
		w.metrics = m
	}
}

// SetClock overrides the reference clock used for expiry checks (tests). When
// unset, the SQL query uses PostgreSQL's now().
func (w *DriveProposalRetentionSweeper) SetClock(now func() time.Time) {
	if w != nil {
		w.now = now
	}
}

// Run sweeps once at start and then every hour until ctx ends.
func (w *DriveProposalRetentionSweeper) Run(ctx context.Context) {
	if w == nil {
		return
	}
	interval := w.interval
	if interval <= 0 {
		interval = DriveProposalRetentionSweepInterval
	}
	for {
		n, err := w.Sweep(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			w.logger().Warn("drive task proposal retention sweep", "err", err)
		} else if n > 0 {
			w.logger().Info("drive task proposal retention sweep", "purged", n)
		}
		if !retentionPause(ctx, interval) {
			return
		}
	}
}

// Sweep runs one retention pass: each round opens one transaction and deletes
// up to 500 expired or non-ready rows from drive_task_proposals with FOR UPDATE
// SKIP LOCKED, repeating until a round deletes fewer than 500 rows or ctx ends.
func (w *DriveProposalRetentionSweeper) Sweep(ctx context.Context) (int64, error) {
	if w == nil || w.q == nil {
		return 0, nil
	}
	batchLimit := w.batchLimit
	if batchLimit <= 0 {
		batchLimit = DriveProposalRetentionSweepBatch
	}
	var total int64
	for round := 0; ; round++ {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		n, err := w.sweepRound(ctx, round, batchLimit)
		total += n
		if err != nil {
			return total, err
		}
		if n < int64(batchLimit) {
			return total, nil
		}
	}
}

// SweepDriveTaskProposals runs one retention pass on s using the given cutoff
// time (or PostgreSQL now() when now is zero).
func (s *DriveTaskProposalService) SweepDriveTaskProposals(ctx context.Context, now time.Time) (int64, error) {
	if s == nil || s.q == nil {
		return 0, nil
	}
	w := s.NewRetentionSweeper()
	if !now.IsZero() {
		w.SetClock(func() time.Time { return now })
	}
	return w.Sweep(ctx)
}

func (w *DriveProposalRetentionSweeper) sweepRound(ctx context.Context, round int, batchLimit int32) (int64, error) {
	params := db.SweepDriveTaskProposalsParams{
		Now:        w.cutoffTimestamp(),
		BatchLimit: batchLimit,
	}
	if w.pool == nil {
		n, err := w.q.SweepDriveTaskProposals(ctx, params)
		if err != nil {
			return 0, err
		}
		w.observePurged(n)
		return n, nil
	}
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	n, err := w.q.WithTx(tx).SweepDriveTaskProposals(ctx, params)
	if err != nil {
		return 0, err
	}
	if w.testBeforeRoundCommit != nil {
		w.testBeforeRoundCommit(round, n)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	w.observePurged(n)
	return n, nil
}

func (w *DriveProposalRetentionSweeper) cutoffTimestamp() pgtype.Timestamptz {
	if w != nil && w.now != nil {
		return pgtype.Timestamptz{
			Time:  w.now().UTC().Truncate(time.Microsecond),
			Valid: true,
		}
	}
	return pgtype.Timestamptz{}
}

func (w *DriveProposalRetentionSweeper) observePurged(n int64) {
	if n <= 0 {
		return
	}
	if w.metrics != nil {
		w.metrics.ObserveTaskProposalsPurged(n)
		return
	}
	if w.svc != nil && w.svc.metrics != nil {
		if m, ok := w.svc.metrics.(DriveProposalRetentionMetrics); ok {
			m.ObserveTaskProposalsPurged(n)
		}
	}
}

func (w *DriveProposalRetentionSweeper) logger() *slog.Logger {
	if w != nil && w.log != nil {
		return w.log
	}
	return slog.Default()
}
