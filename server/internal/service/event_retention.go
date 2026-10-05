package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Event retention (G12, UNI-936). outbox_events, webhook_inbox and
// meeting_provider_events grow by every command and every provider callback,
// and nothing else ever deletes from them, so the periodic scans over them
// (claims, stale-lease releases, lag gauges) slow down week after week. This
// worker deletes the rows no code path reads again:
//
//   - outbox_events DONE whose last attempt and last write are older than
//     DoneAfter (7 days). Consumers never re-read a delivered row; the admin
//     correlation view loses the outbox half of a trace after the window, the
//     audit_events half stays.
//   - outbox_events DEAD_LETTER parked longer than DeadAfter (30 days): long
//     enough for the runbook's manual replay, short enough that a forgotten
//     dead letter does not live forever.
//   - webhook_inbox DONE older than DoneAfter and DEAD_LETTER older than
//     DeadAfter, by received_at. PENDING and PROCESSING rows are never touched.
//   - meeting_provider_events older than LedgerAfter (14 days). The ledger
//     only dedupes provider retries, which land within minutes; the
//     recording_ended re-entry in HandleProviderEvent runs whether or not the
//     ledger row is still there, so a missing row changes nothing.
//
// audit_events is never touched (ADR 0012: append-only, retention by archive).
//
// Every delete is a batch of at most Batch rows picked through an index, with
// a Pause between batches, and one sweep stops after MaxBatches per table so a
// first run against a large backlog spreads over several intervals instead of
// holding a connection for minutes. Batches use SKIP LOCKED, so replicas
// sweeping at the same time split the work instead of queueing on each other.
const (
	eventRetentionDoneAfter   = 7 * 24 * time.Hour
	eventRetentionDeadAfter   = 30 * 24 * time.Hour
	eventRetentionLedgerAfter = 14 * 24 * time.Hour
	eventRetentionBatch       = int32(5000)
	eventRetentionPause       = 250 * time.Millisecond
	eventRetentionMaxBatches  = 200
	eventRetentionInterval    = time.Hour
)

// EventRetentionPolicy sets the windows and the pace of the sweep. A zero
// field keeps its default.
type EventRetentionPolicy struct {
	// DoneAfter is how long delivered outbox rows and processed webhook
	// callbacks are kept.
	DoneAfter time.Duration
	// DeadAfter is how long dead letters (outbox and webhook) are kept.
	DeadAfter time.Duration
	// LedgerAfter is how long the provider-event dedupe ledger is kept.
	LedgerAfter time.Duration
	// Batch is the most rows one DELETE removes.
	Batch int32
	// Pause is the wait between two batches of the same table.
	Pause time.Duration
	// MaxBatches caps the batches per table in one sweep.
	MaxBatches int
	// Interval is the wait between two sweeps.
	Interval time.Duration
}

func (p EventRetentionPolicy) withDefaults() EventRetentionPolicy {
	if p.DoneAfter <= 0 {
		p.DoneAfter = eventRetentionDoneAfter
	}
	if p.DeadAfter <= 0 {
		p.DeadAfter = eventRetentionDeadAfter
	}
	if p.LedgerAfter <= 0 {
		p.LedgerAfter = eventRetentionLedgerAfter
	}
	if p.Batch <= 0 {
		p.Batch = eventRetentionBatch
	}
	if p.Pause <= 0 {
		p.Pause = eventRetentionPause
	}
	if p.MaxBatches <= 0 {
		p.MaxBatches = eventRetentionMaxBatches
	}
	if p.Interval <= 0 {
		p.Interval = eventRetentionInterval
	}
	return p
}

// EventRetentionMetrics receives the sweep's outcome per table. Declared
// here so the service never imports Prometheus; metrics.Outbox implements it.
type EventRetentionMetrics interface {
	AddEventRetentionDeleted(table string, n int64)
	IncEventRetentionError(table string)
}

// EventRetentionReport counts the rows one sweep deleted.
type EventRetentionReport struct {
	OutboxDone     int64
	OutboxDead     int64
	WebhookInbox   int64
	ProviderEvents int64
}

// EventRetention is the worker cmd/server starts; Run blocks until ctx ends.
type EventRetention struct {
	q       *db.Queries
	log     *slog.Logger
	policy  EventRetentionPolicy
	metrics EventRetentionMetrics
	// now is the sweep clock (tests); nil uses time.Now.
	now func() time.Time
}

// NewEventRetention builds the worker; a nil logger uses slog.Default().
func NewEventRetention(q *db.Queries, log *slog.Logger, policy EventRetentionPolicy) *EventRetention {
	if log == nil {
		log = slog.Default()
	}
	return &EventRetention{q: q, log: log, policy: policy.withDefaults(), now: time.Now}
}

// SetMetrics attaches the sweep counters.
func (r *EventRetention) SetMetrics(m EventRetentionMetrics) { r.metrics = m }

// Run sweeps once at start, then once per Interval, until ctx ends. A sweep
// in flight stops at its next statement or pause.
func (r *EventRetention) Run(ctx context.Context) {
	for {
		rep, err := r.Sweep(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			r.log.Warn("event retention sweep", "err", err)
		}
		if total := rep.OutboxDone + rep.OutboxDead + rep.WebhookInbox + rep.ProviderEvents; total > 0 {
			r.log.Info("event retention sweep",
				"outbox_done", rep.OutboxDone, "outbox_dead", rep.OutboxDead,
				"webhook_inbox", rep.WebhookInbox, "provider_events", rep.ProviderEvents)
		}
		if !retentionPause(ctx, r.policy.Interval) {
			return
		}
	}
}

// Sweep runs one pass over every table. A failing table does not stop the
// others; the errors come back joined. A cancelled ctx stops the pass at once
// and returns ctx.Err().
func (r *EventRetention) Sweep(ctx context.Context) (EventRetentionReport, error) {
	var rep EventRetentionReport
	now := r.now()
	doneBefore := now.Add(-r.policy.DoneAfter)
	deadBefore := now.Add(-r.policy.DeadAfter)
	ledgerBefore := now.Add(-r.policy.LedgerAfter)
	// The webhook delete covers both of its windows in one primary-key range,
	// so its upper bound is the later cutoff.
	inboxBefore := doneBefore
	if deadBefore.After(inboxBefore) {
		inboxBefore = deadBefore
	}
	inboxBeforeID, err := retentionIDFloor(inboxBefore)
	if err != nil {
		return rep, err
	}
	ledgerBeforeID, err := retentionIDFloor(ledgerBefore)
	if err != nil {
		return rep, err
	}
	limit := r.policy.Batch

	steps := []struct {
		table string
		into  *int64
		del   func(context.Context) (int64, error)
	}{
		{"outbox_events", &rep.OutboxDone, func(ctx context.Context) (int64, error) {
			return r.q.DeleteDoneOutboxEvents(ctx, db.DeleteDoneOutboxEventsParams{Before: retentionTime(doneBefore), LimitN: limit})
		}},
		{"outbox_events", &rep.OutboxDead, func(ctx context.Context) (int64, error) {
			return r.q.DeleteDeadOutboxEvents(ctx, db.DeleteDeadOutboxEventsParams{Before: retentionTime(deadBefore), LimitN: limit})
		}},
		{"webhook_inbox", &rep.WebhookInbox, func(ctx context.Context) (int64, error) {
			return r.q.DeleteExpiredWebhookInbox(ctx, db.DeleteExpiredWebhookInboxParams{
				BeforeID: inboxBeforeID, DoneBefore: retentionTime(doneBefore), DeadBefore: retentionTime(deadBefore), LimitN: limit,
			})
		}},
		{"meeting_provider_events", &rep.ProviderEvents, func(ctx context.Context) (int64, error) {
			return r.q.DeleteExpiredProviderEvents(ctx, db.DeleteExpiredProviderEventsParams{
				BeforeID: ledgerBeforeID, Before: retentionTime(ledgerBefore), LimitN: limit,
			})
		}},
	}
	var errs []error
	for _, step := range steps {
		n, err := r.drain(ctx, step.del)
		*step.into += n
		if r.metrics != nil && n > 0 {
			r.metrics.AddEventRetentionDeleted(step.table, n)
		}
		if ctx.Err() != nil {
			return rep, ctx.Err()
		}
		if err != nil {
			if r.metrics != nil {
				r.metrics.IncEventRetentionError(step.table)
			}
			errs = append(errs, fmt.Errorf("%s: %w", step.table, err))
		}
	}
	return rep, errors.Join(errs...)
}

// drain repeats one delete until a batch comes back short, MaxBatches is
// reached, or ctx ends, pausing between batches.
func (r *EventRetention) drain(ctx context.Context, del func(context.Context) (int64, error)) (int64, error) {
	var total int64
	for i := 0; i < r.policy.MaxBatches; i++ {
		n, err := del(ctx)
		total += n
		if err != nil {
			return total, err
		}
		if n < int64(r.policy.Batch) {
			return total, nil
		}
		if !retentionPause(ctx, r.policy.Pause) {
			return total, ctx.Err()
		}
	}
	return total, nil
}

// retentionIDFloor is the smallest ULID of the millisecond t falls in: every
// id util.NewID minted before that millisecond sorts below it.
func retentionIDFloor(t time.Time) (string, error) {
	var id ulid.ULID
	if err := id.SetTime(ulid.Timestamp(t)); err != nil {
		return "", fmt.Errorf("retention id floor: %w", err)
	}
	return id.String(), nil
}

func retentionTime(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// retentionPause waits d or until ctx ends; false means ctx ended.
func retentionPause(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
