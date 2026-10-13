package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/billing"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const billingStaleIntentReconcileBatch = int32(20)

// ProcessStalePaymentIntentReconcile asks VNPay about checkouts that never
// received a usable IPN. A paid result goes through ApplyProviderEvent, so an
// expired intent follows the same rule as a live IPN. An unpaid result is
// marked failed and leaves the scan. A QueryDr error stays pending and is
// tried again after the lease.
func (s *BillingService) ProcessStalePaymentIntentReconcile(ctx context.Context) error {
	vnp, ok := s.provider.(*billing.VNPay)
	if !ok {
		return nil
	}
	rows, err := s.q.ClaimStaleBillingPaymentIntentsForReconcile(ctx, billingStaleIntentReconcileBatch)
	if err != nil {
		return err
	}
	for _, intent := range rows {
		if err := ctx.Err(); err != nil {
			return err
		}
		s.reconcileOneStalePaymentIntent(ctx, vnp, intent)
	}
	return nil
}

func (s *BillingService) reconcileOneStalePaymentIntent(ctx context.Context, vnp *billing.VNPay, intent db.BillingPaymentIntent) {
	ev, err := s.vnpayQueryDR(ctx, vnp, intent, "")
	if err != nil {
		s.billingLogWarn("billing intent reconcile querydr", err, "intent_id", intent.ID)
		return
	}
	if ev.Paid {
		if err := s.ApplyProviderEvent(ctx, ev); err != nil {
			s.billingLogWarn("billing intent reconcile apply", err, "intent_id", intent.ID, "amount", intent.Amount)
		}
		return
	}
	if err := s.q.MarkBillingPaymentIntentFailed(ctx, db.MarkBillingPaymentIntentFailedParams{
		ID: intent.ID, OrganizationID: intent.OrganizationID,
	}); err != nil {
		s.billingLogWarn("billing intent reconcile fail", err, "intent_id", intent.ID)
	}
}
