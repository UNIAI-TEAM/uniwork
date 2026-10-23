package outbox

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A backlog bigger than one batch drains back to back instead of one batch per
// tick. The tick here is an hour, so only the drain Run starts with can clear
// it: a dispatcher that stops after one batch leaves rows pending forever.
func TestRunDrainsABacklogWithoutWaitingForTheTick(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)

	const batch = 4
	c := &recordingConsumer{name: "count", topic: "task.updated"}
	d := New(pool, q, Options{Batch: batch, Tick: time.Hour})
	d.Register(c)
	for range 2*batch + 3 {
		enqueue(t, q, "task.updated")
	}

	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() { d.Run(ctx); close(stopped) }()
	t.Cleanup(func() { cancel(); <-stopped })

	deadline := time.Now().Add(10 * time.Second)
	for {
		var pending int
		if err := pool.QueryRow(context.Background(),
			`SELECT count(*) FROM outbox_events WHERE done_at IS NULL AND dead_at IS NULL`).Scan(&pending); err != nil {
			t.Fatal(err)
		}
		if pending == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d rows still pending; delivered %d of %d", pending, c.calls(), 2*batch+3)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if c.calls() != 2*batch+3 {
		t.Fatalf("delivered %d rows, want %d", c.calls(), 2*batch+3)
	}
}

// Stale claims are still swept on every Process call: a row a dead node left
// in PROCESSING past its lease is reclaimed and delivered.
func TestProcessReleasesStaleClaims(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	c := &recordingConsumer{name: "count", topic: "task.updated"}
	d := New(pool, q, Options{})
	d.Register(c)
	id := enqueue(t, q, "task.updated")
	if _, err := pool.Exec(ctx, `UPDATE outbox_events SET status = 'PROCESSING', locked_by = 'dead-node',
		locked_at = now() - interval '10 minutes', locked_until = now() - interval '1 minute' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if err := d.Process(ctx, 10); err != nil {
		t.Fatal(err)
	}
	var state string
	if err := pool.QueryRow(ctx, `SELECT status FROM outbox_events WHERE id = $1`, id).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "DONE" || c.calls() != 1 {
		t.Fatalf("stale claim: status = %q calls = %d", state, c.calls())
	}
}
