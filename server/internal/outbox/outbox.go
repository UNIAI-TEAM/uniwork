// Package outbox drains outbox_events and hands each row to the consumers
// registered for its topic, one claim loop per lane (lane.go).
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
	"sync"
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

	// defaultDeliveryTimeout bounds one consumer's handling of one row. A
	// lane is a loop shared by every tenant, so a downstream that hangs would
	// otherwise stop that lane for everyone behind it.
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
// that already succeeded will be called again after a sibling fails. The
// consumers of one row run concurrently, so none may depend on another having
// handled the row first.
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
	topicLane map[string]Lane
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
		consumers: map[string][]Consumer{}, topicLane: map[string]Lane{},
	}
}

// SetMetrics attaches the counters. Called once from main; the dispatcher
// works without them.
func (d *Dispatcher) SetMetrics(m Metrics) { d.metrics = m }

// Register subscribes a consumer on the realtime lane. That lane is for
// consumers that only touch memory, Redis or one indexed read; anything that
// waits on a third party or fans out across tables belongs on RegisterLane.
// Registration happens before Run; the maps are not guarded.
func (d *Dispatcher) Register(c Consumer) { d.RegisterLane(LaneRealtime, c) }

// RegisterLane subscribes a consumer to each topic it declares and puts those
// topics on lane, unless another consumer already put them on a slower one: a
// topic runs on the slowest lane any of its consumers needs.
func (d *Dispatcher) RegisterLane(lane Lane, c Consumer) {
	if laneRank(lane) < 0 {
		panic(fmt.Sprintf("outbox: unknown lane %q for consumer %s", lane, c.Name()))
	}
	for _, topic := range c.Topics() {
		d.consumers[topic] = append(d.consumers[topic], c)
		if cur, ok := d.topicLane[topic]; !ok || laneRank(lane) > laneRank(cur) {
			d.topicLane[topic] = lane
		}
	}
}

// Run starts one claim loop per lane and returns only when every one of them
// has stopped, so a caller that awaits Run awaits all lanes. Each loop drains
// its lane at start and then on every tick until ctx is cancelled.
func (d *Dispatcher) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for _, lc := range d.claims() {
		wg.Add(1)
		go func() {
			defer wg.Done()
			d.runLane(ctx, lc)
		}()
	}
	wg.Wait()
}

func (d *Dispatcher) runLane(ctx context.Context, lc laneClaim) {
	t := time.NewTicker(d.tick)
	defer t.Stop()
	for {
		d.drain(ctx, lc)
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
func (d *Dispatcher) drain(ctx context.Context, lc laneClaim) {
	for range maxDrainRounds {
		if ctx.Err() != nil {
			return
		}
		n, err := d.process(ctx, lc, lc.batch)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				d.log.Warn("outbox process", "lane", string(lc.name), "err", err)
			}
			return
		}
		if n < int(lc.batch) {
			return
		}
	}
}

// Process is one pass that ignores lanes: it claims up to limit pending rows
// of any topic and delivers them in commit order on this goroutine. Run is the
// production path; Process is what a test or a one-off drain calls.
func (d *Dispatcher) Process(ctx context.Context, limit int32) error {
	_, err := d.process(ctx, laneClaim{name: "all", all: true, reap: true, workers: 1}, limit)
	return err
}

// process claims up to limit of the lane's rows and delivers them, reporting
// how many it claimed, which tells drain whether more are likely waiting.
func (d *Dispatcher) process(ctx context.Context, lc laneClaim, limit int32) (int, error) {
	if d.pool == nil {
		return 0, nil
	}
	if limit <= 0 {
		limit = d.batch
	}
	if lc.reap {
		_ = d.q.ReleaseStaleOutboxClaims(ctx)
	}
	rows, err := d.claim(ctx, lc, limit)
	if err != nil {
		return 0, err
	}
	d.deliverBatch(ctx, lc.name, rows, lc.workers)
	return len(rows), nil
}

// deliver runs every consumer registered for the row's topic, side by side,
// and fails the row if any of them failed. A row nobody subscribes to is
// done, not failed: an event with no listener today is the normal state of a
// catalogue that grows ahead of its consumers.
func (d *Dispatcher) deliver(ctx context.Context, row Row) error {
	consumers := d.consumers[row.Topic]
	switch len(consumers) {
	case 0:
		return nil
	case 1:
		if err := handleWithDeadline(ctx, consumers[0], row); err != nil {
			return &consumerError{consumer: consumers[0].Name(), err: err}
		}
		return nil
	}
	errs := make([]error, len(consumers))
	var wg sync.WaitGroup
	for i, c := range consumers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := handleWithDeadline(ctx, c, row); err != nil {
				errs[i] = &consumerError{consumer: c.Name(), err: err}
			}
		}()
	}
	wg.Wait()
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

// fail schedules the row's retry or parks it as a dead letter. A failure
// that is only the dispatcher shutting down is not the row's fault: it keeps
// its claim and its attempt count, and comes back when the lease runs out.
func (d *Dispatcher) fail(ctx context.Context, lane Lane, row Row, cause error) {
	if ctx.Err() != nil {
		return
	}
	next := row.Attempts + 1
	if next >= MaxAttempts {
		if d.metrics != nil {
			d.metrics.IncOutboxDeadLetter()
		}
		d.log.Error("outbox dead letter", "lane", string(lane), "id", row.ID, "topic", row.Topic, "attempts", next, "err", cause)
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
