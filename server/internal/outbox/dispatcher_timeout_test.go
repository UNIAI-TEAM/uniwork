package outbox

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// blockingConsumer stands in for a hung downstream (LiveKit, an LLM, a push
// gateway): it returns only when its context is done.
type blockingConsumer struct {
	recordingConsumer
	timeout time.Duration
}

func (c *blockingConsumer) DeliveryTimeout() time.Duration { return c.timeout }
func (c *blockingConsumer) Handle(ctx context.Context, ev Row) error {
	_ = c.recordingConsumer.Handle(ctx, ev)
	<-ctx.Done()
	return ctx.Err()
}

// deafConsumer ignores its context entirely; only the dispatcher walking away
// from it keeps the loop moving.
type deafConsumer struct {
	recordingConsumer
	release chan struct{}
}

func (c *deafConsumer) DeliveryTimeout() time.Duration { return 50 * time.Millisecond }
func (c *deafConsumer) Handle(ctx context.Context, ev Row) error {
	_ = c.recordingConsumer.Handle(ctx, ev)
	<-c.release
	return nil
}

// One hung consumer must not freeze every tenant's realtime: its delivery is
// cut off at its deadline and counts as a failure, so the row retries on the
// usual schedule and the rest of the batch is delivered.
func TestDispatcherTimesOutAHungConsumerAndRetriesTheRow(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	hung := &blockingConsumer{recordingConsumer: recordingConsumer{name: "hung", topic: "meeting.ended"}, timeout: 50 * time.Millisecond}
	healthy := &recordingConsumer{name: "healthy", topic: "task.updated"}
	d := New(pool, q, Options{})
	d.Register(hung)
	d.Register(healthy)

	stuck := enqueue(t, q, "meeting.ended")
	fine := enqueue(t, q, "task.updated")

	done := make(chan error, 1)
	go func() { done <- d.Process(ctx, 10) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Process is still waiting on a consumer past its 50ms deadline")
	}

	var state, lastErr string
	var attempts int32
	if err := pool.QueryRow(ctx, `SELECT status, attempts, coalesce(last_error, '') FROM outbox_events WHERE id = $1`, stuck).
		Scan(&state, &attempts, &lastErr); err != nil {
		t.Fatal(err)
	}
	if state != "PENDING" || attempts != 1 {
		t.Fatalf("timed-out row: status = %q attempts = %d, want a retry", state, attempts)
	}
	if !strings.Contains(lastErr, "hung") || !strings.Contains(lastErr, "deadline") {
		t.Fatalf("last_error = %q, want the consumer name and the deadline", lastErr)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM outbox_events WHERE id = $1`, fine).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "DONE" || healthy.calls() != 1 {
		t.Fatalf("row behind the hung one: status = %q calls = %d", state, healthy.calls())
	}
}

// A consumer that never looks at its context still cannot hold the
// dispatcher: the delivery is abandoned at the deadline and failed.
func TestDispatcherAbandonsAConsumerThatIgnoresItsContext(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	deaf := &deafConsumer{recordingConsumer: recordingConsumer{name: "deaf", topic: "meeting.ended"}, release: make(chan struct{})}
	t.Cleanup(func() { close(deaf.release) })
	d := New(pool, q, Options{})
	d.Register(deaf)
	id := enqueue(t, q, "meeting.ended")

	done := make(chan error, 1)
	go func() { done <- d.Process(ctx, 10) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Process is still waiting on a consumer that ignores its context")
	}

	var state string
	var attempts int32
	if err := pool.QueryRow(ctx, `SELECT status, attempts FROM outbox_events WHERE id = $1`, id).Scan(&state, &attempts); err != nil {
		t.Fatal(err)
	}
	if state != "PENDING" || attempts != 1 {
		t.Fatalf("status = %q attempts = %d, want a retry", state, attempts)
	}
}

func TestDeliveryTimeoutDefaultsAndCaps(t *testing.T) {
	plain := &recordingConsumer{name: "plain", topic: "x"}
	if got := deliveryTimeout(plain); got != defaultDeliveryTimeout {
		t.Fatalf("no override = %s, want %s", got, defaultDeliveryTimeout)
	}
	for _, tc := range []struct {
		override, want time.Duration
	}{
		{0, defaultDeliveryTimeout},
		{-time.Second, defaultDeliveryTimeout},
		{90 * time.Second, 90 * time.Second},
		{time.Hour, maxDeliveryTimeout},
	} {
		c := &blockingConsumer{timeout: tc.override}
		if got := deliveryTimeout(c); got != tc.want {
			t.Fatalf("override %s = %s, want %s", tc.override, got, tc.want)
		}
	}
}
