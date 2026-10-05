package metrics

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// The meeting queue gauges read the oldest undelivered outbox row and the
// oldest webhook callback that is waiting or leased; delivered rows and dead
// letters do not count.
func TestMeetingLagCollectorReadsOldestOpenRows(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO outbox_events (id, topic, payload, status, created_at, available_at) VALUES
		  ('01MLAGOUTBOX00000000000001', 'lag.a', '{}', 'PENDING',     now() - interval '1 hour', now()),
		  ('01MLAGOUTBOX00000000000002', 'lag.a', '{}', 'DONE',        now() - interval '5 hours', now()),
		  ('01MLAGOUTBOX00000000000003', 'lag.a', '{}', 'DEAD_LETTER', now() - interval '6 hours', now())
	`); err != nil {
		t.Fatalf("seed outbox: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO webhook_inbox (id, provider, provider_event_id, event_type, status, received_at, next_attempt_at) VALUES
		  ('01MLAGINBOX000000000000001', 'livekit', 'e1', 't', 'PENDING',     now() - interval '2 hours', now()),
		  ('01MLAGINBOX000000000000002', 'livekit', 'e2', 't', 'PROCESSING',  now() - interval '3 hours', now()),
		  ('01MLAGINBOX000000000000003', 'livekit', 'e3', 't', 'DONE',        now() - interval '7 hours', now()),
		  ('01MLAGINBOX000000000000004', 'livekit', 'e4', 't', 'DEAD_LETTER', now() - interval '8 hours', now())
	`); err != nil {
		t.Fatalf("seed inbox: %v", err)
	}

	values := gatherGauges(t, NewMeetingLagCollector(pool))
	if v := values["uniwork_meeting_outbox_oldest_pending_seconds"]; v < 3400 || v > 3800 {
		t.Fatalf("outbox lag = %v, want about one hour", v)
	}
	if v := values["uniwork_meeting_webhook_inbox_oldest_pending_seconds"]; v < 10600 || v > 11000 {
		t.Fatalf("webhook lag = %v, want about three hours (the leased row)", v)
	}
	for _, q := range []string{"outbox", "webhook_inbox"} {
		if v, ok := values["uniwork_meeting_queue_lag_up|"+q]; !ok || v != 1 {
			t.Fatalf("lag_up{%s} = %v (present %v), want 1", q, v, ok)
		}
	}

	// Drained queues read 0, still up.
	if _, err := pool.Exec(ctx, `UPDATE outbox_events SET status = 'DONE'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE webhook_inbox SET status = 'DONE'`); err != nil {
		t.Fatal(err)
	}
	values = gatherGauges(t, NewMeetingLagCollector(pool))
	for _, key := range []string{"uniwork_meeting_outbox_oldest_pending_seconds", "uniwork_meeting_webhook_inbox_oldest_pending_seconds"} {
		if v, ok := values[key]; !ok || v != 0 {
			t.Fatalf("%s on a drained queue = %v (present %v), want 0", key, v, ok)
		}
	}
}

// A failed read leaves the lag gauge absent and sets lag_up to 0 - never a
// 0-second lag that would hide a stuck queue behind an overloaded database.
func TestMeetingLagCollectorFailedReadIsAbsentNotZero(t *testing.T) {
	values := gatherGauges(t, NewMeetingLagCollector(unreachablePool(t)))
	for _, key := range []string{"uniwork_meeting_outbox_oldest_pending_seconds", "uniwork_meeting_webhook_inbox_oldest_pending_seconds"} {
		if _, ok := values[key]; ok {
			t.Fatalf("%s present after a failed read: %v", key, values)
		}
	}
	for _, q := range []string{"outbox", "webhook_inbox"} {
		if v, ok := values["uniwork_meeting_queue_lag_up|"+q]; !ok || v != 0 {
			t.Fatalf("lag_up{%s} = %v (present %v), want 0", q, v, ok)
		}
	}
}
