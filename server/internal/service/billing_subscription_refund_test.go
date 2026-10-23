package service

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/billing"
)

func TestAdminFullRefundRevertsSubscriptionToDefault(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	planID := "01TESTPLANpaid_team"
	intentID := "01TESTVNAPYINTENT00099"
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at
	) SELECT $1, s.organization_id, s.id, $2, 'vnpay', $1, 500000, 'VND', 'pending', now() + interval '15 minutes'
	  FROM subscriptions s WHERE s.organization_id = $3`,
		intentID, planID, f.orgID); err != nil {
		t.Fatal(err)
	}
	ev := billing.Event{ProviderEventID: "pay-refund-1", ProviderTxnRef: intentID, Paid: true, Amount: 500000, Currency: "VND"}
	if err := f.billing.ApplyProviderEvent(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	snap, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil || snap.Plan.Code != "paid_team" {
		t.Fatalf("upgrade: err=%v plan=%q", err, snap.Plan.Code)
	}
	var invID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM invoices WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`, f.orgID).Scan(&invID); err != nil {
		t.Fatal(err)
	}
	admin := registerVerified(t, f.q, f.auth, "refund-revert@example.com", "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
	if _, err := adminSvc.RefundInvoice(f.ctx, admin.ID, invID,
		"hoàn toàn phần theo yêu cầu khách — test hạ gói", "REF-REVERT", "127.0.0.1", 0); err != nil {
		t.Fatal(err)
	}
	snap, err = f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if !snap.Plan.IsDefault {
		t.Fatalf("want default plan after full refund, got %q", snap.Plan.Code)
	}
}

func payIntent(t *testing.T, f *billingFixture, intentID, planID string, amount int64) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at
	) SELECT $1, s.organization_id, s.id, $2, 'vnpay', $1, $4, 'VND', 'pending', now() + interval '15 minutes'
	  FROM subscriptions s WHERE s.organization_id = $3`,
		intentID, planID, f.orgID, amount); err != nil {
		t.Fatal(err)
	}
	ev := billing.Event{ProviderEventID: "pay-" + intentID, ProviderTxnRef: intentID, Paid: true, Amount: amount, Currency: "VND"}
	if err := f.billing.ApplyProviderEvent(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
}

func TestFullRefundOfOlderInvoiceKeepsCurrentPlan(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	payIntent(t, f, "01TESTVNAPYINTENT00101", "01TESTPLANpaid_team", 500000)
	payIntent(t, f, "01TESTVNAPYINTENT00102", "01TESTPLANpaid_team", 500000)
	before, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil || before.Plan.Code != "paid_team" {
		t.Fatalf("renewed plan: %v %s", err, before.Plan.Code)
	}
	var olderID, newerID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM invoices WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1`, f.orgID).Scan(&olderID); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM invoices WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`, f.orgID).Scan(&newerID); err != nil {
		t.Fatal(err)
	}
	var changesBefore int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'subscription.changed'`, f.orgID).Scan(&changesBefore); err != nil {
		t.Fatal(err)
	}
	admin := registerVerified(t, f.q, f.auth, "refund-older@example.com", "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
	if _, err := adminSvc.RefundInvoice(f.ctx, admin.ID, olderID, "hoàn hóa đơn kỳ trước, giữ kỳ đang trả", "REF-OLDER", "127.0.0.1", 0); err != nil {
		t.Fatal(err)
	}
	after, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Plan.Code != "paid_team" || !after.Subscription.CurrentPeriodEnd.Time.Equal(before.Subscription.CurrentPeriodEnd.Time) {
		t.Fatalf("plan %s period %v, want paid_team %v", after.Plan.Code, after.Subscription.CurrentPeriodEnd.Time, before.Subscription.CurrentPeriodEnd.Time)
	}
	var status string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM invoices WHERE id = $1`, olderID).Scan(&status); err != nil || status != "refunded" {
		t.Fatalf("older invoice status = %q (%v)", status, err)
	}
	var changesAfter int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'subscription.changed'`, f.orgID).Scan(&changesAfter); err != nil {
		t.Fatal(err)
	}
	if changesAfter != changesBefore {
		t.Fatalf("subscription.changed %d -> %d", changesBefore, changesAfter)
	}
	if newerID == olderID {
		t.Fatal("expected two invoices")
	}
}

func TestFullRefundOfCheaperInvoiceKeepsUpgrade(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_basic", 100000, nil)
	f.seedPlan(t, "paid_team", 500000, nil)
	payIntent(t, f, "01TESTVNAPYINTENT00111", "01TESTPLANpaid_basic", 100000)
	payIntent(t, f, "01TESTVNAPYINTENT00112", "01TESTPLANpaid_team", 500000)
	var olderID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM invoices WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1`, f.orgID).Scan(&olderID); err != nil {
		t.Fatal(err)
	}
	admin := registerVerified(t, f.q, f.auth, "refund-upgrade@example.com", "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := NewAdminService(f.pool, f.q, f.billing, f.ent).RefundInvoice(f.ctx, admin.ID, olderID, "hoàn hóa đơn gói rẻ sau khi đã nâng", "REF-UP", "127.0.0.1", 0); err != nil {
		t.Fatal(err)
	}
	snap, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil || snap.Plan.Code != "paid_team" {
		t.Fatalf("plan = %q err=%v", snap.Plan.Code, err)
	}
}
