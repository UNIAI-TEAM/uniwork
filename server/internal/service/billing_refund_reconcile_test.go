package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/billing"
)

func TestProcessRefundPendingReconcile(t *testing.T) {
	secret := "testsecret"
	var gotTxnRef string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		gotTxnRef = req["vnp_TxnRef"]
		resp := map[string]string{
			"vnp_ResponseId":        "VNPQREF1",
			"vnp_Command":           "querydr",
			"vnp_ResponseCode":      "00",
			"vnp_Message":           "Success",
			"vnp_TmnCode":           "TMNTEST1",
			"vnp_TxnRef":            gotTxnRef,
			"vnp_Amount":            "49900000",
			"vnp_TransactionNo":     "14399999",
			"vnp_TransactionType":   "01",
			"vnp_TransactionStatus": "04",
			"vnp_OrderInfo":         req["vnp_OrderInfo"],
		}
		resp["vnp_SecureHash"] = billing.SignQueryDRResponseForTest(resp, secret)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	f := newBillingFixture(t)
	vnp, err := billing.NewVNPay(billing.VNPayConfig{
		TMNCode: "TMNTEST1", HashSecret: secret, QueryURL: srv.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	f.billing = NewBillingService(f.pool, f.q, f.orgs, vnp)

	intentID := "01TESTREFUNDRECON0001"
	invID := "01TESTINVOICE0000003"
	var subID, planID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id, plan_id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID, &planID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at, completed_at, created_at
	) VALUES ($1, $2, $3, $4, 'vnpay', $1, 499000, 'VND', 'completed', now() + interval '1 hour', now(), now() - interval '1 day')`,
		intentID, f.orgID, subID, planID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, currency, period_start, period_end, paid_at, refund_requested_at
	) VALUES ($1, $2, $3, 'vnpay', 'UW-TEST-RECON', 'refund_pending', 499000, 499000, 'VND', $4, $4, $4, now() - interval '5 minutes')`,
		invID, f.orgID, subID, now); err != nil {
		t.Fatal(err)
	}

	if err := f.billing.ProcessRefundPendingReconcile(f.ctx); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM invoices WHERE id = $1`, invID).Scan(&status); err != nil || status != "refunded" {
		t.Fatalf("status = %q err=%v", status, err)
	}
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionBillingInvoiceRefunded, invID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("audit: %d %v", n, err)
	}
	if gotTxnRef != intentID {
		t.Fatalf("querydr txn ref = %q", gotTxnRef)
	}
}
