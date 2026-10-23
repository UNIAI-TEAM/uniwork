package service

import (
	"context"
	"testing"
)

// A metering batch that carries meeting minutes past both levels at once
// announces 100% once and never announces 80% afterwards.
func TestRecordMeetingMinutesJumpPastBothLevels(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `UPDATE subscriptions SET overrides = '{"meeting.participant_minutes": 10}'::jsonb WHERE organization_id = $1`, m.OrganizationID); err != nil {
		t.Fatal(err)
	}
	notices := func() int {
		return countRows(t, s, `SELECT count(*) FROM outbox_events WHERE topic = 'quota.threshold' AND organization_id = $1`, m.OrganizationID)
	}
	seedSession(t, s, m.ID, memberPID, "0 minutes", "30 minutes")
	if _, err := s.MeterClosedAttendance(ctx, 100); err != nil {
		t.Fatal(err)
	}
	var total int64
	var n80, n100 bool
	if err := s.pool.QueryRow(ctx, `SELECT total, notified_80_at IS NOT NULL, notified_100_at IS NOT NULL FROM usage_counters
		WHERE organization_id = $1 AND meter_key = $2`, m.OrganizationID, FeatureMeetingMinutes).Scan(&total, &n80, &n100); err != nil {
		t.Fatal(err)
	}
	if total != 30 || !n80 || !n100 {
		t.Fatalf("counter total=%d notified80=%v notified100=%v, want 30/true/true", total, n80, n100)
	}
	first := notices()
	if first == 0 {
		t.Fatal("crossing 100% sent no notice")
	}
	seedSession(t, s, m.ID, memberPID, "40 minutes", "45 minutes")
	if _, err := s.MeterClosedAttendance(ctx, 100); err != nil {
		t.Fatal(err)
	}
	if got := notices(); got != first {
		t.Fatalf("notices after the next batch = %d, want %d (no late 80%% notice)", got, first)
	}
}

// Without a plan that meters meeting minutes the sweep still marks the
// sessions, so they are not claimed again on every tick.
func TestRecordMeetingMinutesWithoutEntitlementMarksSessions(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `UPDATE subscriptions SET overrides = '{"meeting.participant_minutes": false}'::jsonb WHERE organization_id = $1`, m.OrganizationID); err != nil {
		t.Fatal(err)
	}
	seedSession(t, s, m.ID, memberPID, "0 minutes", "30 minutes")
	n, err := s.MeterClosedAttendance(ctx, 100)
	if err != nil || n != 1 {
		t.Fatalf("sweep claimed %d err %v, want 1", n, err)
	}
	if got := countRows(t, s, `SELECT count(*) FROM usage_events WHERE organization_id = $1`, m.OrganizationID); got != 0 {
		t.Fatalf("usage events without the entitlement = %d", got)
	}
	if n, err := s.MeterClosedAttendance(ctx, 100); err != nil || n != 0 {
		t.Fatalf("second sweep claimed %d err %v, want 0", n, err)
	}
}
