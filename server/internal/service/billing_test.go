package service

import (
	"errors"
	"testing"
	"time"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
)

type billingFixture struct {
	*entitlementFixture
	billing *BillingService
	auth    *AuthService
}

func newBillingFixture(t *testing.T) *billingFixture {
	t.Helper()
	ef := newEntitlementFixture(t)
	auth := NewAuthService(ef.pool, ef.q, authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	return &billingFixture{entitlementFixture: ef, billing: NewBillingService(ef.pool, ef.q, ef.orgs, nil), auth: auth}
}

// seedPlan adds a plan the way a platform admin would (SQL for now, F-11 API
// later). Plan codes live in the test only — never in code.
func (f *billingFixture) seedPlan(t *testing.T, code string, price int64, limits map[string]int64) {
	t.Helper()
	// plans are not truncated between tests (the seed lives in a migration).
	for _, stmt := range []string{`DELETE FROM plan_features WHERE plan_id = $1`, `DELETE FROM plans WHERE id = $1`} {
		if _, err := f.pool.Exec(f.ctx, stmt, "01TESTPLAN"+code); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO plans (id, code, name, price_amount, sort_order) VALUES ($1, $2, $2, $3, 10)`,
		"01TESTPLAN"+code, code, price); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
		SELECT $1, key, true, NULL FROM features`, "01TESTPLAN"+code); err != nil {
		t.Fatal(err)
	}
	for k, v := range limits {
		if _, err := f.pool.Exec(f.ctx, `UPDATE plan_features SET quota_limit = $3 WHERE plan_id = $1 AND feature_key = $2`, "01TESTPLAN"+code, k, v); err != nil {
			t.Fatal(err)
		}
	}
}

func (f *billingFixture) version(t *testing.T) int32 {
	t.Helper()
	snap, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	return snap.Subscription.RowVersion
}

func TestChangePlanByOwner(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "free_small", 0, map[string]int64{FeatureWorkspacesMax: 1})
	v := f.version(t)
	snap, err := f.billing.ChangePlan(f.ctx, f.owner.ID, f.orgID, "free_small", v)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Plan.Code != "free_small" || snap.Subscription.RowVersion != v+1 {
		t.Fatalf("plan=%s version=%d", snap.Plan.Code, snap.Subscription.RowVersion)
	}
	if e, _ := lookup(snap.Entitlements, FeatureWorkspacesMax); e.Limit == nil || *e.Limit != 1 {
		t.Fatalf("new plan limits apply at once: %+v", e)
	}
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'subscription.changed' AND organization_id = $1`, f.orgID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("subscription.changed rows = %d (%v), want 1 (one owner)", n, err)
	}
	// A stale version is refused.
	_, err = f.billing.ChangePlan(f.ctx, f.owner.ID, f.orgID, "free_small", v)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "version_conflict" || !errors.Is(err, ErrConflict) {
		t.Fatalf("stale version: got %v", err)
	}
}

func TestChangePlanGates(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	f.seedPlan(t, "free_small", 0, map[string]int64{FeatureWorkspacesMax: 1})
	v := f.version(t)

	_, err := f.billing.ChangePlan(f.ctx, f.owner.ID, f.orgID, "paid_team", v)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "checkout_required" {
		t.Fatalf("owner to a paid plan: got %v", err)
	}
	if _, err := f.billing.ChangePlan(f.ctx, f.owner.ID, f.orgID, "no_such_plan", v); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown plan: got %v", err)
	}

	member := registerVerified(t, f.q, f.auth, "bill-member@example.com", "Member")
	addOrgMember(t, f.q, f.orgID, member.ID)
	if _, err := f.billing.ChangePlan(f.ctx, member.ID, f.orgID, "free_small", v); !errors.Is(err, ErrForbidden) {
		t.Fatalf("org member is not the owner: got %v", err)
	}
	if _, err := f.billing.Current(f.ctx, member.ID, f.orgID); err != nil {
		t.Fatalf("any member reads the subscription: %v", err)
	}
	outsider := registerVerified(t, f.q, f.auth, "bill-outsider@example.com", "Other org")
	if _, err := f.billing.Current(f.ctx, outsider.ID, f.orgID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("other organization reads: got %v", err)
	}
	if _, err := f.billing.ChangePlan(f.ctx, outsider.ID, f.orgID, "free_small", v); !errors.Is(err, ErrForbidden) {
		t.Fatalf("other organization changes: got %v", err)
	}

	// B4: two workspaces do not fit under workspaces.max = 1.
	for _, slug := range []string{"one", "two"} {
		if _, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.orgID, slug, slug); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.billing.ChangePlan(f.ctx, f.owner.ID, f.orgID, "free_small", v); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("downgrade below current usage: got %v", err)
	}

	// Platform staff may set any plan, paid included, without being a member.
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, outsider.ID); err != nil {
		t.Fatal(err)
	}
	snap, err := f.billing.ChangePlan(f.ctx, outsider.ID, f.orgID, "paid_team", v)
	if err != nil || snap.Plan.Code != "paid_team" || snap.Subscription.Provider != "manual" {
		t.Fatalf("platform admin: %v %+v", err, snap.Plan)
	}
}

func TestCancelResumeAndCheckout(t *testing.T) {
	f := newBillingFixture(t)
	snap, err := f.billing.Cancel(f.ctx, f.owner.ID, f.orgID)
	if err != nil || !snap.Subscription.CancelAt.Valid || snap.Subscription.Status != "active" {
		t.Fatalf("cancel schedules, does not kill: %v %+v", err, snap.Subscription)
	}
	snap, err = f.billing.Resume(f.ctx, f.owner.ID, f.orgID)
	if err != nil || snap.Subscription.CancelAt.Valid {
		t.Fatalf("resume clears cancel_at: %v %+v", err, snap.Subscription)
	}
	_, err = f.billing.Checkout(f.ctx, f.owner.ID, f.orgID, snap.Plan.Code, "/ok", "/back")
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "billing_provider_unavailable" || ce.Status != 503 {
		t.Fatalf("manual provider has no checkout: got %v", err)
	}
}

// The organization service must not commit a plan change when the audit row
// cannot be written: everything is one transaction. Simulated by a rollback
// the way the audit spec's test does it — read the outbox after a failed
// change and expect nothing.
func TestChangePlanFailureLeavesNoEvent(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "free_small", 0, map[string]int64{FeatureWorkspacesMax: 0})
	if _, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.orgID, "one", "one"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.billing.ChangePlan(f.ctx, f.owner.ID, f.orgID, "free_small", f.version(t)); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("expected refusal: %v", err)
	}
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'subscription.changed' AND organization_id = $1`, f.orgID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("refused change must leave no event: %d %v", n, err)
	}
}
