package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The snapshot sweep bounds: one batch is at most this many snapshot rows
// (their items go with them), one pass at most this many batches.
const (
	documentChangeSweepBatch      = int32(100)
	documentChangeSweepMaxBatches = 50
	documentChangeSweepInterval   = time.Minute
	documentChangeSweepPause      = 100 * time.Millisecond
)

// DocumentChangeSweepMetrics counts the rows the sweep deletes.
type DocumentChangeSweepMetrics interface {
	ObserveChangeSnapshotSweep(snapshots, items int64)
}

// DocumentChangeSnapshotSweeper deletes expired change-feed snapshots
// (G5-01a). Each batch deletes the snapshot rows and their items in one
// transaction, so a concurrent page reads the whole snapshot or none of it
// (410), never a short page. main.go awaits Run in its shutdown sequence.
type DocumentChangeSnapshotSweeper struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	log     *slog.Logger
	metrics DocumentChangeSweepMetrics
	now     func() time.Time
}

// NewSnapshotSweeper builds the sweep on the service's database; a nil
// logger uses slog.Default().
func (s *DocumentChangesService) NewSnapshotSweeper(log *slog.Logger) *DocumentChangeSnapshotSweeper {
	if log == nil {
		log = slog.Default()
	}
	return &DocumentChangeSnapshotSweeper{pool: s.docs.pool, q: s.docs.q, log: log, now: time.Now}
}

// SetMetrics attaches the sweep counter.
func (w *DocumentChangeSnapshotSweeper) SetMetrics(m DocumentChangeSweepMetrics) { w.metrics = m }

// SetClock replaces the clock (tests).
func (w *DocumentChangeSnapshotSweeper) SetClock(now func() time.Time) { w.now = now }

// Run sweeps once at start, then every interval, until ctx ends.
func (w *DocumentChangeSnapshotSweeper) Run(ctx context.Context) {
	for {
		snapshots, items, err := w.Sweep(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			w.log.Warn("document change snapshot sweep", "err", err)
		}
		if snapshots > 0 {
			w.log.Info("document change snapshot sweep", "snapshots", snapshots, "items", items)
		}
		if !retentionPause(ctx, documentChangeSweepInterval) {
			return
		}
	}
}

// Sweep runs one pass: batches until one comes back short, the batch cap is
// reached, or ctx ends.
func (w *DocumentChangeSnapshotSweeper) Sweep(ctx context.Context) (snapshots, items int64, err error) {
	for i := 0; i < documentChangeSweepMaxBatches; i++ {
		n, m, err := w.sweepBatch(ctx)
		snapshots += n
		items += m
		if err != nil {
			return snapshots, items, err
		}
		if n < int64(documentChangeSweepBatch) {
			return snapshots, items, nil
		}
		if !retentionPause(ctx, documentChangeSweepPause) {
			return snapshots, items, ctx.Err()
		}
	}
	return snapshots, items, nil
}

func (w *DocumentChangeSnapshotSweeper) sweepBatch(ctx context.Context) (int64, int64, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := w.q.WithTx(tx)
	ids, err := q.SweepExpiredDocumentChangeSnapshots(ctx, db.SweepExpiredDocumentChangeSnapshotsParams{
		Now: pgtype.Timestamptz{Time: w.now(), Valid: true}, BatchLimit: documentChangeSweepBatch,
	})
	if err != nil || len(ids) == 0 {
		return 0, 0, err
	}
	items, err := q.DeleteDocumentChangeSnapshotItems(ctx, ids)
	if err != nil {
		return 0, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	if w.metrics != nil {
		w.metrics.ObserveChangeSnapshotSweep(int64(len(ids)), items)
	}
	return int64(len(ids)), items, nil
}
