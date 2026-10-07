package service

import (
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/billing"
	"github.com/unicomhub/uniwork/server/internal/config"
)

func TestValidateCheckoutPath(t *testing.T) {
	for _, bad := range []string{"", "https://evil.com", "/ok//bad", "relative"} {
		if err := ValidateCheckoutPath(bad); err == nil {
			t.Fatalf("want error for %q", bad)
		}
	}
	if err := ValidateCheckoutPath("/acme/ws/settings?tab=billing"); err != nil {
		t.Fatal(err)
	}
}

func TestCheckoutMarksIntentFailedWhenProviderUnavailable(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	_, err := f.billing.Checkout(f.ctx, f.owner.ID, f.orgID, "paid_team", "/ok", "/back", "127.0.0.1")
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "billing_provider_unavailable" {
		t.Fatalf("checkout: %v", err)
	}
	var status string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT status FROM billing_payment_intents WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,
		f.orgID,
	).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "failed" {
		t.Fatalf("intent status = %q, want failed", status)
	}
}

func TestApplyProviderEventRejectsBadAmount(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	intentID := "01TESTVNAPYINTENT00003"
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at
	) SELECT $1, s.organization_id, s.id, $2, 'vnpay', $1, 500000, 'VND', 'pending', now() + interval '15 minutes'
	  FROM subscriptions s WHERE s.organization_id = $3`,
		intentID, "01TESTPLANpaid_team", f.orgID); err != nil {
		t.Fatal(err)
	}
	ev := billing.Event{ProviderEventID: "amt-1", ProviderTxnRef: intentID, Paid: true, Amount: 1, Currency: "VND"}
	if err := f.billing.ApplyProviderEvent(f.ctx, ev); err == nil {
		t.Fatal("expected amount mismatch")
	}
	var status string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM billing_payment_intents WHERE id = $1`, intentID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "failed" {
		t.Fatalf("status = %q, want failed", status)
	}
	snap, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Plan.Code == "paid_team" {
		t.Fatal("subscription must not upgrade on bad amount")
	}
}

func TestCheckoutReusesPendingIntentForSamePlan(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	prov := billing.FromConfig(config.Config{BillingProvider: "vnpay", VNPayTMNCode: "TMN", VNPayHashSecret: "secret"})
	f.billing = NewBillingService(f.pool, f.q, f.orgs, prov)
	_, err := f.billing.Checkout(f.ctx, f.owner.ID, f.orgID, "paid_team", "/ok", "/back", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.billing.Checkout(f.ctx, f.owner.ID, f.orgID, "paid_team", "/ok", "/back", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM billing_payment_intents WHERE organization_id = $1 AND status = 'pending'`,
		f.orgID,
	).Scan(&n); err != nil || n != 1 {
		t.Fatalf("pending intents = %d (%v), want 1", n, err)
	}
}

func TestApplyProviderEventPaidAfterFailedIPN(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	intentID := "01TESTVNAPYINTENT00006"
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at
	) SELECT $1, s.organization_id, s.id, $2, 'vnpay', $1, 500000, 'VND', 'pending', now() + interval '15 minutes'
	  FROM subscriptions s WHERE s.organization_id = $3`,
		intentID, "01TESTPLANpaid_team", f.orgID); err != nil {
		t.Fatal(err)
	}
	failEv := billing.Event{ProviderEventID: "fail-1", ProviderTxnRef: intentID, Paid: false}
	if err := f.billing.ApplyProviderEvent(f.ctx, failEv); err != nil {
		t.Fatal(err)
	}
	paidEv := billing.Event{ProviderEventID: "paid-1", ProviderTxnRef: intentID, Paid: true, Amount: 500000, Currency: "VND"}
	if err := f.billing.ApplyProviderEvent(f.ctx, paidEv); err != nil {
		t.Fatal(err)
	}
	snap, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Plan.Code != "paid_team" {
		t.Fatalf("plan = %s, want paid_team", snap.Plan.Code)
	}
}

func TestApplyProviderEventRejectsWhenQuotaExceededAtIPN(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "free_small", 0, map[string]int64{FeatureWorkspacesMax: 1})
	f.seedPlan(t, "paid_team", 500000, map[string]int64{FeatureWorkspacesMax: 1})
	for _, slug := range []string{"one", "two"} {
		if _, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.orgID, slug, slug); err != nil {
			t.Fatal(err)
		}
	}
	intentID := "01TESTVNAPYINTENT00007"
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at
	) SELECT $1, s.organization_id, s.id, $2, 'vnpay', $1, 500000, 'VND', 'pending', now() + interval '15 minutes'
	  FROM subscriptions s WHERE s.organization_id = $3`,
		intentID, "01TESTPLANpaid_team", f.orgID); err != nil {
		t.Fatal(err)
	}
	ev := billing.Event{ProviderEventID: "paid-quota", ProviderTxnRef: intentID, Paid: true, Amount: 500000, Currency: "VND"}
	if err := f.billing.ApplyProviderEvent(f.ctx, ev); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("want quota exceeded, got %v", err)
	}
}

func TestApplyProviderEventRejectsSupersededExpiredIntent(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	oldID := "01TESTVNAPYINTENT00004"
	newID := "01TESTVNAPYINTENT00005"
	for _, row := range []struct {
		id, status string
	}{
		{oldID, "expired"},
		{newID, "pending"},
	} {
		if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
			id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
			amount, currency, status, expires_at
		) SELECT $1, s.organization_id, s.id, $2, 'vnpay', $1, 500000, 'VND', $3, now() + interval '15 minutes'
		  FROM subscriptions s WHERE s.organization_id = $4`,
			row.id, "01TESTPLANpaid_team", row.status, f.orgID); err != nil {
			t.Fatal(err)
		}
	}
	ev := billing.Event{ProviderEventID: "old-paid", ProviderTxnRef: oldID, Paid: true, Amount: 500000, Currency: "VND"}
	if err := f.billing.ApplyProviderEvent(f.ctx, ev); err == nil {
		t.Fatal("expected superseded expired intent to be rejected")
	}
	snap, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Plan.Code == "paid_team" {
		t.Fatal("subscription must not change on expired intent")
	}
}
