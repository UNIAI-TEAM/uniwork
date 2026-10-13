package service

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
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
		RawParams: map[string]string{
			"vnp_BankCode":      "NCB",
			"vnp_TransactionNo": "14234567",
		},
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
	var invNumber string
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*), coalesce(min(number), '') FROM invoices WHERE organization_id = $1`, f.orgID).Scan(&invCount, &invNumber); err != nil || invCount != 1 {
		t.Fatalf("invoices: %d %v", invCount, err)
	}
	if ok, _ := regexp.MatchString(`^UW-[0-9]{4}-.{16}$`, invNumber); !ok {
		t.Fatalf("invoice number %q", invNumber)
	}
	var bankCode, txnNo string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT COALESCE(provider_bank_code, ''), COALESCE(provider_transaction_no, '') FROM billing_payment_intents WHERE id = $1`,
		intentID).Scan(&bankCode, &txnNo); err != nil || bankCode != "NCB" || txnNo != "14234567" {
		t.Fatalf("intent meta: bank=%q txn=%q err=%v", bankCode, txnNo, err)
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
	if err != nil || ok != "00" {
		t.Fatalf("first webhook: code=%s err=%v", ok, err)
	}
	ok, err = f.billing.HandleProviderWebhook(f.ctx, ev, payload)
	if err != nil || ok != "02" {
		t.Fatalf("duplicate webhook: code=%s err=%v", ok, err)
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

func TestHandleProviderWebhookAcksTerminalAmountMismatch(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	intentID := "01TESTVNAPYINTENT00004"
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
		ProviderEventID: "bad-amt-webhook-1",
		ProviderTxnRef:  intentID,
		Paid:            true,
		Amount:          1,
		Currency:        "VND",
	}
	payload, err := ProviderWebhookPayloadJSON(ev)
	if err != nil {
		t.Fatal(err)
	}
	code, err := f.billing.HandleProviderWebhook(f.ctx, ev, payload)
	if err != nil || code != "04" {
		t.Fatalf("terminal mismatch should ack 04: code=%s err=%v", code, err)
	}
	var status string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM billing_payment_intents WHERE id = $1`, intentID).Scan(&status); err != nil || status != "failed" {
		t.Fatalf("intent status = %q err=%v", status, err)
	}
}

func TestHandleProviderWebhookUnknownTxnRef(t *testing.T) {
	f := newBillingFixture(t)
	prov := billing.FromConfig(config.Config{BillingProvider: "vnpay", VNPayTMNCode: "TMN", VNPayHashSecret: "secret"})
	f.billing = NewBillingService(f.pool, f.q, f.orgs, prov)
	ev := billing.Event{
		ProviderEventID: "missing-txn-1",
		ProviderTxnRef:  "01NOINTENT0000000000",
		Type:            "invoice.paid",
		Paid:            true,
		Amount:          500000,
		Currency:        "VND",
	}
	payload, err := ProviderWebhookPayloadJSON(ev)
	if err != nil {
		t.Fatal(err)
	}
	code, err := f.billing.HandleProviderWebhook(f.ctx, ev, payload)
	if err != nil || code != "01" {
		t.Fatalf("unknown txn: code=%s err=%v", code, err)
	}
}

func TestHandleProviderWebhookCompletedIntentIsAlreadyConfirmed(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	intentID := "01TESTVNAPYINTENT00005"
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
	first := billing.Event{
		ProviderEventID: "completed-event-1",
		ProviderTxnRef:  intentID,
		Type:            "invoice.paid",
		Paid:            true,
		Amount:          500000,
		Currency:        "VND",
	}
	payload, err := ProviderWebhookPayloadJSON(first)
	if err != nil {
		t.Fatal(err)
	}
	code, err := f.billing.HandleProviderWebhook(f.ctx, first, payload)
	if err != nil || code != "00" {
		t.Fatalf("first paid IPN: code=%s err=%v", code, err)
	}
	again := first
	again.ProviderEventID = "completed-event-2"
	payload, err = ProviderWebhookPayloadJSON(again)
	if err != nil {
		t.Fatal(err)
	}
	code, err = f.billing.HandleProviderWebhook(f.ctx, again, payload)
	if err != nil || code != "02" {
		t.Fatalf("new event on completed intent: code=%s err=%v", code, err)
	}
	var invCount int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM invoices WHERE organization_id = $1`, f.orgID).Scan(&invCount); err != nil || invCount != 1 {
		t.Fatalf("invoices: %d %v", invCount, err)
	}
}

func TestHandleProviderWebhookAcceptsPaidExpiredIntent(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	intentID := "01TESTVNAPYINTENT00008"
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at
	) SELECT $1, s.organization_id, s.id, $2, 'vnpay', $1, 500000, 'VND', 'expired', now() - interval '1 hour'
	  FROM subscriptions s WHERE s.organization_id = $3`,
		intentID, "01TESTPLANpaid_team", f.orgID); err != nil {
		t.Fatal(err)
	}
	prov := billing.FromConfig(config.Config{BillingProvider: "vnpay", VNPayTMNCode: "TMN", VNPayHashSecret: "secret"})
	f.billing = NewBillingService(f.pool, f.q, f.orgs, prov)
	ev := billing.Event{
		ProviderEventID: "expired-paid-1",
		ProviderTxnRef:  intentID,
		Type:            "invoice.paid",
		Paid:            true,
		Amount:          500000,
		Currency:        "VND",
		RawParams:       map[string]string{"vnp_TransactionNo": "11223344"},
	}
	payload, err := ProviderWebhookPayloadJSON(ev)
	if err != nil {
		t.Fatal(err)
	}
	code, err := f.billing.HandleProviderWebhook(f.ctx, ev, payload)
	if err != nil || code != "00" {
		t.Fatalf("expired paid IPN: code=%s err=%v", code, err)
	}
	var inboxDone int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM webhook_inbox WHERE provider_event_id = $1 AND status = 'DONE'`, ev.ProviderEventID).Scan(&inboxDone); err != nil || inboxDone != 1 {
		t.Fatalf("inbox done rows: %d %v", inboxDone, err)
	}
	code, err = f.billing.HandleProviderWebhook(f.ctx, ev, payload)
	if err != nil || code != "02" {
		t.Fatalf("replay: code=%s err=%v", code, err)
	}
	var invCount int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM invoices WHERE organization_id = $1`, f.orgID).Scan(&invCount); err != nil || invCount != 1 {
		t.Fatalf("invoices after replay: %d %v", invCount, err)
	}
}

func TestHandleProviderWebhookExpiredIntentBadAmountStaysFailed(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	intentID := "01TESTVNAPYINTENT00009"
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at
	) SELECT $1, s.organization_id, s.id, $2, 'vnpay', $1, 500000, 'VND', 'expired', now() - interval '1 hour'
	  FROM subscriptions s WHERE s.organization_id = $3`,
		intentID, "01TESTPLANpaid_team", f.orgID); err != nil {
		t.Fatal(err)
	}
	prov := billing.FromConfig(config.Config{BillingProvider: "vnpay", VNPayTMNCode: "TMN", VNPayHashSecret: "secret"})
	f.billing = NewBillingService(f.pool, f.q, f.orgs, prov)
	ev := billing.Event{
		ProviderEventID: "expired-bad-amt-1",
		ProviderTxnRef:  intentID,
		Paid:            true,
		Amount:          1,
		Currency:        "VND",
	}
	payload, err := ProviderWebhookPayloadJSON(ev)
	if err != nil {
		t.Fatal(err)
	}
	code, err := f.billing.HandleProviderWebhook(f.ctx, ev, payload)
	if err != nil || code != "04" {
		t.Fatalf("expired amount mismatch: code=%s err=%v", code, err)
	}
	var status string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM billing_payment_intents WHERE id = $1`, intentID).Scan(&status); err != nil || status != "failed" {
		t.Fatalf("intent status = %q err=%v", status, err)
	}
	snap, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Plan.Code == "paid_team" {
		t.Fatal("subscription must not upgrade on a mismatched expired payment")
	}
}

type countingBillingMetrics struct{ n int }

func (m *countingBillingMetrics) IncWebhookDead() { m.n++ }

func TestHandleProviderWebhookQueuesNonTerminalFailure(t *testing.T) {
	f := newBillingFixture(t)
	intentID := "01TESTVNAPYINTENT00010"
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at
	) SELECT $1, s.organization_id, s.id, '01MISSINGPLAN12490001', 'vnpay', $1, 500000, 'VND', 'expired', now() - interval '1 hour'
	  FROM subscriptions s WHERE s.organization_id = $2`,
		intentID, f.orgID); err != nil {
		t.Fatal(err)
	}
	prov := billing.FromConfig(config.Config{BillingProvider: "vnpay", VNPayTMNCode: "TMN", VNPayHashSecret: "secret"})
	f.billing = NewBillingService(f.pool, f.q, f.orgs, prov)
	metrics := &countingBillingMetrics{}
	f.billing.SetBillingMetrics(metrics)
	ev := billing.Event{
		ProviderEventID: "missing-plan-ipn-1",
		ProviderTxnRef:  intentID,
		Type:            "invoice.paid",
		Paid:            true,
		Amount:          500000,
		Currency:        "VND",
		RawParams: map[string]string{
			"vnp_TxnRef":       intentID,
			"vnp_ResponseCode": "00",
			"vnp_Amount":       "50000000",
			"vnp_CurrCode":     "VND",
		},
	}
	payload, err := ProviderWebhookPayloadJSON(ev)
	if err != nil {
		t.Fatal(err)
	}
	code, err := f.billing.HandleProviderWebhook(f.ctx, ev, payload)
	if err != nil || code != "00" {
		t.Fatalf("queued failure: code=%s err=%v", code, err)
	}
	var rows int
	var status, stored string
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*), max(status), max(payload) FROM webhook_inbox WHERE provider = 'vnpay' AND provider_event_id = $1`, ev.ProviderEventID).Scan(&rows, &status, &stored); err != nil {
		t.Fatal(err)
	}
	if rows != 1 || status != "PENDING" || stored == "" || !strings.Contains(stored, intentID) {
		t.Fatalf("inbox rows=%d status=%q payload=%q", rows, status, stored)
	}
	code, err = f.billing.HandleProviderWebhook(f.ctx, ev, payload)
	if err != nil || code != "02" {
		t.Fatalf("replay: code=%s err=%v", code, err)
	}
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM webhook_inbox WHERE provider = 'vnpay' AND provider_event_id = $1`, ev.ProviderEventID).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("inbox rows after replay = %d (%v), want 1", rows, err)
	}
	var intentStatus string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM billing_payment_intents WHERE id = $1`, intentID).Scan(&intentStatus); err != nil || intentStatus != "expired" {
		t.Fatalf("intent status = %q err=%v", intentStatus, err)
	}

	for range webhookMaxAttempts {
		if _, err := f.pool.Exec(f.ctx, `UPDATE webhook_inbox SET next_attempt_at = now() - interval '1 second' WHERE provider_event_id = $1 AND status = 'PENDING'`, ev.ProviderEventID); err != nil {
			t.Fatal(err)
		}
		if err := f.billing.ProcessBillingWebhookInbox(f.ctx, 10); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM webhook_inbox WHERE provider_event_id = $1`, ev.ProviderEventID).Scan(&status); err != nil || status != "DEAD_LETTER" {
		t.Fatalf("inbox status = %q err=%v", status, err)
	}
	if metrics.n != 1 {
		t.Fatalf("dead-letter counter = %d, want 1", metrics.n)
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

func TestHandleProviderWebhookZeroTxnNoFailsEachOrg(t *testing.T) {
	f := newBillingFixture(t)
	ownerB := registerVerified(t, f.q, f.auth, "cancel-b@example.com", "Owner B")
	orgB, err := f.orgs.Create(f.ctx, ownerB.ID, "Org B", "org-b-cancel")
	if err != nil {
		t.Fatal(err)
	}
	secret := "secret"
	prov := billing.FromConfig(config.Config{BillingProvider: "vnpay", VNPayTMNCode: "TMN", VNPayHashSecret: secret})
	f.billing = NewBillingService(f.pool, f.q, f.orgs, prov)
	insert := func(id, orgID string) {
		t.Helper()
		if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
			id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
			amount, currency, status, expires_at
		) SELECT $1, s.organization_id, s.id, s.plan_id, 'vnpay', $1, 499000, 'VND', 'pending', now() + interval '15 minutes'
		  FROM subscriptions s WHERE s.organization_id = $2 AND s.status <> 'canceled'`,
			id, orgID); err != nil {
			t.Fatal(err)
		}
	}
	insert("01TESTVNAPYINTENT00011", f.orgID)
	insert("01TESTVNAPYINTENT00012", orgB.ID)

	cancel := func(txnRef string) (string, error) {
		t.Helper()
		params := map[string]string{
			"vnp_Amount":        "49900000",
			"vnp_ResponseCode":  "24",
			"vnp_TmnCode":       "TMN",
			"vnp_TransactionNo": "0",
			"vnp_TxnRef":        txnRef,
			"vnp_CurrCode":      "VND",
		}
		billing.SignIPNForTest(params, secret)
		q := url.Values{}
		for k, val := range params {
			q.Set(k, val)
		}
		req := httptest.NewRequest(http.MethodGet, "/ipn?"+q.Encode(), nil)
		ev, err := prov.ParseWebhook(req)
		if err != nil {
			t.Fatal(err)
		}
		if ev.ProviderEventID == "0" {
			t.Fatalf("event id for %s is 0", txnRef)
		}
		payload, err := ProviderWebhookPayloadJSON(ev)
		if err != nil {
			t.Fatal(err)
		}
		return f.billing.HandleProviderWebhook(f.ctx, ev, payload)
	}
	for _, id := range []string{"01TESTVNAPYINTENT00011", "01TESTVNAPYINTENT00012"} {
		code, err := cancel(id)
		if err != nil || code != "00" {
			t.Fatalf("cancel %s: code=%s err=%v", id, code, err)
		}
	}
	for _, id := range []string{"01TESTVNAPYINTENT00011", "01TESTVNAPYINTENT00012"} {
		var status string
		if err := f.pool.QueryRow(f.ctx, `SELECT status FROM billing_payment_intents WHERE id = $1`, id).Scan(&status); err != nil || status != "failed" {
			t.Fatalf("intent %s status=%q err=%v, want failed", id, status, err)
		}
	}
}
