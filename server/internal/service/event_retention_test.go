package service

import (
	"context"
	"errors"
	"slices"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// retentionIDAt mints the ULID a row created at t would have carried.
func retentionIDAt(t time.Time) string {
	return ulid.MustNew(ulid.Timestamp(t), ulid.DefaultEntropy()).String()
}

type retentionRows struct {
	outbox, webhook, ledger map[string]string // label -> id
}

// seedRetentionRows writes one row per case the sweep must decide, ages
// relative to now. Labels name the expected outcome.
func seedRetentionRows(t *testing.T, pool *pgxpool.Pool, now time.Time) retentionRows {
	t.Helper()
	ctx := context.Background()
	day := 24 * time.Hour
	rows := retentionRows{outbox: map[string]string{}, webhook: map[string]string{}, ledger: map[string]string{}}

	outbox := []struct {
		label, status      string
		created, updatedAt time.Time
		dead               *time.Time
	}{
		{label: "done-old-1", status: "DONE", created: now.Add(-10 * day), updatedAt: now.Add(-10 * day)},
		{label: "done-old-2", status: "DONE", created: now.Add(-9 * day), updatedAt: now.Add(-9 * day)},
		{label: "done-old-3", status: "DONE", created: now.Add(-8 * day), updatedAt: now.Add(-8 * day)},
		{label: "keep-done-recent", status: "DONE", created: now.Add(-1 * day), updatedAt: now.Add(-1 * day)},
		// Created long ago, replayed and delivered an hour ago: its last write
		// is recent, so it stays a full window.
		{label: "keep-done-replayed", status: "DONE", created: now.Add(-10 * day), updatedAt: now.Add(-time.Hour)},
		{label: "dead-old", status: "DEAD_LETTER", created: now.Add(-40 * day), updatedAt: now.Add(-40 * day), dead: retentionTimePtr(now.Add(-40 * day))},
		{label: "keep-dead-recent", status: "DEAD_LETTER", created: now.Add(-10 * day), updatedAt: now.Add(-10 * day), dead: retentionTimePtr(now.Add(-10 * day))},
		{label: "keep-pending-old", status: "PENDING", created: now.Add(-10 * day), updatedAt: now.Add(-10 * day)},
		{label: "keep-processing-old", status: "PROCESSING", created: now.Add(-10 * day), updatedAt: now.Add(-10 * day)},
	}
	for _, r := range outbox {
		id := retentionIDAt(r.created)
		rows.outbox[r.label] = id
		if _, err := pool.Exec(ctx, `
			INSERT INTO outbox_events (id, topic, payload, status, available_at, created_at, updated_at, done_at, dead_at)
			VALUES ($1, 'retention.test', '{}', $2, $3, $3, $4,
			  CASE WHEN $2 = 'DONE' THEN $4::timestamptz END, $5)`,
			id, r.status, r.created, r.updatedAt, r.dead); err != nil {
			t.Fatalf("seed outbox %s: %v", r.label, err)
		}
	}

	webhook := []struct {
		label, status string
		received      time.Time
	}{
		{label: "done-old", status: "DONE", received: now.Add(-10 * day)},
		{label: "keep-done-recent", status: "DONE", received: now.Add(-1 * day)},
		{label: "dead-old", status: "DEAD_LETTER", received: now.Add(-40 * day)},
		{label: "keep-dead-recent", status: "DEAD_LETTER", received: now.Add(-10 * day)},
		{label: "keep-pending-old", status: "PENDING", received: now.Add(-10 * day)},
		{label: "keep-processing-old", status: "PROCESSING", received: now.Add(-10 * day)},
	}
	for _, r := range webhook {
		id := retentionIDAt(r.received)
		rows.webhook[r.label] = id
		if _, err := pool.Exec(ctx, `
			INSERT INTO webhook_inbox (id, provider, provider_event_id, event_type, payload, status, next_attempt_at, received_at)
			VALUES ($1, 'livekit', $1, 'test', '{}', $2, $3, $3)`,
			id, r.status, r.received); err != nil {
			t.Fatalf("seed webhook %s: %v", r.label, err)
		}
	}

	ledger := []struct {
		label    string
		received time.Time
	}{
		{label: "old", received: now.Add(-20 * day)},
		{label: "keep-recent", received: now.Add(-1 * day)},
	}
	for _, r := range ledger {
		id := retentionIDAt(r.received)
		rows.ledger[r.label] = id
		if _, err := pool.Exec(ctx, `
			INSERT INTO meeting_provider_events (id, provider_key, provider_event_id, received_at)
			VALUES ($1, 'livekit', $1, $2)`, id, r.received); err != nil {
			t.Fatalf("seed ledger %s: %v", r.label, err)
		}
	}
	return rows
}

// retentionRemaining lists which labels of a table still have their row.
func retentionRemaining(t *testing.T, pool *pgxpool.Pool, table string, ids map[string]string) []string {
	t.Helper()
	var out []string
	for label, id := range ids {
		var n int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM `+table+` WHERE id = $1`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			out = append(out, label)
		}
	}
	sort.Strings(out)
	return out
}

type retentionMetricsSpy struct {
	mu      sync.Mutex
	deleted map[string]int64
	errs    map[string]int
}

func (m *retentionMetricsSpy) AddEventRetentionDeleted(table string, n int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.deleted == nil {
		m.deleted = map[string]int64{}
	}
	m.deleted[table] += n
}

func (m *retentionMetricsSpy) IncEventRetentionError(table string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.errs == nil {
		m.errs = map[string]int{}
	}
	m.errs[table]++
}

func testRetentionPolicy() EventRetentionPolicy {
	return EventRetentionPolicy{
		DoneAfter:   7 * 24 * time.Hour,
		DeadAfter:   30 * 24 * time.Hour,
		LedgerAfter: 14 * 24 * time.Hour,
		Batch:       2,
		Pause:       time.Millisecond,
		MaxBatches:  100,
	}
}

// The sweep deletes delivered rows past the done window, dead letters past
// the dead-letter window and ledger rows past theirs - in batches smaller
// than the backlog - and leaves every undelivered row, every recent row and a
// dead letter still inside its window where it is.
func TestEventRetentionDeletesOnlyExpiredTerminalRows(t *testing.T) {
	pool := testutil.DB(t)
	now := time.Now()
	rows := seedRetentionRows(t, pool, now)

	spy := &retentionMetricsSpy{}
	r := NewEventRetention(db.New(pool), nil, testRetentionPolicy())
	r.SetMetrics(spy)
	r.now = func() time.Time { return now }

	rep, err := r.Sweep(context.Background())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	want := EventRetentionReport{OutboxDone: 3, OutboxDead: 1, WebhookInbox: 2, ProviderEvents: 1}
	if rep != want {
		t.Fatalf("report = %+v, want %+v", rep, want)
	}

	if got := retentionRemaining(t, pool, "outbox_events", rows.outbox); !slices.Equal(got, []string{
		"keep-dead-recent", "keep-done-recent", "keep-done-replayed", "keep-pending-old", "keep-processing-old",
	}) {
		t.Fatalf("outbox rows left = %v", got)
	}
	if got := retentionRemaining(t, pool, "webhook_inbox", rows.webhook); !slices.Equal(got, []string{
		"keep-dead-recent", "keep-done-recent", "keep-pending-old", "keep-processing-old",
	}) {
		t.Fatalf("webhook rows left = %v", got)
	}
	if got := retentionRemaining(t, pool, "meeting_provider_events", rows.ledger); !slices.Equal(got, []string{"keep-recent"}) {
		t.Fatalf("ledger rows left = %v", got)
	}

	if spy.deleted["outbox_events"] != 4 || spy.deleted["webhook_inbox"] != 2 || spy.deleted["meeting_provider_events"] != 1 {
		t.Fatalf("deleted metric = %v", spy.deleted)
	}
	if len(spy.errs) != 0 {
		t.Fatalf("error metric = %v", spy.errs)
	}

	// A second sweep finds nothing left to delete.
	rep, err = r.Sweep(context.Background())
	if err != nil || rep != (EventRetentionReport{}) {
		t.Fatalf("second sweep = %+v, %v; want nothing", rep, err)
	}
}

// MaxBatches bounds one sweep: a backlog larger than MaxBatches x Batch is
// left for the next sweep instead of holding the worker.
func TestEventRetentionSweepIsBounded(t *testing.T) {
	pool := testutil.DB(t)
	now := time.Now()
	seedRetentionRows(t, pool, now)

	policy := testRetentionPolicy()
	policy.MaxBatches = 1
	r := NewEventRetention(db.New(pool), nil, policy)
	r.now = func() time.Time { return now }

	rep, err := r.Sweep(context.Background())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if rep.OutboxDone != 2 {
		t.Fatalf("first bounded sweep deleted %d delivered rows, want one batch of 2", rep.OutboxDone)
	}
	rep, err = r.Sweep(context.Background())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if rep.OutboxDone != 1 {
		t.Fatalf("second bounded sweep deleted %d delivered rows, want the last 1", rep.OutboxDone)
	}
}

// The pause between batches ends with the context: a shutdown never waits a
// pause out, and the sweep reports the cancellation.
func TestEventRetentionPauseEndsWithContext(t *testing.T) {
	pool := testutil.DB(t)
	now := time.Now()
	seedRetentionRows(t, pool, now)

	policy := testRetentionPolicy()
	policy.Batch = 1
	policy.Pause = time.Hour
	r := NewEventRetention(db.New(pool), nil, policy)
	r.now = func() time.Time { return now }

	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(200*time.Millisecond, cancel)
	started := time.Now()
	rep, err := r.Sweep(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("sweep err = %v, want context.Canceled", err)
	}
	if took := time.Since(started); took > 5*time.Second {
		t.Fatalf("sweep took %s after cancel; the pause must end with the context", took)
	}
	if rep.OutboxDone != 1 {
		t.Fatalf("deleted %d delivered rows before the cancel, want the first batch of 1", rep.OutboxDone)
	}
}

// Run sweeps, then waits its interval; it returns when the context ends.
func TestEventRetentionRunStopsWithContext(t *testing.T) {
	pool := testutil.DB(t)
	now := time.Now()
	rows := seedRetentionRows(t, pool, now)

	policy := testRetentionPolicy()
	policy.Interval = time.Hour
	r := NewEventRetention(db.New(pool), nil, policy)
	r.now = func() time.Time { return now }

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { r.Run(ctx); close(done) }()

	deadline := time.Now().Add(10 * time.Second)
	for len(retentionRemaining(t, pool, "meeting_provider_events", rows.ledger)) != 1 {
		if time.Now().After(deadline) {
			cancel()
			t.Fatal("Run did not sweep on start")
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after the context ended")
	}
}

// The webhook and ledger deletes walk the primary key with an upper bound
// built from the cutoff: every id minted before the cutoff millisecond sorts
// below it - under the database's collation too - and none minted at or
// after it does.
func TestRetentionIDFloorBoundsULIDs(t *testing.T) {
	cutoff := time.Now().Add(-7 * 24 * time.Hour).Truncate(time.Millisecond)
	floor, err := retentionIDFloor(cutoff)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 200; i++ {
		before := retentionIDAt(cutoff.Add(-time.Millisecond))
		at := retentionIDAt(cutoff)
		if !(before < floor) {
			t.Fatalf("id %s minted before the cutoff does not sort below the floor %s", before, floor)
		}
		if at < floor {
			t.Fatalf("id %s minted at the cutoff sorts below the floor %s", at, floor)
		}
	}

	pool := testutil.DB(t)
	var below, notBelow bool
	if err := pool.QueryRow(context.Background(), `SELECT $1::text < $2::text, $3::text < $2::text`,
		retentionIDAt(cutoff.Add(-time.Millisecond)), floor, retentionIDAt(cutoff)).Scan(&below, &notBelow); err != nil {
		t.Fatal(err)
	}
	if !below || notBelow {
		t.Fatalf("database collation orders ULIDs differently: before<floor=%v at<floor=%v", below, notBelow)
	}
}

func retentionTimePtr(t time.Time) *time.Time { return &t }
