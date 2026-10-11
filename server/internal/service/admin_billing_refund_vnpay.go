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

func mergeRefundProviderRef(adminRef, gatewayRef string) string {
	adminRef = strings.TrimSpace(adminRef)
	gatewayRef = strings.TrimSpace(gatewayRef)
	if adminRef == "" {
		return gatewayRef
	}
	if gatewayRef == "" || adminRef == gatewayRef {
		return adminRef
	}
	return adminRef + ";" + gatewayRef
}

// refundInvoiceVnpay writes refund_pending first, then calls VNPay (no HTTP inside DB tx).
func (s *AdminService) refundInvoiceVnpay(
	ctx context.Context,
	adminID, invoiceID, reason, providerRef, clientIP string,
	inv db.AdminGetInvoiceByIDRow,
	amount int64,
	partial bool,
) (db.Invoice, error) {
	after, err := s.commitInvoiceRefundPending(ctx, adminID, invoiceID, reason, providerRef, inv, amount, partial)
	if err != nil {
		return db.Invoice{}, err
	}
	invNow, err := s.q.AdminGetInvoiceByID(ctx, invoiceID)
	if err != nil {
		return db.Invoice{}, err
	}
	gatewayRef, pErr := s.billing.RefundInvoiceOnProvider(ctx, adminID, invNow, amount, reason, clientIP)
	if pErr != nil {
		_, _ = s.q.AdminRevertInvoiceRefundRequest(ctx, invoiceID)
		return db.Invoice{}, pErr
	}
	ref := mergeRefundProviderRef(providerRef, gatewayRef)
	if ref == "" {
		return after, nil
	}
	patched, err := s.q.AdminPatchInvoiceRefundProviderRef(ctx, db.AdminPatchInvoiceRefundProviderRefParams{
		ID: invoiceID, RefundProviderRef: nullTextOptional(ref),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return after, nil
	}
	if err != nil {
		return db.Invoice{}, err
	}
	return patched, nil
}

func (s *AdminService) commitInvoiceRefundPending(
	ctx context.Context,
	adminID, invoiceID, reason, providerRef string,
	inv db.AdminGetInvoiceByIDRow,
	amount int64,
	partial bool,
) (db.Invoice, error) {
	ctx, traceID := ensureTrace(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Invoice{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	beforeMap := map[string]any{"status": inv.Status, "number": inv.Number, "amount_paid": inv.AmountPaid}
	var after db.Invoice
	if partial {
		after, err = q.AdminRequestPartialInvoiceRefund(ctx, db.AdminRequestPartialInvoiceRefundParams{
			ID: invoiceID, PartialRefundAmount: pgtype.Int8{Int64: amount, Valid: true},
			RefundProviderRef: nullTextOptional(providerRef), RefundReason: textRequired(reason),
		})
	} else {
		after, err = q.AdminRequestInvoiceRefund(ctx, db.AdminRequestInvoiceRefundParams{
			ID: invoiceID, RefundProviderRef: nullTextOptional(providerRef), RefundReason: textRequired(reason),
		})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		after, err = s.adminInvoiceAfterPendingRace(ctx, q, invoiceID, partial)
	}
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
		Metadata: map[string]any{"reason": reason, "platform_admin": true, "provider": inv.Provider, "refund_phase": "pending"},
	}); err != nil {
		return db.Invoice{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Invoice{}, err
	}
	return after, nil
}
