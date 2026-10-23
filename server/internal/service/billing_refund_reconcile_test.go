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

func TestProcessRefundPendingReconcileStatus05StaysPending(t *testing.T) {
	f := seedRefundReconcileInvoice(t, "05", "refund_pending", 0, "01TESTINVOICE0000010", "01TESTREFUNDRECON0002")
	var planBefore string
	if err := f.pool.QueryRow(f.ctx, `SELECT plan_id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&planBefore); err != nil {
		t.Fatal(err)
	}
	if err := f.billing.ProcessRefundPendingReconcile(f.ctx); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM invoices WHERE id = $1`, "01TESTINVOICE0000010").Scan(&status); err != nil || status != "refund_pending" {
		t.Fatalf("status = %q err=%v", status, err)
	}
	var planAfter string
	if err := f.pool.QueryRow(f.ctx, `SELECT plan_id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&planAfter); err != nil || planAfter != planBefore {
		t.Fatalf("plan %s -> %s err=%v", planBefore, planAfter, err)
	}
}

func TestProcessRefundPendingReconcilePartial04ReturnsToPaid(t *testing.T) {
	const invID = "01TESTINVOICE0000011"
	f := seedRefundReconcileInvoice(t, "04", "partial_refund_pending", 200000, invID, "01TESTREFUNDRECON0003")
	if err := f.billing.ProcessRefundPendingReconcile(f.ctx); err != nil {
		t.Fatal(err)
	}
	var status string
	var refunded int64
	if err := f.pool.QueryRow(f.ctx, `SELECT status, amount_refunded FROM invoices WHERE id = $1`, invID).Scan(&status, &refunded); err != nil {
		t.Fatal(err)
	}
	if status != "paid" || refunded != 200000 {
		t.Fatalf("status=%s refunded=%d", status, refunded)
	}
}

func seedRefundReconcileInvoice(t *testing.T, txnStatus, invoiceStatus string, partial int64, invID, intentID string) *billingFixture {
	t.Helper()
	secret := "testsecret"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		resp := map[string]string{
			"vnp_ResponseId": "VNPQ1255", "vnp_Command": "querydr", "vnp_ResponseCode": "00",
			"vnp_Message": "Success", "vnp_TmnCode": "TMNTEST1", "vnp_TxnRef": req["vnp_TxnRef"],
			"vnp_Amount": "150000000", "vnp_TransactionNo": "14312551", "vnp_TransactionType": "01",
			"vnp_TransactionStatus": txnStatus, "vnp_OrderInfo": req["vnp_OrderInfo"],
		}
		resp["vnp_SecureHash"] = billing.SignQueryDRResponseForTest(resp, secret)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	t.Cleanup(srv.Close)
	f := newBillingFixture(t)
	f.seedPlan(t, "R1255", 1500000, nil)
	if _, err := f.pool.Exec(f.ctx, `UPDATE subscriptions SET plan_id = $1 WHERE organization_id = $2`, "01TESTPLANR1255", f.orgID); err != nil {
		t.Fatal(err)
	}
	vnp, err := billing.NewVNPay(billing.VNPayConfig{TMNCode: "TMNTEST1", HashSecret: secret, QueryURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	f.billing = NewBillingService(f.pool, f.q, f.orgs, vnp)
	var subID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at, completed_at, created_at
	) VALUES ($1, $2, $3, $4, 'vnpay', $1, 1500000, 'VND', 'completed', now() + interval '1 hour', now(), now() - interval '1 day')`,
		intentID, f.orgID, subID, "01TESTPLANR1255"); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if invoiceStatus == "partial_refund_pending" {
		if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
			id, organization_id, subscription_id, provider, number, status,
			amount_due, amount_paid, currency, period_start, period_end, paid_at,
			refund_requested_at, partial_refund_amount
		) VALUES ($1, $2, $3, 'vnpay', $4, 'partial_refund_pending', 1500000, 1500000, 'VND', $5, $5, $5, now() - interval '5 minutes', $6)`,
			invID, f.orgID, subID, "UW-"+intentID, now, partial); err != nil {
			t.Fatal(err)
		}
		return f
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, currency, period_start, period_end, paid_at, refund_requested_at
	) VALUES ($1, $2, $3, 'vnpay', $4, 'refund_pending', 1500000, 1500000, 'VND', $5, $5, $5, now() - interval '5 minutes')`,
		invID, f.orgID, subID, "UW-"+intentID, now); err != nil {
		t.Fatal(err)
	}
	return f
}
