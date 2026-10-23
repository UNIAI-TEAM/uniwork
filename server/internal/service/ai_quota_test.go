package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// aiQuota.Record uses the caller's MeterKey as the usage event's idempotency
// key when it is set (BE3B-8, design §6.4): the documented (run id, seq) key
// was dead on the production path, so a replayed charge was only idempotent
// per usage event. Empty keeps the per-event key every other capability gets.
func TestAIQuotaRecordUsesMeterKey(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "quota-key")
	ctx := context.Background()
	quota := NewAIQuota(NewEntitlementService(f.pool, f.q))

	const key = "uniwork-ai:01HZZZZZZZZZZZZZZZZZZZZZZZ:2"
	if err := quota.Record(ctx, ai.UsageRecord{
		OrganizationID: tn.orgID, Tokens: 7, UsageEventID: "evt-1", MeterKey: key,
	}); err != nil {
		t.Fatal(err)
	}
	// A second charge that names the same logical call is swallowed by the
	// meter, even though it carries a different usage event id.
	if err := quota.Record(ctx, ai.UsageRecord{
		OrganizationID: tn.orgID, Tokens: 7, UsageEventID: "evt-2", MeterKey: key,
	}); err != nil {
		t.Fatal(err)
	}
	var rows int
	var total int64
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*), COALESCE(sum(delta), 0)::bigint FROM usage_events WHERE organization_id = $1 AND idempotency_key = $2`,
		tn.orgID, key).Scan(&rows, &total); err != nil {
		t.Fatal(err)
	}
	if rows != 1 || total != 7 {
		t.Fatalf("rows/delta under the run key = %d/%d, want 1/7 (the meter key must be the idempotency key)", rows, total)
	}

	// Without a MeterKey the charge keeps the per-event key.
	if err := quota.Record(ctx, ai.UsageRecord{
		OrganizationID: tn.orgID, Tokens: 3, UsageEventID: "evt-3",
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM usage_events WHERE organization_id = $1 AND idempotency_key = $2`,
		tn.orgID, "ai:evt-3").Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("rows under the per-event key = %d, want 1 (an empty MeterKey keeps \"ai:<usage event id>\")", rows)
	}
}
