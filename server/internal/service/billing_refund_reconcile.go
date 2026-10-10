package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/billing"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	billingRefundReconcileBatch    = int32(20)
	billingRefundReconcileInterval = 2 * time.Minute
)

// ProcessRefundPendingReconcile polls VNPay QueryDr for invoices in refund_pending and
// marks them refunded when the gateway reports reversal (C-04 refund merchant approval).
func (s *BillingService) ProcessRefundPendingReconcile(ctx context.Context) error {
	vnp, ok := s.provider.(*billing.VNPay)
	if !ok {
		return nil
	}
	rows, err := s.q.ListInvoicesRefundPendingForReconcile(ctx, billingRefundReconcileBatch)
	if err != nil {
		return err
	}
	for _, inv := range rows {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := s.reconcileOneRefundPending(ctx, vnp, inv); err != nil {
			s.billingLogWarn("billing refund reconcile", err, "invoice_id", inv.ID, "organization_id", inv.OrganizationID)
		}
	}
	return nil
}

func (s *BillingService) reconcileOneRefundPending(ctx context.Context, vnp *billing.VNPay, inv db.ListInvoicesRefundPendingForReconcileRow) error {
	intent, err := s.paymentIntentForInvoice(ctx, s.q, invoiceIntentLookupFromReconcileRow(inv))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	ev, err := s.vnpayQueryDR(ctx, vnp, intent, "")
	if err != nil {
		return err
	}
	if !billing.QueryDRRefundSettled(ev.RawParams) {
		return nil
	}
	return s.confirmInvoiceRefundFromProvider(ctx, inv.ID, inv.OrganizationID, inv.Number, inv.AmountPaid, inv.Status)
}

func (s *BillingService) confirmInvoiceRefundFromProvider(ctx context.Context, invoiceID, orgID, number string, amountPaid int64, beforeStatus string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	after, err := q.ConfirmInvoiceRefundFromProvider(ctx, db.ConfirmInvoiceRefundFromProviderParams{
		ID: invoiceID, OrganizationID: orgID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	actor := audit.System("billing.vnpay_reconcile")
	beforeMap := map[string]any{"status": beforeStatus, "number": number, "amount_paid": amountPaid}
	afterMap := map[string]any{
		"status": after.Status, "number": after.Number, "amount_paid": after.AmountPaid,
		"amount_refunded": after.AmountRefunded,
	}
	meta := map[string]any{"vnpay_reconcile": true, "source": "querydr"}
	if beforeStatus == "partial_refund_pending" {
		meta["partial_refund"] = true
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          actor,
		Action:         audit.ActionBillingInvoiceRefunded,
		ResourceType:   "invoice", ResourceID: invoiceID,
		Changes:  audit.Diff(beforeMap, afterMap),
		Metadata: meta,
	}); err != nil {
		return err
	}
	if err := s.revertSubscriptionAfterFullInvoiceRefund(ctx, q, after, actor, "vnpay_reconcile"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
