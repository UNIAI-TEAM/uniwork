package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/billing"
)

func TestAdminRefundInvoice(t *testing.T) {
	f := newBillingFixture(t)
	admin := registerVerified(t, f.q, f.auth, "refund-admin@example.com", "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
	invID := "01TESTINVOICE0000001"
	var subID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, currency, period_start, period_end, paid_at
	) VALUES ($1, $2, $3, 'manual', 'UW-TEST-REFUND', 'paid', 500000, 500000, 'VND', $4, $4, $4)`,
		invID, f.orgID, subID, now); err != nil {
		t.Fatal(err)
	}
	_, err := adminSvc.RefundInvoice(f.ctx, admin.ID, invID, "short", "", "127.0.0.1", 0)
	if !errors.Is(err, ErrReasonTooShort) {
		t.Fatalf("reason: %v", err)
	}
	after, err := adminSvc.RefundInvoice(f.ctx, admin.ID, invID, "đã hoàn trên portal VNPay theo ticket CS", "REF123", "127.0.0.1", 0)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != "refunded" || !after.RefundedAt.Valid {
		t.Fatalf("invoice: %+v", after)
	}
	_, err = adminSvc.RefundInvoice(f.ctx, admin.ID, invID, "lặp lại hoàn tiền lần nữa", "", "127.0.0.1", 0)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "invoice_not_refundable" {
		t.Fatalf("second refund: %v", err)
	}
	var action string
	if err := f.pool.QueryRow(f.ctx, `SELECT action FROM admin_actions WHERE target_id = $1 ORDER BY created_at DESC LIMIT 1`, invID).Scan(&action); err != nil || action != audit.ActionBillingInvoiceRefunded {
		t.Fatalf("admin_actions: %v %s", err, action)
	}
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, audit.ActionBillingInvoiceRefunded, invID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("audit_events: %d %v", n, err)
	}
}

func TestAdminConfirmInvoiceRefund(t *testing.T) {
	f := newBillingFixture(t)
	admin := registerVerified(t, f.q, f.auth, "confirm-refund@example.com", "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
	invID := "01TESTINVOICE0000002"
	var subID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, currency, period_start, period_end, paid_at, refund_requested_at
	) VALUES ($1, $2, $3, 'vnpay', 'UW-TEST-PENDING', 'refund_pending', 499000, 499000, 'VND', $4, $4, $4, $4)`,
		invID, f.orgID, subID, now); err != nil {
		t.Fatal(err)
	}
	after, err := adminSvc.ConfirmInvoiceRefund(f.ctx, admin.ID, invID, "VNPay merchant đã duyệt hoàn trên portal")
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != "refunded" || !after.RefundedAt.Valid {
		t.Fatalf("invoice: %+v", after)
	}
}

func TestAdminRefundInvoiceRespectsAmountAlreadyRefunded(t *testing.T) {
	f := newBillingFixture(t)
	admin := registerVerified(t, f.q, f.auth, "refund-cap@example.com", "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
	invID := "01TESTINVOICE0000005"
	var subID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, amount_refunded, currency, period_start, period_end, paid_at
	) VALUES ($1, $2, $3, 'manual', 'UW-TEST-CAP', 'paid', 1000000, 1000000, 300000, 'VND', $4, $4, $4)`,
		invID, f.orgID, subID, now); err != nil {
		t.Fatal(err)
	}
	_, err := adminSvc.RefundInvoice(f.ctx, admin.ID, invID, "hoàn vượt phần còn lại", "", "127.0.0.1", 800000)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "invalid_refund_amount" {
		t.Fatalf("want invalid_refund_amount, got %v", err)
	}
	after, err := adminSvc.RefundInvoice(f.ctx, admin.ID, invID, "hoàn phần còn lại 700k", "", "127.0.0.1", 700000)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != "refunded" || after.AmountRefunded != 1000000 {
		t.Fatalf("invoice: %+v", after)
	}
}

func TestAdminConfirmPartialRefundReturnsToPaid(t *testing.T) {
	f := newBillingFixture(t)
	admin := registerVerified(t, f.q, f.auth, "partial-refund@example.com", "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
	invID := "01TESTINVOICE0000004"
	var subID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, currency, period_start, period_end, paid_at,
		refund_requested_at, partial_refund_amount
	) VALUES ($1, $2, $3, 'vnpay', 'UW-TEST-PARTIAL', 'partial_refund_pending', 1500000, 1500000, 'VND', $4, $4, $4, $4, 200000)`,
		invID, f.orgID, subID, now); err != nil {
		t.Fatal(err)
	}
	after, err := adminSvc.ConfirmInvoiceRefund(f.ctx, admin.ID, invID, "VNPay đã duyệt hoàn một phần 200k")
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != "paid" || after.AmountRefunded != 200000 || after.RefundedAt.Valid {
		t.Fatalf("invoice: status=%q refunded=%d at=%v", after.Status, after.AmountRefunded, after.RefundedAt.Valid)
	}
}

func TestAdminRefundInvoiceManualRejectsPartial(t *testing.T) {
	f := newBillingFixture(t)
	admin := registerVerified(t, f.q, f.auth, "manual-partial@example.com", "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	f.seedPlan(t, "M1256", 1000000, nil)
	if _, err := f.pool.Exec(f.ctx, `UPDATE subscriptions SET plan_id = $1 WHERE organization_id = $2`, "01TESTPLANM1256", f.orgID); err != nil {
		t.Fatal(err)
	}
	adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
	invID := "01TESTINVOICE0000012"
	var subID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, currency, period_start, period_end, paid_at
	) VALUES ($1, $2, $3, 'manual', 'UW-TEST-MANUAL-PARTIAL', 'paid', 1000000, 1000000, 'VND', $4, $4, $4)`,
		invID, f.orgID, subID, now); err != nil {
		t.Fatal(err)
	}
	_, err := adminSvc.RefundInvoice(f.ctx, admin.ID, invID, "hoàn một phần hóa đơn tay", "", "127.0.0.1", 200000)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "invalid_refund_amount" {
		t.Fatalf("partial manual: %v", err)
	}
	var status string
	var refunded int64
	var planID string
	if err := f.pool.QueryRow(f.ctx, `SELECT status, amount_refunded FROM invoices WHERE id = $1`, invID).Scan(&status, &refunded); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(f.ctx, `SELECT plan_id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&planID); err != nil {
		t.Fatal(err)
	}
	if status != "paid" || refunded != 0 || planID != "01TESTPLANM1256" {
		t.Fatalf("status=%s refunded=%d plan=%s", status, refunded, planID)
	}
}

func TestAdminRefundInvoiceManualRaceLoserGetsConflict(t *testing.T) {
	f := newBillingFixture(t)
	admin := registerVerified(t, f.q, f.auth, "manual-race@example.com", "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
	invID := "01TESTINVOICE0000013"
	var subID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, currency, period_start, period_end, paid_at
	) VALUES ($1, $2, $3, 'manual', 'UW-TEST-MANUAL-RACE', 'paid', 500000, 500000, 'VND', $4, $4, $4)`,
		invID, f.orgID, subID, now); err != nil {
		t.Fatal(err)
	}
	stale, err := f.q.AdminGetInvoiceByID(f.ctx, invID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE invoices SET status = 'refunded', amount_refunded = amount_paid WHERE id = $1`, invID); err != nil {
		t.Fatal(err)
	}
	_, err = adminSvc.refundInvoiceManual(f.ctx, admin.ID, invID, "hoàn tay thua cuộc", "", stale)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "invoice_not_refundable" || ce.Status != 409 {
		t.Fatalf("loser: %v", err)
	}
}

func TestAdminRefundInvoiceVnpaySecondRefundRefused(t *testing.T) {
	f := newBillingFixture(t)
	admin := registerVerified(t, f.q, f.auth, "vnpay-second@example.com", "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
	invID := "01TESTINVOICE0000009"
	var subID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, amount_refunded, currency, period_start, period_end, paid_at
	) VALUES ($1, $2, $3, 'vnpay', 'UW-TEST-SECOND', 'paid', 1000000, 1000000, 400000, 'VND', $4, $4, $4)`,
		invID, f.orgID, subID, now); err != nil {
		t.Fatal(err)
	}
	_, err := adminSvc.RefundInvoice(f.ctx, admin.ID, invID, "hoàn lần hai trên VNPay", "", "127.0.0.1", 200000)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "invoice_not_refundable" {
		t.Fatalf("second vnpay refund: %v", err)
	}
	var status string
	var refunded int64
	if err := f.pool.QueryRow(f.ctx, `SELECT status, amount_refunded FROM invoices WHERE id = $1`, invID).Scan(&status, &refunded); err != nil {
		t.Fatal(err)
	}
	if status != "paid" || refunded != 400000 {
		t.Fatalf("invoice status=%s refunded=%d", status, refunded)
	}
}

func TestAdminRefundInvoiceRaceLoserGetsConflict(t *testing.T) {
	f := newBillingFixture(t)
	admin := registerVerified(t, f.q, f.auth, "refund-race@example.com", "Platform")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
		t.Fatal(err)
	}
	adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
	invID := "01TESTINVOICE0000006"
	var subID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, currency, period_start, period_end, paid_at
	) VALUES ($1, $2, $3, 'vnpay', 'UW-TEST-RACE', 'paid', 1000000, 1000000, 'VND', $4, $4, $4)`,
		invID, f.orgID, subID, now); err != nil {
		t.Fatal(err)
	}
	stale, err := f.q.AdminGetInvoiceByID(f.ctx, invID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `
		UPDATE invoices
		SET status = 'partial_refund_pending', partial_refund_amount = 200000, refund_requested_at = now()
		WHERE id = $1`, invID); err != nil {
		t.Fatal(err)
	}
	var actionsBefore, auditsBefore int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM admin_actions WHERE target_id = $1`, invID).Scan(&actionsBefore); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE resource_id = $1`, invID).Scan(&auditsBefore); err != nil {
		t.Fatal(err)
	}
	_, err = adminSvc.commitInvoiceRefundPending(f.ctx, admin.ID, invID, "yêu cầu hoàn thua cuộc", "", stale, 200000, true)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "invoice_not_refundable" {
		t.Fatalf("loser: %v", err)
	}
	var actionsAfter, auditsAfter int
	var partial int64
	var status string
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM admin_actions WHERE target_id = $1`, invID).Scan(&actionsAfter); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE resource_id = $1`, invID).Scan(&auditsAfter); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(f.ctx, `SELECT status, partial_refund_amount FROM invoices WHERE id = $1`, invID).Scan(&status, &partial); err != nil {
		t.Fatal(err)
	}
	if actionsAfter != actionsBefore || auditsAfter != auditsBefore {
		t.Fatalf("loser wrote history: actions %d->%d audits %d->%d", actionsBefore, actionsAfter, auditsBefore, auditsAfter)
	}
	if status != "partial_refund_pending" || partial != 200000 {
		t.Fatalf("winner changed: status=%s partial=%d", status, partial)
	}
}

func TestAdminRefundInvoiceVnpay(t *testing.T) {
	const secret = "testsecret"
	const reason = "hoan hoa don vnpay da thanh toan"
	cases := []struct {
		name        string
		queryStatus string
		refundCode  string
		amount      int64
		wantErr     string
		wantStatus  string
		wantRefunds int
		wantType    string
		wantRef     bool
		wantAudit   bool
	}{
		{name: "accepted", queryStatus: "00", refundCode: "00", wantStatus: "refund_pending", wantRefunds: 1, wantType: "02", wantRef: true, wantAudit: true},
		{name: "rejected", queryStatus: "00", refundCode: "91", wantErr: "vnpay_refund_failed", wantStatus: "paid", wantRefunds: 1},
		{name: "processing", queryStatus: "00", refundCode: "94", wantStatus: "refund_pending", wantRefunds: 1, wantType: "02", wantRef: true},
		{name: "original not paid", queryStatus: "02", wantErr: "vnpay_refund_failed", wantStatus: "paid"},
		{name: "partial", queryStatus: "00", refundCode: "00", amount: 100000, wantStatus: "partial_refund_pending", wantRefunds: 1, wantType: "03", wantRef: true},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var refunds int
			var refundType string
			txn := fmt.Sprintf("01TESTVNPAYREF%04d", i)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req map[string]string
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					t.Errorf("decode: %v", err)
					return
				}
				if req["vnp_Command"] == "refund" {
					refunds++
					refundType = req["vnp_TransactionType"]
					resp := map[string]string{
						"vnp_ResponseId": "VNPREF1", "vnp_Command": "refund", "vnp_ResponseCode": tc.refundCode,
						"vnp_Message": "msg", "vnp_TmnCode": "TMNTEST1", "vnp_TxnRef": txn,
						"vnp_Amount": req["vnp_Amount"], "vnp_BankCode": "NCB", "vnp_PayDate": "20261008120000",
						"vnp_TransactionNo": "14312345", "vnp_TransactionType": req["vnp_TransactionType"],
						"vnp_TransactionStatus": "00", "vnp_OrderInfo": req["vnp_OrderInfo"],
					}
					resp["vnp_SecureHash"] = billing.SignRefundResponseForTest(resp, secret)
					_ = json.NewEncoder(w).Encode(resp)
					return
				}
				resp := map[string]string{
					"vnp_ResponseId": "VNPQ1", "vnp_Command": "querydr", "vnp_ResponseCode": "00",
					"vnp_Message": "Success", "vnp_TmnCode": "TMNTEST1", "vnp_TxnRef": txn,
					"vnp_Amount": "49900000", "vnp_BankCode": "NCB", "vnp_PayDate": "20261008120000",
					"vnp_TransactionNo": "14312345", "vnp_TransactionType": "01",
					"vnp_TransactionStatus": tc.queryStatus, "vnp_OrderInfo": "UniWork billing",
				}
				resp["vnp_SecureHash"] = billing.SignQueryDRResponseForTest(resp, secret)
				_ = json.NewEncoder(w).Encode(resp)
			}))
			defer srv.Close()

			f := newBillingFixture(t)
			vnp, err := billing.NewVNPay(billing.VNPayConfig{TMNCode: "TMNTEST1", HashSecret: secret, QueryURL: srv.URL})
			if err != nil {
				t.Fatal(err)
			}
			f.billing = NewBillingService(f.pool, f.q, f.orgs, vnp)
			admin := registerVerified(t, f.q, f.auth, fmt.Sprintf("vnpay-refund-%d@example.com", i), "Platform")
			if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, admin.ID); err != nil {
				t.Fatal(err)
			}
			adminSvc := NewAdminService(f.pool, f.q, f.billing, f.ent)
			var subID, planID string
			if err := f.pool.QueryRow(f.ctx, `SELECT id, plan_id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID, &planID); err != nil {
				t.Fatal(err)
			}
			invID := fmt.Sprintf("01TESTVNPAYINV%04d", i)
			if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
				id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
				amount, currency, status, expires_at, completed_at
			) VALUES ($1, $2, $3, $4, 'vnpay', $1, 499000, 'VND', 'completed', now() + interval '1 hour', now())`,
				txn, f.orgID, subID, planID); err != nil {
				t.Fatal(err)
			}
			now := time.Now().UTC()
			if _, err := f.pool.Exec(f.ctx, `INSERT INTO invoices (
				id, organization_id, subscription_id, provider, number, status,
				amount_due, amount_paid, currency, period_start, period_end, paid_at, payment_intent_id
			) VALUES ($1, $2, $3, 'vnpay', $4, 'paid', 499000, 499000, 'VND', $5, $5, $5, $6)`,
				invID, f.orgID, subID, fmt.Sprintf("UW-VNP-%d", i), now, txn); err != nil {
				t.Fatal(err)
			}

			_, err = adminSvc.RefundInvoice(f.ctx, admin.ID, invID, reason, "", "127.0.0.1", tc.amount)
			if tc.wantErr != "" {
				var ce CodedError
				if !errors.As(err, &ce) || ce.Code != tc.wantErr {
					t.Fatalf("RefundInvoice = %v", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			var status, ref string
			if err := f.pool.QueryRow(f.ctx, `SELECT status, COALESCE(refund_provider_ref, '') FROM invoices WHERE id = $1`, invID).Scan(&status, &ref); err != nil {
				t.Fatal(err)
			}
			if status != tc.wantStatus {
				t.Fatalf("status = %s, want %s", status, tc.wantStatus)
			}
			if refunds != tc.wantRefunds {
				t.Fatalf("refund calls = %d, want %d", refunds, tc.wantRefunds)
			}
			if tc.wantType != "" && refundType != tc.wantType {
				t.Fatalf("vnp_TransactionType = %s, want %s", refundType, tc.wantType)
			}
			if tc.wantRef && ref != "14312345" {
				t.Fatalf("refund_provider_ref = %q", ref)
			}
			if tc.wantAudit {
				var n int
				if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->>'refund_phase' = 'pending'`, audit.ActionBillingInvoiceRefunded, invID).Scan(&n); err != nil || n != 1 {
					t.Fatalf("pending audit rows = %d err=%v", n, err)
				}
			}
		})
	}
}
