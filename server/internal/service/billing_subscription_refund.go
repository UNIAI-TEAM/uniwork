package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func invoiceFullyRefunded(inv db.Invoice) bool {
	return inv.Status == "refunded" && inv.AmountPaid > 0 && inv.AmountRefunded >= inv.AmountPaid
}

// revertSubscriptionAfterFullInvoiceRefund moves the org to the default plan when a paid invoice is fully refunded.
func (s *BillingService) revertSubscriptionAfterFullInvoiceRefund(ctx context.Context, q *db.Queries, inv db.Invoice, actor Actor, kind string) error {
	if !invoiceFullyRefunded(inv) {
		return nil
	}
	defaultPlan, err := q.GetDefaultPlan(ctx)
	if err != nil {
		return err
	}
	locked, err := q.LockLiveSubscription(ctx, inv.OrganizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if locked.ID != inv.SubscriptionID {
		return nil
	}
	if locked.PlanID == defaultPlan.ID {
		return nil
	}
	before, err := q.GetPlanByID(ctx, locked.PlanID)
	if err != nil {
		return err
	}
	after, err := q.RevertSubscriptionToDefaultAfterInvoiceRefund(ctx, db.RevertSubscriptionToDefaultAfterInvoiceRefundParams{
		ID: locked.ID, OrganizationID: locked.OrganizationID, PlanID: defaultPlan.ID,
		UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	metaBefore := map[string]any{"plan_code": before.Code, "invoice_id": inv.ID, "invoice_number": inv.Number}
	metaAfter := map[string]any{"plan_code": defaultPlan.Code, "invoice_refund": true}
	if kind != "" {
		metaAfter["source"] = kind
	}
	return s.recordChange(ctx, q, actor, after, kind, metaBefore, metaAfter)
}
