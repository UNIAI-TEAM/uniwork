package projector

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Worker projects dirty nodes. Two loops claim batches with FOR UPDATE SKIP
// LOCKED under a lease; each node is projected in its own transaction, which
// also removes its dirty row unless a newer mark arrived meanwhile.
type Worker struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	metrics Metrics
	log     *slog.Logger
	loops   int
	batch   int32
	tick    time.Duration
	lease   time.Duration
}

// NewWorker wires the worker with spec §5.2's sizes: 2 loops, batch 8, 60 s lease.
func NewWorker(pool *pgxpool.Pool, q *db.Queries) *Worker {
	return &Worker{pool: pool, q: q, log: slog.Default(), loops: 2, batch: 8, tick: time.Second, lease: 60 * time.Second}
}

// SetMetrics attaches counters; called once from main.
func (w *Worker) SetMetrics(m Metrics) { w.metrics = m }

// Run projects until ctx ends and returns only once every loop has stopped.
func (w *Worker) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for i := 0; i < w.loops; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w.loop(ctx)
		}()
	}
	wg.Wait()
}

func (w *Worker) loop(ctx context.Context) {
	t := time.NewTicker(w.tick)
	defer t.Stop()
	for {
		for ctx.Err() == nil {
			n, err := w.Drain(ctx, w.batch)
			if err != nil && ctx.Err() == nil {
				w.log.Warn("graph: claim failed", "err", err)
			}
			if n < int(w.batch) {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// Drain claims up to batch dirty nodes and projects each. It returns how many
// it claimed; a failed projection is rescheduled, not returned.
func (w *Worker) Drain(ctx context.Context, batch int32) (int, error) {
	rows, err := w.q.GraphClaimDirty(ctx, db.GraphClaimDirtyParams{LeaseSeconds: int32(w.lease / time.Second), Batch: batch})
	if err != nil {
		return 0, err
	}
	for _, r := range rows {
		w.one(ctx, r)
	}
	return len(rows), nil
}

func (w *Worker) one(ctx context.Context, r db.GraphDirty) {
	ref := NodeRef{Type: graph.NodeType(r.NodeType), SourceID: r.SourceID}
	ev := EventInfo{EvidenceKind: EvidenceOutboxEvent, EvidenceID: r.LastEventID, At: r.LastEventAt.Time,
		ActorKind: r.ActorKind, ActorID: r.ActorID}
	result := "ok"
	if err := w.project(ctx, r, ref, ev); err != nil {
		result = "error"
		w.log.Warn("graph: projection failed", "organization_id", r.OrganizationID, "node_type", r.NodeType,
			"source_id", r.SourceID, "attempts", r.Attempts, "err", err)
		msg := err.Error()
		if len(msg) > 500 {
			msg = msg[:500]
		}
		if ferr := w.q.GraphFailDirty(ctx, db.GraphFailDirtyParams{
			OrganizationID: r.OrganizationID, NodeType: r.NodeType, SourceID: r.SourceID,
			AvailableAt: ts(time.Now().Add(backoff(r.Attempts))), LastError: msg,
		}); ferr != nil {
			w.log.Warn("graph: reschedule failed", "err", ferr)
		}
	} else if w.metrics != nil {
		w.metrics.ObserveGraphLag(time.Since(r.LastEventAt.Time))
	}
	if w.metrics != nil {
		w.metrics.IncGraphProjected(r.NodeType, result)
	}
}

func (w *Worker) project(ctx context.Context, r db.GraphDirty, ref NodeRef, ev EventInfo) error {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := w.q.WithTx(tx)
	if _, err := Project(ctx, q, r.OrganizationID, ref, ev); err != nil {
		return err
	}
	n, err := q.GraphDoneDirty(ctx, db.GraphDoneDirtyParams{
		OrganizationID: r.OrganizationID, NodeType: r.NodeType, SourceID: r.SourceID, MarkSeq: r.MarkSeq,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		// Marked again while projecting: leave it for the next claim.
		if err := q.GraphReleaseDirty(ctx, db.GraphReleaseDirtyParams{
			OrganizationID: r.OrganizationID, NodeType: r.NodeType, SourceID: r.SourceID,
		}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// backoff: 2 s, 4 s, … capped at 5 minutes.
func backoff(attempts int32) time.Duration {
	if attempts > 8 {
		attempts = 8
	}
	d := time.Duration(1<<attempts) * time.Second
	if d > 5*time.Minute {
		d = 5 * time.Minute
	}
	return d
}
