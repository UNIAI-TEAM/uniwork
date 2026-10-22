package metrics

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// The report queue gauges are queue state, not a rate: the first report a
// fresh process sees is an open row the gauge counts at once, and a report
// left waiting keeps the gauges up (and its age growing) until someone
// closes it. A resolved report counts for nothing.
func TestChatReportQueueCollectorReadsOpenReports(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DELETE FROM chat_reports WHERE id LIKE '01CRQUEUE%'`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM chat_reports WHERE id LIKE '01CRQUEUE%'`) })

	// Gauges are present at 0 before anything is reported: an alert on
	// "> 0" fires on the very first report a process ever counts.
	values := gatherGauges(t, NewChatReportQueueCollector(pool))
	base := values["uniwork_chat_reports_open"]
	if _, ok := values["uniwork_chat_reports_oldest_open_age_seconds"]; !ok {
		t.Fatalf("oldest age absent on a readable queue: %v", values)
	}
	if v, ok := values["uniwork_chat_reports_up"]; !ok || v != 1 {
		t.Fatalf("up = %v (present %v), want 1", v, ok)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO chat_reports (id, organization_id, workspace_id, target_user_id, reason, status, created_by, created_by_kind, created_at) VALUES
		  ('01CRQUEUE00000000000000001', 'org-crq', 'ws-crq', 'u-target', 'spam', 'open',     'u-rep', 'human', now() - interval '21 hours'),
		  ('01CRQUEUE00000000000000002', 'org-crq', 'ws-crq', 'u-target', 'hate', 'open',     'u-rep', 'human', now() - interval '1 hour'),
		  ('01CRQUEUE00000000000000003', 'org-crq', 'ws-crq', 'u-target', 'spam', 'resolved', 'u-rep', 'human', now() - interval '40 hours')
	`); err != nil {
		t.Fatalf("seed reports: %v", err)
	}
	values = gatherGauges(t, NewChatReportQueueCollector(pool))
	if v := values["uniwork_chat_reports_open"]; v != base+2 {
		t.Fatalf("open = %v, want %v (resolved rows do not count)", v, base+2)
	}
	if v := values["uniwork_chat_reports_oldest_open_age_seconds"]; v < 21*3600-300 {
		t.Fatalf("oldest open age = %v, want at least 21 hours (the resolved 40-hour row does not count)", v)
	}
}

// A failed read leaves the queue gauges absent and says so with up = 0: a
// database that does not answer never reads as an empty queue.
func TestChatReportQueueCollectorFailedReadIsAbsentNotZero(t *testing.T) {
	values := gatherGauges(t, NewChatReportQueueCollector(unreachablePool(t)))
	for _, key := range []string{"uniwork_chat_reports_open", "uniwork_chat_reports_oldest_open_age_seconds"} {
		if _, ok := values[key]; ok {
			t.Fatalf("%s present after a failed read: %v", key, values)
		}
	}
	if v, ok := values["uniwork_chat_reports_up"]; !ok || v != 0 {
		t.Fatalf("up = %v (present %v), want 0", v, ok)
	}
}

// A registry without a pool registers nothing that reads the database.
func TestChatReportQueueCollectorWithoutPoolEmitsNothing(t *testing.T) {
	if values := gatherGauges(t, NewChatReportQueueCollector(nil)); len(values) != 0 {
		t.Fatalf("nil pool emitted %v", values)
	}
}
