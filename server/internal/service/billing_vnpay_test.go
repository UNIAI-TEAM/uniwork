package service

import (
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/billing"
	"github.com/unicomhub/uniwork/server/internal/config"
)

func TestApplyProviderEventPaid(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	v := f.version(t)
	intentID := "01TESTVNAPYINTENT00001"
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at
	) SELECT $1, s.organization_id, s.id, $2, 'vnpay', $1, 500000, 'VND', 'pending', now() + interval '15 minutes'
	  FROM subscriptions s WHERE s.organization_id = $3`,
		intentID, "01TESTPLANpaid_team", f.orgID); err != nil {
		t.Fatal(err)
	}
	prov := billing.FromConfig(config.Config{BillingProvider: "vnpay", VNPayTMNCode: "TMN", VNPayHashSecret: "secret"})
	f.billing = NewBillingService(f.pool, f.q, f.orgs, prov)
	ev := billing.Event{
		ProviderEventID: "14234567",
		ProviderTxnRef:  intentID,
		Type:            "invoice.paid",
		Paid:            true,
		Amount:          500000,
		Currency:        "VND",
	}
	if err := f.billing.ApplyProviderEvent(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	snap, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Plan.Code != "paid_team" || snap.Subscription.Provider != "vnpay" {
		t.Fatalf("subscription: %+v", snap.Subscription)
	}
	if snap.Subscription.RowVersion != v+1 {
		t.Fatalf("row_version want %d got %d", v+1, snap.Subscription.RowVersion)
	}
	var invCount int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM invoices WHERE organization_id = $1`, f.orgID).Scan(&invCount); err != nil || invCount != 1 {
		t.Fatalf("invoices: %d %v", invCount, err)
	}
	// Idempotent retry
	if err := f.billing.ApplyProviderEvent(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM invoices WHERE organization_id = $1`, f.orgID).Scan(&invCount); err != nil || invCount != 1 {
		t.Fatalf("duplicate apply added invoices: %d", invCount)
	}
}

func TestHandleProviderWebhookDedupesInbox(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	intentID := "01TESTVNAPYINTENT00002"
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at
	) SELECT $1, s.organization_id, s.id, $2, 'vnpay', $1, 500000, 'VND', 'pending', now() + interval '15 minutes'
	  FROM subscriptions s WHERE s.organization_id = $3`,
		intentID, "01TESTPLANpaid_team", f.orgID); err != nil {
		t.Fatal(err)
	}
	prov := billing.FromConfig(config.Config{BillingProvider: "vnpay", VNPayTMNCode: "TMN", VNPayHashSecret: "secret"})
	f.billing = NewBillingService(f.pool, f.q, f.orgs, prov)
	ev := billing.Event{
		ProviderEventID: "dup-vnp-event-1",
		ProviderTxnRef:  intentID,
		Type:            "invoice.paid",
		Paid:            true,
		Amount:          500000,
		Currency:        "VND",
	}
	payload, err := ProviderWebhookPayloadJSON(ev)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := f.billing.HandleProviderWebhook(f.ctx, ev, payload)
	if err != nil || !ok {
		t.Fatalf("first webhook: ok=%v err=%v", ok, err)
	}
	ok, err = f.billing.HandleProviderWebhook(f.ctx, ev, payload)
	if err != nil || !ok {
		t.Fatalf("duplicate webhook: ok=%v err=%v", ok, err)
	}
	var invCount int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM invoices WHERE organization_id = $1`, f.orgID).Scan(&invCount); err != nil || invCount != 1 {
		t.Fatalf("invoices after duplicate IPN: %d %v", invCount, err)
	}
	var inboxDone int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM webhook_inbox WHERE provider_event_id = $1 AND status = 'DONE'`, ev.ProviderEventID).Scan(&inboxDone); err != nil || inboxDone != 1 {
		t.Fatalf("inbox rows: %d %v", inboxDone, err)
	}
}

func TestListInvoicesRequiresMember(t *testing.T) {
	f := newBillingFixture(t)
	outsider := registerVerified(t, f.q, f.auth, "inv-outsider@example.com", "Other")
	if _, err := f.billing.ListInvoices(f.ctx, outsider.ID, f.orgID, 10, 0); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider: got %v", err)
	}
	rows, err := f.billing.ListInvoices(f.ctx, f.owner.ID, f.orgID, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("want empty, got %d", len(rows))
	}
}
