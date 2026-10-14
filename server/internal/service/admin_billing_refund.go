package service

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// RefundInvoice starts a full or partial refund (manual: marks refunded; VNPay: API then refund_pending).
func (s *AdminService) RefundInvoice(ctx context.Context, adminID, invoiceID, reason, providerRef, clientIP string, refundAmount int64) (db.Invoice, error) {
	if err := checkReason(reason); err != nil {
		return db.Invoice{}, err
	}
	inv, err := s.q.AdminGetInvoiceByID(ctx, invoiceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Invoice{}, ErrNotFound
	}
	if err != nil {
		return db.Invoice{}, err
	}
	if inv.Status != "paid" {
		return db.Invoice{}, CodedError{Code: "invoice_not_refundable", Status: http.StatusConflict,
			Msg: "chỉ hóa đơn đã thanh toán mới hoàn được"}
	}
	refundable := inv.AmountPaid - inv.AmountRefunded
	if refundable <= 0 {
		return db.Invoice{}, CodedError{Code: "invoice_not_refundable", Status: http.StatusConflict,
			Msg: "số tiền còn lại trên hóa đơn không còn để hoàn"}
	}
	amount := refundAmount
	if amount <= 0 {
		amount = refundable
	}
	if amount <= 0 || amount > refundable {
		return db.Invoice{}, CodedError{Code: "invalid_refund_amount", Status: http.StatusBadRequest,
			Msg: "số tiền hoàn không hợp lệ"}
	}
	partial := amount < refundable
	providerRef = strings.TrimSpace(providerRef)
	if inv.Provider == "vnpay" && inv.AmountRefunded > 0 {
		return db.Invoice{}, CodedError{Code: "invoice_not_refundable", Status: http.StatusConflict,
			Msg: "hóa đơn VNPay đã hoàn một lần — phần còn lại hoàn thủ công"}
	}

	switch inv.Provider {
	case "manual":
		if partial {
			return db.Invoice{}, CodedError{Code: "invalid_refund_amount", Status: http.StatusBadRequest,
				Msg: "hóa đơn thanh toán thủ công chỉ hoàn được toàn bộ"}
		}
		return s.refundInvoiceManual(ctx, adminID, invoiceID, reason, providerRef, inv)
	case "vnpay":
		return s.refundInvoiceVnpay(ctx, adminID, invoiceID, reason, providerRef, clientIP, inv, amount, partial)
	default:
		return db.Invoice{}, CodedError{Code: "invoice_not_refundable", Status: http.StatusConflict,
			Msg: "cổng thanh toán không hỗ trợ hoàn tiền tự động"}
	}
}

func (s *AdminService) refundInvoiceManual(
	ctx context.Context,
	adminID, invoiceID, reason, providerRef string,
	inv db.AdminGetInvoiceByIDRow,
) (db.Invoice, error) {
	ctx, traceID := ensureTrace(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Invoice{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	beforeMap := map[string]any{"status": inv.Status, "number": inv.Number, "amount_paid": inv.AmountPaid}
	after, err := q.AdminMarkInvoiceRefunded(ctx, db.AdminMarkInvoiceRefundedParams{
		ID: invoiceID, RefundProviderRef: nullTextOptional(providerRef), RefundReason: textRequired(reason),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Invoice{}, CodedError{Code: "invoice_not_refundable", Status: http.StatusConflict,
			Msg: "trạng thái hóa đơn đã đổi — tải lại danh sách"}
	}
	if err != nil {
		return db.Invoice{}, err
	}
	afterMap := map[string]any{"status": after.Status, "number": after.Number, "amount_paid": after.AmountPaid}
	if err := s.recordAdmin(ctx, q, traceID, adminID, audit.ActionBillingInvoiceRefunded, "invoice", invoiceID, beforeMap, afterMap, reason); err != nil {
		return db.Invoice{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: inv.OrganizationID,
		Actor:          audit.User(adminID),
		Action:         audit.ActionBillingInvoiceRefunded,
		ResourceType:   "invoice", ResourceID: invoiceID,
		Changes:  audit.Diff(beforeMap, afterMap),
		Metadata: map[string]any{"reason": reason, "platform_admin": true, "provider": inv.Provider},
	}); err != nil {
		return db.Invoice{}, err
	}
	if err := s.billing.revertSubscriptionAfterFullInvoiceRefund(ctx, q, after, Human(adminID), "invoice_refund"); err != nil {
		return db.Invoice{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Invoice{}, err
	}
	return after, nil
}

// ConfirmInvoiceRefund marks refund_pending / partial_refund_pending as refunded after merchant approval.
func (s *AdminService) ConfirmInvoiceRefund(ctx context.Context, adminID, invoiceID, reason string) (db.Invoice, error) {
	if err := checkReason(reason); err != nil {
		return db.Invoice{}, err
	}
	inv, err := s.q.AdminGetInvoiceByID(ctx, invoiceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Invoice{}, ErrNotFound
	}
	if err != nil {
		return db.Invoice{}, err
	}
	if inv.Status != "refund_pending" && inv.Status != "partial_refund_pending" {
		return db.Invoice{}, CodedError{Code: "invoice_not_refundable", Status: http.StatusConflict,
			Msg: "hóa đơn không ở trạng thái chờ xác nhận hoàn tiền"}
	}

	ctx, traceID := ensureTrace(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Invoice{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	beforeMap := map[string]any{"status": inv.Status, "number": inv.Number, "amount_paid": inv.AmountPaid}
	after, err := q.AdminConfirmInvoiceRefund(ctx, db.AdminConfirmInvoiceRefundParams{
		ID: invoiceID, RefundConfirmReason: textRequired(reason),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Invoice{}, CodedError{Code: "invoice_not_refundable", Status: http.StatusConflict,
			Msg: "trạng thái hóa đơn đã đổi — tải lại danh sách"}
	}
	if err != nil {
		return db.Invoice{}, err
	}
	afterMap := map[string]any{"status": after.Status, "number": after.Number, "amount_paid": after.AmountPaid, "amount_refunded": after.AmountRefunded}
	if err := s.recordAdmin(ctx, q, traceID, adminID, audit.ActionBillingInvoiceRefunded, "invoice", invoiceID, beforeMap, afterMap, reason); err != nil {
		return db.Invoice{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: inv.OrganizationID,
		Actor:          audit.User(adminID),
		Action:         audit.ActionBillingInvoiceRefunded,
		ResourceType:   "invoice", ResourceID: invoiceID,
		Changes:  audit.Diff(beforeMap, afterMap),
		Metadata: map[string]any{"reason": reason, "platform_admin": true, "confirm_refund": true},
	}); err != nil {
		return db.Invoice{}, err
	}
	if err := s.billing.revertSubscriptionAfterFullInvoiceRefund(ctx, q, after, Human(adminID), "invoice_refund_confirm"); err != nil {
		return db.Invoice{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Invoice{}, err
	}
	return after, nil
}

func textRequired(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: true}
}

func nullTextOptional(s string) pgtype.Text {
	s = strings.TrimSpace(s)
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}
