package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func planRow(key, kind, mode string, enabled bool, limit *int64) db.ListPlanFeaturesRow {
	r := db.ListPlanFeaturesRow{FeatureKey: key, Kind: kind, MeterMode: mode, Enabled: enabled}
	if limit != nil {
		r.QuotaLimit = pgtype.Int8{Int64: *limit, Valid: true}
	}
	return r
}

func i64(v int64) *int64 { return &v }

func TestEffectiveFormula(t *testing.T) {
	now := time.Now()
	ten := i64(10)
	rows := []db.ListPlanFeaturesRow{
		planRow(FeatureMeetingRecording, "flag", "accumulate", true, nil),
		planRow(FeatureMeetingMinutes, "quota", "accumulate", true, ten),
		planRow(FeatureMembersMax, "quota", "snapshot", true, nil),
	}
	cases := []struct {
		name      string
		sub       db.Subscription
		key       string
		enabled   bool
		limit     *int64
		undefined bool
	}{
		{"plan row wins", db.Subscription{Status: "active", Overrides: []byte(`{}`)}, FeatureMeetingMinutes, true, ten, false},
		{"override number beats plan", db.Subscription{Status: "active", Overrides: []byte(`{"meeting.participant_minutes": 50}`)}, FeatureMeetingMinutes, true, i64(50), false},
		{"override false turns a flag off", db.Subscription{Status: "active", Overrides: []byte(`{"meeting.recording": false}`)}, FeatureMeetingRecording, false, nil, false},
		{"override null lifts a limit", db.Subscription{Status: "active", Overrides: []byte(`{"meeting.participant_minutes": null}`)}, FeatureMeetingMinutes, true, nil, false},
		{"undeclared feature is absent (fail-closed)", db.Subscription{Status: "active", Overrides: []byte(`{}`)}, "sso.oidc", false, nil, true},
		{"suspended zeroes everything", db.Subscription{Status: "suspended", Overrides: []byte(`{}`)}, FeatureMeetingMinutes, false, i64(0), false},
		{"suspended keeps grace feature", db.Subscription{Status: "suspended", Overrides: []byte(`{}`)}, FeatureMembersMax, true, nil, false},
		{"past_due inside grace is active", db.Subscription{Status: "past_due", Overrides: []byte(`{}`),
			CurrentPeriodEnd: pgtype.Timestamptz{Time: now.Add(-24 * time.Hour), Valid: true}}, FeatureMeetingRecording, true, nil, false},
		{"past_due after grace is off", db.Subscription{Status: "past_due", Overrides: []byte(`{}`),
			CurrentPeriodEnd: pgtype.Timestamptz{Time: now.Add(-8 * 24 * time.Hour), Valid: true}}, FeatureMeetingRecording, false, i64(0), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e, ok := lookup(effective(tc.sub, rows, now), tc.key)
			if tc.undefined {
				if ok {
					t.Fatalf("expected %s to be undeclared", tc.key)
				}
				return
			}
			if !ok {
				t.Fatalf("%s missing", tc.key)
			}
			if e.Enabled != tc.enabled {
				t.Errorf("enabled = %v, want %v", e.Enabled, tc.enabled)
			}
			switch {
			case tc.limit == nil && e.Limit != nil:
				t.Errorf("limit = %d, want unlimited", *e.Limit)
			case tc.limit != nil && (e.Limit == nil || *e.Limit != *tc.limit):
				t.Errorf("limit = %v, want %d", e.Limit, *tc.limit)
			}
		})
	}
}

type entitlementFixture struct {
	ctx   context.Context
	pool  *pgxpool.Pool
	q     *db.Queries
	ent   *EntitlementService
	orgs  *OrganizationService
	ws    *WorkspaceService
	owner db.User
	orgID string
}

func newEntitlementFixture(t *testing.T) *entitlementFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	auth := NewAuthService(pool, q, authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	owner := registerVerified(t, q, auth, "ent-owner@example.com", "Owner")
	org, err := orgs.Create(context.Background(), owner.ID, "Ent Org", "ent-org")
	if err != nil {
		t.Fatal(err)
	}
	return &entitlementFixture{ctx: context.Background(), pool: pool, q: q,
		ent: NewEntitlementService(pool, q), orgs: orgs, ws: ws, owner: owner, orgID: org.ID}
}

// override edits the live subscription's overrides directly: the test is
// about the gate, not about BillingService.
func (f *entitlementFixture) override(t *testing.T, jsonOverrides string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `UPDATE subscriptions SET overrides = $1::jsonb WHERE organization_id = $2`, jsonOverrides, f.orgID); err != nil {
		t.Fatal(err)
	}
}

func (f *entitlementFixture) consume(in ConsumeInput) error {
	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(f.ctx)
	if err := f.ent.Consume(f.ctx, f.q.WithTx(tx), in); err != nil {
		return err
	}
	return tx.Commit(f.ctx)
}

func TestNewOrganizationIsOnTheDefaultPlan(t *testing.T) {
	f := newEntitlementFixture(t)
	snap, err := f.ent.Snapshot(f.ctx, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if !snap.Plan.IsDefault || snap.Subscription.Status != "active" || snap.Subscription.Provider != "manual" {
		t.Fatalf("unexpected subscription: %+v on %+v", snap.Subscription, snap.Plan)
	}
	if err := f.ent.Can(f.ctx, f.orgID, FeatureMeetingRecording); err != nil {
		t.Fatalf("default plan should allow recording: %v", err)
	}
	if e, _ := lookup(snap.Entitlements, FeatureMembersMax); e.Current != 1 {
		t.Fatalf("members.max current = %d, want 1 (the founder)", e.Current)
	}
}

func TestCanIsFailClosed(t *testing.T) {
	f := newEntitlementFixture(t)
	if err := f.ent.Can(f.ctx, f.orgID, "does.not.exist"); !errors.Is(err, ErrEntitlementRequired) {
		t.Fatalf("undeclared feature: got %v", err)
	}
	f.override(t, `{"meeting.recording": false}`)
	err := f.ent.Can(f.ctx, f.orgID, FeatureMeetingRecording)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "entitlement_required" || ce.Fields["feature"] != FeatureMeetingRecording {
		t.Fatalf("flag off: got %v", err)
	}
	if err := f.ent.Can(f.ctx, "01NOSUCHORG00000000000000", FeatureMeetingRecording); !errors.Is(err, ErrEntitlementRequired) {
		t.Fatalf("no subscription: got %v", err)
	}
}

func TestCheckQuotaLimits(t *testing.T) {
	f := newEntitlementFixture(t)
	if err := f.ent.CheckQuota(f.ctx, f.orgID, FeatureMembersMax, 1000); err != nil {
		t.Fatalf("NULL limit is unlimited: %v", err)
	}
	f.override(t, `{"members.max": 1}`)
	err := f.ent.CheckQuota(f.ctx, f.orgID, FeatureMembersMax, 1)
	var ce CodedError
	if !errors.As(err, &ce) || !errors.Is(err, ErrQuotaExceeded) || ce.Fields["current"] != int64(1) || ce.Fields["limit"] != int64(1) {
		t.Fatalf("limit 1 with one member: got %v", err)
	}
	f.override(t, `{"meeting.participant_minutes": 0}`)
	if err := f.ent.CheckQuota(f.ctx, f.orgID, FeatureMeetingMinutes, 1); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("limit 0 is off: got %v", err)
	}
}

func TestConsumeRaceHonoursTheLimit(t *testing.T) {
	f := newEntitlementFixture(t)
	f.override(t, `{"meeting.participant_minutes": 10}`)
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok, exceeded := 0, 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := f.consume(ConsumeInput{OrganizationID: f.orgID, Meter: FeatureMeetingMinutes, Delta: 1, Actor: Human(f.owner.ID)})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				ok++
			case errors.Is(err, ErrQuotaExceeded):
				exceeded++
			default:
				t.Errorf("unexpected: %v", err)
			}
		}()
	}
	wg.Wait()
	if ok != 10 || exceeded != 10 {
		t.Fatalf("ok=%d exceeded=%d, want 10/10", ok, exceeded)
	}
	snap, err := f.ent.Snapshot(f.ctx, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if e, _ := lookup(snap.Entitlements, FeatureMeetingMinutes); e.Current != 10 {
		t.Fatalf("counter = %d, want 10", e.Current)
	}
}

func TestConsumeIdempotencyKey(t *testing.T) {
	f := newEntitlementFixture(t)
	in := ConsumeInput{OrganizationID: f.orgID, Meter: FeatureMeetingMinutes, Delta: 7, Actor: Human(f.owner.ID), IdempotencyKey: "attendance:s1"}
	for i := 0; i < 2; i++ {
		if err := f.consume(in); err != nil {
			t.Fatal(err)
		}
	}
	snap, err := f.ent.Snapshot(f.ctx, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if e, _ := lookup(snap.Entitlements, FeatureMeetingMinutes); e.Current != 7 {
		t.Fatalf("counter = %d, want 7 (second call is a no-op)", e.Current)
	}
}

func TestQuotaThresholdEventsFireOncePerLevel(t *testing.T) {
	f := newEntitlementFixture(t)
	f.override(t, `{"meeting.participant_minutes": 10}`)
	levels := func() []string {
		rows, err := f.pool.Query(f.ctx, `SELECT payload::jsonb->>'level' FROM outbox_events WHERE topic = 'quota.threshold' AND organization_id = $1 ORDER BY created_at`, f.orgID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var l string
			if err := rows.Scan(&l); err != nil {
				t.Fatal(err)
			}
			out = append(out, l)
		}
		return out
	}
	step := func(delta int64) {
		if err := f.consume(ConsumeInput{OrganizationID: f.orgID, Meter: FeatureMeetingMinutes, Delta: delta, Actor: Human(f.owner.ID)}); err != nil {
			t.Fatal(err)
		}
	}
	step(7)
	if got := levels(); len(got) != 0 {
		t.Fatalf("70%% should not notify: %v", got)
	}
	step(1)
	step(1)
	if got := levels(); len(got) != 1 || got[0] != "80" {
		t.Fatalf("crossing 80%% notifies once: %v", got)
	}
	step(1)
	if got := levels(); len(got) != 2 || got[1] != "100" {
		t.Fatalf("crossing 100%% notifies once: %v", got)
	}
}
