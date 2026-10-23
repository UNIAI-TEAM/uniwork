package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The edit lock sweep (UNI-1645 §3.5): every DOCUMENT_EDIT_LOCK_SWEEP_INTERVAL
// end the tenures whose TTL and offline hold both ran out (expired, with the
// audit row and lock_changed frame, so a waiting reader sees "Edit now"),
// close the pending requests past their expiry, and delete tenures and
// requests closed more than 7 days ago. Several nodes may sweep at once:
// each tenure is ended under its document row lock and only while it is
// still unended, so a second node finds nothing to do.
const (
	DocumentEditLockRetention     = 7 * 24 * time.Hour
	documentEditLockSweepBatch    = int32(200)
	documentEditLockSweepMaxBatch = 20
)

// DocumentEditLockSweeper runs SweepExpiredDocumentEditLocks and the
// retention deletes on a ticker. main.go (A2) awaits Run in its shutdown
// sequence.
type DocumentEditLockSweeper struct {
	docs *DocumentService
	log  *slog.Logger
}

// NewDocumentEditLockSweeper builds the sweep on the document service; a nil
// logger uses slog.Default().
func NewDocumentEditLockSweeper(docs *DocumentService, log *slog.Logger) *DocumentEditLockSweeper {
	if log == nil {
		log = slog.Default()
	}
	return &DocumentEditLockSweeper{docs: docs, log: log}
}

// Run sweeps once at start, then every SweepInterval, until ctx ends.
func (w *DocumentEditLockSweeper) Run(ctx context.Context) {
	for {
		expired, deleted, err := w.Sweep(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			w.log.Warn("document edit lock sweep", "err", err)
		}
		if expired > 0 || deleted > 0 {
			w.log.Info("document edit lock sweep", "expired", expired, "deleted", deleted)
		}
		if !retentionPause(ctx, w.docs.EditLockConfig().SweepInterval) {
			return
		}
	}
}

// Sweep runs one pass: expire tenures, expire requests, delete old rows. It
// returns the tenures ended and the rows deleted.
func (w *DocumentEditLockSweeper) Sweep(ctx context.Context) (int, int64, error) {
	started := time.Now()
	expired, err := w.docs.SweepExpiredDocumentEditLocks(ctx)
	if err != nil {
		w.docs.recordDocumentSweep("edit_lock", 0, err, started)
		return expired, 0, err
	}
	deleted, err := w.docs.sweepDocumentEditLockRows(ctx)
	w.docs.recordDocumentSweep("edit_lock", 0, err, started)
	return expired, deleted, err
}

// SweepExpiredDocumentEditLocks ends every tenure that ran out, each in its
// own transaction under the document row lock (end_reason expired, actor
// system, audit + document.lock_changed), then closes the pending requests
// past their expiry. It returns the tenures it ended.
func (s *DocumentService) SweepExpiredDocumentEditLocks(ctx context.Context) (int, error) {
	total := 0
	for i := 0; i < documentEditLockSweepMaxBatch; i++ {
		rows, err := s.q.ListExpiredDocumentEditLocks(ctx, documentEditLockSweepBatch)
		if err != nil {
			return total, err
		}
		for _, r := range rows {
			ended, err := s.expireDocumentEditLock(ctx, r.DocumentID, r.ID)
			if err != nil {
				return total, err
			}
			if ended {
				total++
			}
		}
		if len(rows) < int(documentEditLockSweepBatch) {
			break
		}
	}
	for i := 0; i < documentEditLockSweepMaxBatch; i++ {
		n, err := s.q.ExpirePendingDocumentEditRequests(ctx, documentEditLockSweepBatch)
		if err != nil {
			return total, err
		}
		for j := int64(0); j < n; j++ {
			s.editLockMetrics().IncDocumentEditRequest("expire")
		}
		if n < int64(documentEditLockSweepBatch) {
			break
		}
	}
	return total, nil
}

// expireDocumentEditLock ends one tenure if, under the document lock, it is
// still the document's unended tenure and still not live.
func (s *DocumentService) expireDocumentEditLock(ctx context.Context, documentID, lockID string) (bool, error) {
	ops := &editLockOps{}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	doc, err := q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		// The document is gone; its tenure is ended by the delete consumer.
		return false, nil
	}
	if err != nil {
		return false, err
	}
	live, err := q.LockLiveDocumentEditLock(ctx, db.LockLiveDocumentEditLockParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	now, err := editLockClock(ctx, q)
	if err != nil {
		return false, err
	}
	if live.ID != lockID || editLockLive(live, now) {
		return false, nil
	}
	if _, err := s.releaseTenure(ctx, q, doc, live, DocumentEditEndExpired, documentEditLockSystem, now, ops); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	s.flushEditLockOps(ops)
	return true, nil
}

// sweepDocumentEditLockRows deletes tenures ended and requests closed more
// than DocumentEditLockRetention ago. Deleting a closed row changes no
// business state (its audit row exists), so it writes none.
func (s *DocumentService) sweepDocumentEditLockRows(ctx context.Context) (int64, error) {
	now, err := editLockClock(ctx, s.q)
	if err != nil {
		return 0, err
	}
	cutoff := ts(now.Add(-DocumentEditLockRetention))
	var total int64
	for i := 0; i < documentEditLockSweepMaxBatch; i++ {
		n, err := s.q.DeleteEndedDocumentEditLocks(ctx, db.DeleteEndedDocumentEditLocksParams{Cutoff: cutoff, BatchLimit: documentEditLockSweepBatch})
		total += n
		if err != nil {
			return total, err
		}
		if n < int64(documentEditLockSweepBatch) {
			break
		}
	}
	for i := 0; i < documentEditLockSweepMaxBatch; i++ {
		n, err := s.q.DeleteClosedDocumentEditRequests(ctx, db.DeleteClosedDocumentEditRequestsParams{Cutoff: cutoff, BatchLimit: documentEditLockSweepBatch})
		total += n
		if err != nil {
			return total, err
		}
		if n < int64(documentEditLockSweepBatch) {
			break
		}
	}
	return total, nil
}
