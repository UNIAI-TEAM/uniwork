package outbox

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type recordingConsumer struct {
	mu    sync.Mutex
	name  string
	topic string
	err   error
	seen  []string
}

func (c *recordingConsumer) Name() string     { return c.name }
func (c *recordingConsumer) Topics() []string { return []string{c.topic} }
func (c *recordingConsumer) Handle(_ context.Context, ev Row) error {
	c.mu.Lock()
	c.seen = append(c.seen, ev.ID)
	c.mu.Unlock()
	return c.err
}

func (c *recordingConsumer) calls() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.seen)
}

func enqueue(t *testing.T, q *db.Queries, topic string) string {
	t.Helper()
	id := util.NewID()
	if err := q.InsertDomainOutboxEvent(context.Background(), db.InsertDomainOutboxEventParams{
		ID: id, Topic: topic, Payload: "{}", EventVersion: 1,
		WorkspaceID: pgtype.Text{String: "ws1", Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

// A row with several consumers is retried as a whole. That is a deliberate
// simplification — per-consumer delivery arrives with outbound webhooks — and
// the price is that every consumer must be idempotent, which this pins.
func TestDispatcherRetriesTheRowWhenOneConsumerFails(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	ok := &recordingConsumer{name: "ok", topic: "task.updated"}
	broken := &recordingConsumer{name: "broken", topic: "task.updated", err: errors.New("downstream down")}
	d := New(pool, q, Options{})
	d.Register(ok)
	d.Register(broken)

	id := enqueue(t, q, "task.updated")
	if err := d.Process(ctx, 10); err != nil {
		t.Fatal(err)
	}

	var state string
	var attempts int32
	if err := pool.QueryRow(ctx, `SELECT status, attempts FROM outbox_events WHERE id = $1`, id).Scan(&state, &attempts); err != nil {
		t.Fatal(err)
	}
	if state != "PENDING" || attempts != 1 {
		t.Fatalf("status = %q attempts = %d, want a retry", state, attempts)
	}
	if ok.calls() != 1 || broken.calls() != 1 {
		t.Fatalf("calls: ok=%d broken=%d", ok.calls(), broken.calls())
	}

	// The healthy consumer is called again on the retry: idempotency is its
	// job, not the dispatcher's.
	broken.err = nil
	if _, err := pool.Exec(ctx, `UPDATE outbox_events SET available_at = now() WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if err := d.Process(ctx, 10); err != nil {
		t.Fatal(err)
	}
	if ok.calls() != 2 {
		t.Fatalf("healthy consumer calls = %d, want 2", ok.calls())
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM outbox_events WHERE id = $1`, id).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "DONE" {
		t.Fatalf("status after recovery = %q", state)
	}
}

func TestDispatcherParksADeadLetter(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	d := New(pool, q, Options{})
	d.Register(&recordingConsumer{name: "always-fails", topic: "task.updated", err: errors.New("nope")})
	id := enqueue(t, q, "task.updated")

	for range int(MaxAttempts) {
		if _, err := pool.Exec(ctx, `UPDATE outbox_events SET available_at = now() WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
		_ = d.Process(ctx, 1)
	}

	var state string
	var dead pgtype.Timestamptz
	if err := pool.QueryRow(ctx, `SELECT status, dead_at FROM outbox_events WHERE id = $1`, id).Scan(&state, &dead); err != nil {
		t.Fatal(err)
	}
	if state != deadLetterSts || !dead.Valid {
		t.Fatalf("status = %q dead_at valid = %v", state, dead.Valid)
	}

	dl, err := q.CountDeadOutbox(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if dl != 1 {
		t.Fatalf("dead count = %d", dl)
	}
}

// An event nobody listens to yet is finished work, not a failure: the
// catalogue is allowed to run ahead of the consumers.
func TestDispatcherCompletesRowsWithNoConsumer(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	id := enqueue(t, q, "notification.created")
	if err := New(pool, q, Options{}).Process(ctx, 10); err != nil {
		t.Fatal(err)
	}
	var state string
	var done pgtype.Timestamptz
	if err := pool.QueryRow(ctx, `SELECT status, done_at FROM outbox_events WHERE id = $1`, id).Scan(&state, &done); err != nil {
		t.Fatal(err)
	}
	if state != "DONE" || !done.Valid {
		t.Fatalf("status = %q done_at valid = %v", state, done.Valid)
	}
}
