// Package outbox drains outbox_events and hands each row to the consumers
// registered for its topic.
//
// Every domain event in UniWork is written to outbox_events inside the same
// transaction as the change that caused it (ADR 0009), so delivery survives a
// crash between commit and publish: nothing is held in process memory. The
// claim/lease/retry loop below is the one Meeting has run since migration 008,
// lifted out of MeetingService so a new consumer costs a Register call rather
// than an edit to a service that knows nothing about it.
package outbox

import (
	"context"
	"errors"
	"log/slog"
	"math/rand"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Row is one outbox event as stored. Consumers read it; nobody writes it
// except internal/audit.
type Row = db.OutboxEvent

const (
	defaultBatch int32 = 50
	leaseSeconds int32 = 120
	// MaxAttempts is how many times a row is retried before it is parked as a
	// dead letter. Exported because the webhook inbox reuses the schedule.
	MaxAttempts   int32 = 10
	defaultTick         = 500 * time.Millisecond
	deadLetterSts       = "DEAD_LETTER"
)

// backoff is the retry schedule, capped at five minutes; the index is the
// attempt number. Jitter is applied on top so a burst of failures caused by
// one downstream outage does not come back as a synchronized burst.
var backoff = []time.Duration{
	2 * time.Second,
	4 * time.Second,
	8 * time.Second,
	16 * time.Second,
	30 * time.Second,
	time.Minute,
	2 * time.Minute,
	5 * time.Minute,
}

// Consumer handles the topics it declares. Handle must be idempotent by
// ev.ID: a row with several consumers is retried as a whole, so a consumer
// that already succeeded will be called again after a sibling fails.
type Consumer interface {
	Name() string
	Topics() []string
	Handle(ctx context.Context, ev Row) error
}

// Metrics is the counter surface the dispatcher needs, so this package does
// not import Prometheus.
type Metrics interface {
	IncOutboxDone()
	IncOutboxRetry()
	IncOutboxDeadLetter()
}

// Dispatcher claims pending rows and fans them out to consumers.
type Dispatcher struct {
	pool      *pgxpool.Pool
	q         *db.Queries
	nodeID    string
	batch     int32
	tick      time.Duration
	log       *slog.Logger
	metrics   Metrics
	consumers map[string][]Consumer
}

// Options tune the dispatcher; the zero value is sensible.
type Options struct {
	Batch   int32
	Tick    time.Duration
	Log     *slog.Logger
	Metrics Metrics
}

// New returns a dispatcher with no consumers registered.
func New(pool *pgxpool.Pool, q *db.Queries, opts Options) *Dispatcher {
	if opts.Batch <= 0 {
		opts.Batch = defaultBatch
	}
	if opts.Tick <= 0 {
		opts.Tick = defaultTick
	}
	if opts.Log == nil {
		opts.Log = slog.Default()
	}
	return &Dispatcher{
		pool: pool, q: q, nodeID: util.NewID(),
		batch: opts.Batch, tick: opts.Tick, log: opts.Log, metrics: opts.Metrics,
		consumers: map[string][]Consumer{},
	}
}

// Register subscribes a consumer to each topic it declares.
func (d *Dispatcher) Register(c Consumer) {
	for _, topic := range c.Topics() {
		d.consumers[topic] = append(d.consumers[topic], c)
	}
}

// Run drains the outbox on a ticker until ctx is cancelled.
func (d *Dispatcher) Run(ctx context.Context) {
	t := time.NewTicker(d.tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := d.Process(ctx, d.batch); err != nil && !errors.Is(err, context.Canceled) {
				d.log.Warn("outbox process", "err", err)
			}
		}
	}
}

// Process claims up to limit pending rows and delivers each one. Claiming
// commits before any consumer runs: a consumer that blocks must not hold a
// database transaction open behind it.
func (d *Dispatcher) Process(ctx context.Context, limit int32) error {
	if d.pool == nil {
		return nil
	}
	if limit <= 0 {
		limit = d.batch
	}
	_ = d.q.ReleaseStaleOutboxClaims(ctx)

	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := d.q.WithTx(tx).ClaimPendingOutbox(ctx, db.ClaimPendingOutboxParams{
		LockedBy: pgtype.Text{String: d.nodeID, Valid: true}, LeaseSeconds: float64(leaseSeconds), LimitN: limit,
	})
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	for _, row := range rows {
		if err := d.deliver(ctx, row); err != nil {
			d.fail(ctx, row, err)
			continue
		}
		_ = d.q.MarkOutboxDoneAt(ctx, row.ID)
		if d.metrics != nil {
			d.metrics.IncOutboxDone()
		}
	}
	return nil
}

// deliver runs every consumer registered for the row's topic. A row nobody
// subscribes to is done, not failed: an event with no listener today is the
// normal state of a catalogue that grows ahead of its consumers.
func (d *Dispatcher) deliver(ctx context.Context, row Row) error {
	consumers := d.consumers[row.Topic]
	if len(consumers) == 0 {
		return nil
	}
	var errs []error
	for _, c := range consumers {
		if err := c.Handle(ctx, row); err != nil {
			errs = append(errs, &consumerError{consumer: c.Name(), err: err})
		}
	}
	return errors.Join(errs...)
}

func (d *Dispatcher) fail(ctx context.Context, row Row, cause error) {
	next := row.Attempts + 1
	if next >= MaxAttempts {
		if d.metrics != nil {
			d.metrics.IncOutboxDeadLetter()
		}
		d.log.Error("outbox dead letter", "id", row.ID, "topic", row.Topic, "attempts", next, "err", cause)
		_ = d.q.MarkOutboxDead(ctx, db.MarkOutboxDeadParams{
			ID: row.ID, LastError: pgtype.Text{String: cause.Error(), Valid: true},
		})
		return
	}
	if d.metrics != nil {
		d.metrics.IncOutboxRetry()
	}
	_ = d.q.MarkOutboxFailed(ctx, db.MarkOutboxFailedParams{
		ID:          row.ID,
		LastError:   pgtype.Text{String: cause.Error(), Valid: true},
		AvailableAt: pgtype.Timestamptz{Time: RetryAt(next), Valid: true},
		Status:      "PENDING",
	})
}

// RetryAt returns when an attempt should next be tried: exponential backoff
// capped at five minutes, with ±20% jitter so a shared outage does not come
// back as a synchronized burst.
func RetryAt(attempt int32) time.Time {
	idx := int(attempt) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(backoff) {
		idx = len(backoff) - 1
	}
	base := backoff[idx]
	jitter := time.Duration(float64(base) * 0.2 * (rand.Float64()*2 - 1))
	return time.Now().UTC().Add(base + jitter)
}

type consumerError struct {
	consumer string
	err      error
}

func (e *consumerError) Error() string { return e.consumer + ": " + e.err.Error() }
func (e *consumerError) Unwrap() error { return e.err }
