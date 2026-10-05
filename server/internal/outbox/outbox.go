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
	"fmt"
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

	// defaultDeliveryTimeout bounds one consumer's handling of one row. The
	// dispatcher is a single loop shared by every tenant, so a downstream that
	// hangs (LiveKit, an LLM, a push gateway) would otherwise stop realtime for
	// everyone behind it.
	defaultDeliveryTimeout = 15 * time.Second
	// maxDeliveryTimeout caps a consumer's own override at the claim lease: a
	// delivery that outlives the lease is handed to another node anyway.
	maxDeliveryTimeout = time.Duration(leaseSeconds) * time.Second
	// maxDrainRounds bounds how many full batches Run processes back to back
	// before it yields to the ticker again.
	maxDrainRounds = 20
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

// DeliveryTimeouter is implemented by a consumer whose work legitimately
// takes longer than defaultDeliveryTimeout (an LLM summary, say). The value is
// capped at maxDeliveryTimeout; zero or negative means the default.
type DeliveryTimeouter interface {
	DeliveryTimeout() time.Duration
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

// SetMetrics attaches the counters. Called once from main; the dispatcher
// works without them.
func (d *Dispatcher) SetMetrics(m Metrics) { d.metrics = m }

// Register subscribes a consumer to each topic it declares.
func (d *Dispatcher) Register(c Consumer) {
	for _, topic := range c.Topics() {
		d.consumers[topic] = append(d.consumers[topic], c)
	}
}

// Run drains the outbox once at start and then on every tick until ctx is
// cancelled.
func (d *Dispatcher) Run(ctx context.Context) {
	t := time.NewTicker(d.tick)
	defer t.Stop()
	for {
		d.drain(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// drain keeps claiming while the last batch came back full, so a backlog
// clears at the speed of delivery rather than one batch per tick. It stops at
// the first short batch, an error, cancellation or maxDrainRounds.
func (d *Dispatcher) drain(ctx context.Context) {
	for range maxDrainRounds {
		if ctx.Err() != nil {
			return
		}
		n, err := d.process(ctx, d.batch)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				d.log.Warn("outbox process", "err", err)
			}
			return
		}
		if n < int(d.batch) {
			return
		}
	}
}

// Process claims up to limit pending rows and delivers each one. Claiming
// commits before any consumer runs: a consumer that blocks must not hold a
// database transaction open behind it.
func (d *Dispatcher) Process(ctx context.Context, limit int32) error {
	_, err := d.process(ctx, limit)
	return err
}

// process is Process reporting how many rows it claimed, which tells drain
// whether more are likely waiting.
func (d *Dispatcher) process(ctx context.Context, limit int32) (int, error) {
	if d.pool == nil {
		return 0, nil
	}
	if limit <= 0 {
		limit = d.batch
	}
	_ = d.q.ReleaseStaleOutboxClaims(ctx)

	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	rows, err := d.q.WithTx(tx).ClaimPendingOutbox(ctx, db.ClaimPendingOutboxParams{
		LockedBy: pgtype.Text{String: d.nodeID, Valid: true}, LeaseSeconds: float64(leaseSeconds), LimitN: limit,
	})
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
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
	return len(rows), nil
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
		if err := handleWithDeadline(ctx, c, row); err != nil {
			errs = append(errs, &consumerError{consumer: c.Name(), err: err})
		}
	}
	return errors.Join(errs...)
}

// handleWithDeadline runs one consumer under its delivery deadline. Handle
// runs on its own goroutine so that a consumer which ignores its context
// still releases the dispatcher at the deadline; the abandoned call finishes
// on its own, and the row is retried as a failure — which every consumer
// already tolerates, since Handle must be idempotent by row id.
func handleWithDeadline(ctx context.Context, c Consumer, row Row) error {
	timeout := deliveryTimeout(c)
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- c.Handle(cctx, row) }()
	select {
	case err := <-done:
		return err
	case <-cctx.Done():
		// A result that landed together with the deadline still counts.
		select {
		case err := <-done:
			return err
		default:
		}
		if errors.Is(cctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("delivery deadline of %s exceeded: %w", timeout, cctx.Err())
		}
		return cctx.Err()
	}
}

func deliveryTimeout(c Consumer) time.Duration {
	dt, ok := c.(DeliveryTimeouter)
	if !ok {
		return defaultDeliveryTimeout
	}
	switch v := dt.DeliveryTimeout(); {
	case v <= 0:
		return defaultDeliveryTimeout
	case v > maxDeliveryTimeout:
		return maxDeliveryTimeout
	default:
		return v
	}
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
