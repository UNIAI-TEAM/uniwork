package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/billing"
)

func TestAdminRefundVnpayUnknownOutcomeStaysPending(t *testing.T) {
	secret := "testsecret"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req["vnp_Command"] == "refund" {
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<html>gateway timeout</html>"))
			return
		}
		resp := map[string]string{
			"vnp_ResponseId": "VNPQUNK1", "vnp_Command": "querydr", "vnp_ResponseCode": "00",
			"vnp_Message": "Success", "vnp_TmnCode": "TMNTEST1", "vnp_TxnRef": req["vnp_TxnRef"],
			"vnp_Amount": "100000000", "vnp_TransactionNo": "14300001", "vnp_TransactionType": "01",
			"vnp_TransactionStatus": "00", "vnp_OrderInfo": req["vnp_OrderInfo"],
		}
		resp["vnp_SecureHash"] = billing.SignQueryDRResponseForTest(resp, secret)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	f, adminSvc, invID := seedVnpayPaidInvoice(t, srv.URL, secret, "01TESTINVOICE0000007", "01TESTREFUNDUNK000001", "unknown-refund@example.com")
	_, err := adminSvc.RefundInvoice(f.ctx, mustPlatformAdmin(t, f, "unknown-refund@example.com"), invID, "hoàn một phần khi cổng không trả lời", "", "127.0.0.1", 200000)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "vnpay_refund_unknown" {
		t.Fatalf("want vnpay_refund_unknown, got %v", err)
	}
	var status string
	var partial int64
	if err := f.pool.QueryRow(f.ctx, `SELECT status, partial_refund_amount FROM invoices WHERE id = $1`, invID).Scan(&status, &partial); err != nil {
		t.Fatal(err)
	}
	if status != "partial_refund_pending" || partial != 200000 {
		t.Fatalf("invoice status=%s partial=%d", status, partial)
	}
}

func TestAdminRefundVnpayRejectedRevertsWithAudit(t *testing.T) {
	secret := "testsecret"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req["vnp_Command"] == "refund" {
			resp := map[string]string{
				"vnp_ResponseId": "VNPREF95", "vnp_Command": "refund", "vnp_ResponseCode": "95",
				"vnp_Message": "Giao dich goc khong thanh cong", "vnp_TmnCode": "TMNTEST1",
				"vnp_TxnRef": req["vnp_TxnRef"], "vnp_Amount": req["vnp_Amount"],
				"vnp_BankCode": "", "vnp_PayDate": "", "vnp_TransactionNo": "0",
				"vnp_TransactionType": req["vnp_TransactionType"], "vnp_TransactionStatus": "02",
				"vnp_OrderInfo": req["vnp_OrderInfo"],
			}
			resp["vnp_SecureHash"] = billing.SignRefundResponseForTest(resp, secret)
			_ = json.NewEncoder(w).Encode(resp)
			return
		}
		resp := map[string]string{
			"vnp_ResponseId": "VNPQREJ1", "vnp_Command": "querydr", "vnp_ResponseCode": "00",
			"vnp_Message": "Success", "vnp_TmnCode": "TMNTEST1", "vnp_TxnRef": req["vnp_TxnRef"],
			"vnp_Amount": "100000000", "vnp_TransactionNo": "14300002", "vnp_TransactionType": "01",
			"vnp_TransactionStatus": "00", "vnp_OrderInfo": req["vnp_OrderInfo"],
		}
		resp["vnp_SecureHash"] = billing.SignQueryDRResponseForTest(resp, secret)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	f, adminSvc, invID := seedVnpayPaidInvoice(t, srv.URL, secret, "01TESTINVOICE0000008", "01TESTREFUNDREJ000001", "reject-refund@example.com")
	adminID := mustPlatformAdmin(t, f, "reject-refund@example.com")
	_, err := adminSvc.RefundInvoice(f.ctx, adminID, invID, "hoàn bị VNPay từ chối rõ", "", "127.0.0.1", 200000)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "vnpay_refund_failed" {
		t.Fatalf("want vnpay_refund_failed, got %v", err)
	}
	var status string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM invoices WHERE id = $1`, invID).Scan(&status); err != nil || status != "paid" {
		t.Fatalf("status = %q err=%v", status, err)
	}
	var actions, audits int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM admin_actions WHERE target_id = $1`, invID).Scan(&actions); err != nil || actions < 2 {
		t.Fatalf("admin_actions = %d err=%v", actions, err)
	}
	if err := f.pool.QueryRow(f.ctx, `
		SELECT count(*) FROM audit_events
		WHERE resource_id = $1 AND metadata::jsonb->>'refund_phase' = 'reverted'`, invID).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("reverted audits = %d err=%v", audits, err)
	}
}

func seedVnpayPaidInvoice(t *testing.T, queryURL, secret, invID, intentID, email string) (*billingFixture, *AdminService, string) {
	t.Helper()
	f := newBillingFixture(t)
	vnp, err := billing.NewVNPay(billing.VNPayConfig{TMNCode: "TMNTEST1", HashSecret: secret, QueryURL: queryURL})
	if err != nil {
		t.Fatal(err)
	}
	f.billing = NewBillingService(f.pool, f.q, f.orgs, vnp)
	adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
	var subID, planID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id, plan_id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID, &planID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at, completed_at, created_at
	) VALUES ($1, $2, $3, $4, 'vnpay', $1, 1000000, 'VND', 'completed', now() + interval '1 hour', now(), now() - interval '1 day')`,
		intentID, f.orgID, subID, planID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, currency, period_start, period_end, paid_at
	) VALUES ($1, $2, $3, 'vnpay', $4, 'paid', 1000000, 1000000, 'VND', $5, $5, $5)`,
		invID, f.orgID, subID, "UW-"+intentID, now); err != nil {
		t.Fatal(err)
	}
	_ = email
	return f, adminSvc, invID
}

func mustPlatformAdmin(t *testing.T, f *billingFixture, email string) string {
	t.Helper()
	admin := registerVerified(t, f.q, f.auth, email, "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	return admin.ID
}
