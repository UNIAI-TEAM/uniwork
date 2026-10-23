package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The lease sweep (G5-D1 row 18): every 15 minutes, delete the rows that
// expired or were revoked more than 7 days ago. The 7 days keep a late
// renewal answering offline_lease_revoked from the row it names; the history
// stays in audit_events. One batch is at most this many rows, one pass at
// most this many batches.
const (
	OfficeLeaseRetention       = 7 * 24 * time.Hour
	officeLeaseSweepInterval   = 15 * time.Minute
	officeLeaseSweepBatch      = int32(500)
	officeLeaseSweepMaxBatches = 50
	officeLeaseSweepPause      = 100 * time.Millisecond
)

// OfficeLeaseSweeper deletes dead lease rows. main.go awaits Run in its
// shutdown sequence. Deleting a dead row changes no business state - the
// lease was already expired or revoked, with its audit row - so the sweep
// writes no audit row, like the change-feed snapshot sweep.
type OfficeLeaseSweeper struct {
	q   *db.Queries
	log *slog.Logger
	now func() time.Time
}

// NewSweeper builds the sweep on the service's database; a nil logger uses
// slog.Default().
func (s *OfficeLeaseService) NewSweeper(log *slog.Logger) *OfficeLeaseSweeper {
	if log == nil {
		log = slog.Default()
	}
	return &OfficeLeaseSweeper{q: s.docs.q, log: log, now: time.Now}
}

// SetClock replaces the clock (tests).
func (w *OfficeLeaseSweeper) SetClock(now func() time.Time) { w.now = now }

// Run sweeps once at start, then every interval, until ctx ends.
func (w *OfficeLeaseSweeper) Run(ctx context.Context) {
	for {
		n, err := w.Sweep(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			w.log.Warn("office lease sweep", "err", err)
		}
		if n > 0 {
			w.log.Info("office lease sweep", "deleted", n)
		}
		if !retentionPause(ctx, officeLeaseSweepInterval) {
			return
		}
	}
}

// Sweep runs one pass: batches until one comes back short, the batch cap is
// reached, or ctx ends. It returns the rows deleted.
func (w *OfficeLeaseSweeper) Sweep(ctx context.Context) (int64, error) {
	cutoff := pgtype.Timestamptz{Time: w.now().Add(-OfficeLeaseRetention), Valid: true}
	var total int64
	for i := 0; i < officeLeaseSweepMaxBatches; i++ {
		n, err := w.q.SweepOfficeOfflineLeases(ctx, db.SweepOfficeOfflineLeasesParams{Cutoff: cutoff, BatchLimit: officeLeaseSweepBatch})
		total += n
		if n > 0 && officeLeaseMetrics != nil {
			officeLeaseMetrics.ObserveOfficeLeaseSweep(n)
		}
		if err != nil {
			return total, err
		}
		if n < int64(officeLeaseSweepBatch) {
			return total, nil
		}
		if !retentionPause(ctx, officeLeaseSweepPause) {
			return total, ctx.Err()
		}
	}
	return total, nil
}
