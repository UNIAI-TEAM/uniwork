package service

import (
	"testing"
	"time"
)

func TestSubscriptionLapseCancelToDefault(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	admin := registerVerified(t, f.q, f.auth, "lapse-admin@example.com", "Admin")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	v := f.version(t)
	if _, err := f.billing.ChangePlan(f.ctx, admin.ID, f.orgID, "paid_team", v); err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-24 * time.Hour)
	if _, err := f.pool.Exec(f.ctx, `UPDATE subscriptions SET
		current_period_start = $1, current_period_end = $1, cancel_at = NULL, provider = 'vnpay'
		WHERE organization_id = $2`, past, f.orgID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.billing.Cancel(f.ctx, f.owner.ID, f.orgID); err != nil {
		t.Fatal(err)
	}
	if err := f.billing.ProcessSubscriptionLapse(f.ctx); err != nil {
		t.Fatal(err)
	}
	snap, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if !snap.Plan.IsDefault || snap.Subscription.Status != "active" || snap.Subscription.Provider != "manual" {
		t.Fatalf("expected default manual active, got plan=%+v sub=%+v", snap.Plan, snap.Subscription)
	}
	if snap.Subscription.CancelAt.Valid || snap.Subscription.CurrentPeriodEnd.Valid {
		t.Fatalf("period and cancel_at cleared: %+v", snap.Subscription)
	}
}

func TestSubscriptionLapsePastDue(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	admin := registerVerified(t, f.q, f.auth, "pastdue-admin@example.com", "Admin")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	v := f.version(t)
	if _, err := f.billing.ChangePlan(f.ctx, admin.ID, f.orgID, "paid_team", v); err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-time.Hour)
	if _, err := f.pool.Exec(f.ctx, `UPDATE subscriptions SET
		current_period_start = $1, current_period_end = $1, cancel_at = NULL, provider = 'vnpay', status = 'active'
		WHERE organization_id = $2`, past, f.orgID); err != nil {
		t.Fatal(err)
	}
	if err := f.billing.ProcessSubscriptionLapse(f.ctx); err != nil {
		t.Fatal(err)
	}
	snap, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Subscription.Status != "past_due" || snap.Plan.Code != "paid_team" {
		t.Fatalf("expected past_due on paid plan, got status=%s plan=%s", snap.Subscription.Status, snap.Plan.Code)
	}
	// cancel_at still null; period_end unchanged until renewal or cancel
	if snap.Subscription.CancelAt.Valid {
		t.Fatalf("cancel_at should stay null: %+v", snap.Subscription)
	}
}
