package service

import (
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
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
