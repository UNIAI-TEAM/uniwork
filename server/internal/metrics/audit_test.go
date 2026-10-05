package metrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// unreachablePool is a pool whose every query fails fast: nothing listens on
// port 1.
func unreachablePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	cfg, err := pgxpool.ParseConfig("postgres://nobody:none@127.0.0.1:1/none?sslmode=disable&connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// The outbox gauges count what is still undelivered (PENDING, PROCESSING)
// and what is parked (DEAD_LETTER) per topic. A DONE row is never pending,
// even one written before done_at existed. A topic that drains keeps its
// series at 0 instead of disappearing.
func TestOutboxLagCollectorReadsUndeliveredAndDeadRows(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO outbox_events (id, topic, payload, status, created_at, available_at, done_at, dead_at) VALUES
		  ('01LAGOUTBOX000000000000001', 'lag.a', '{}', 'PENDING',     now() - interval '2 hours', now(), NULL, NULL),
		  ('01LAGOUTBOX000000000000002', 'lag.a', '{}', 'PROCESSING',  now() - interval '1 hour',  now(), NULL, NULL),
		  ('01LAGOUTBOX000000000000003', 'lag.a', '{}', 'DONE',        now() - interval '5 hours', now(), NULL, NULL),
		  ('01LAGOUTBOX000000000000004', 'lag.b', '{}', 'DEAD_LETTER', now() - interval '9 hours', now(), NULL, now()),
		  ('01LAGOUTBOX000000000000005', 'lag.c', '{}', 'DONE',        now() - interval '9 hours', now(), now(), NULL)
	`); err != nil {
		t.Fatalf("seed outbox: %v", err)
	}

	c := NewOutboxLagCollector(pool)
	values := gatherGauges(t, c)
	if v := values["uniwork_outbox_pending_age_seconds|lag.a"]; v < 7000 || v > 7400 {
		t.Fatalf("pending age{lag.a} = %v, want about two hours (the DONE row is not pending)", v)
	}
	if v := values["uniwork_outbox_pending_total|lag.a"]; v != 2 {
		t.Fatalf("pending{lag.a} = %v, want 2", v)
	}
	if v := values["uniwork_outbox_dead_letter_total|lag.b"]; v != 1 {
		t.Fatalf("dead{lag.b} = %v, want 1", v)
	}
	if v := values["uniwork_outbox_pending_total|lag.b"]; v != 0 {
		t.Fatalf("pending{lag.b} = %v, want 0", v)
	}
	if _, ok := values["uniwork_outbox_pending_total|lag.c"]; ok {
		t.Fatalf("a topic with only delivered rows must not be read: %v", values)
	}
	if v := values["uniwork_outbox_dead_rows"]; v != 1 {
		t.Fatalf("dead rows = %v, want 1", v)
	}
	if v, ok := values["uniwork_outbox_lag_up"]; !ok || v != 1 {
		t.Fatalf("lag_up = %v (present %v), want 1", v, ok)
	}

	if _, err := pool.Exec(ctx, `UPDATE outbox_events SET status = 'DONE', done_at = now() WHERE topic = 'lag.a'`); err != nil {
		t.Fatal(err)
	}
	values = gatherGauges(t, c)
	for _, key := range []string{"uniwork_outbox_pending_age_seconds|lag.a", "uniwork_outbox_pending_total|lag.a"} {
		if v, ok := values[key]; !ok || v != 0 {
			t.Fatalf("%s after the topic drained = %v (present %v), want 0", key, v, ok)
		}
	}
}

// A failed read leaves the lag gauges absent and says so on lag_up, so an
// overloaded database never reads as an empty queue.
func TestOutboxLagCollectorFailedReadIsAbsentNotZero(t *testing.T) {
	values := gatherGauges(t, NewOutboxLagCollector(unreachablePool(t)))
	if v, ok := values["uniwork_outbox_lag_up"]; !ok || v != 0 {
		t.Fatalf("lag_up = %v (present %v), want 0", v, ok)
	}
	if _, ok := values["uniwork_outbox_dead_rows"]; ok {
		t.Fatalf("dead rows reported after a failed read: %v", values)
	}
	if len(values) != 1 {
		t.Fatalf("only lag_up may be reported after a failed read: %v", values)
	}
}

// The retention counters are registered and labelled by table only.
func TestEventRetentionCountersAreRegistered(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	registry.Outbox.AddEventRetentionDeleted("outbox_events", 5000)
	registry.Outbox.IncEventRetentionError("webhook_inbox")

	rec := httptest.NewRecorder()
	NewHandler(registry.Gatherer).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := rec.Body.String()
	for _, want := range []string{
		`uniwork_event_retention_deleted_total{table="outbox_events"} 5000`,
		`uniwork_event_retention_errors_total{table="webhook_inbox"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics body missing %q\n%s", want, body)
		}
	}
}
