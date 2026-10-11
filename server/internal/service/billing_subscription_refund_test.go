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
