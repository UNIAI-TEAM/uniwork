package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	billingLapseInterval = time.Minute
	billingLapseBatch    = int32(50)
)

// ProcessSubscriptionLapse applies scheduled cancel-at-period-end and marks
// unpaid paid plans past_due after current_period_end (C-04 §6.10, B3).
func (s *BillingService) ProcessSubscriptionLapse(ctx context.Context) error {
	defaultPlan, err := s.q.GetDefaultPlan(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := s.processCancelLapseBatches(ctx, defaultPlan); err != nil {
		return err
	}
	return s.processPastDueBatches(ctx)
}

func (s *BillingService) processCancelLapseBatches(ctx context.Context, defaultPlan db.Plan) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		dueCancel, err := s.q.ListSubscriptionsDueForCancelLapse(ctx, billingLapseBatch)
		if err != nil {
			return err
		}
		if len(dueCancel) == 0 {
			return nil
		}
		for _, sub := range dueCancel {
			if err := s.lapseCancelToDefault(ctx, sub, defaultPlan); err != nil {
				s.billingLogWarn("billing lapse cancel", err, "organization_id", sub.OrganizationID, "subscription_id", sub.ID)
			}
		}
		if len(dueCancel) < int(billingLapseBatch) {
			return nil
		}
	}
}

func (s *BillingService) processPastDueBatches(ctx context.Context) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		duePastDue, err := s.q.ListSubscriptionsDueForPastDue(ctx, billingLapseBatch)
		if err != nil {
			return err
		}
		if len(duePastDue) == 0 {
			return nil
		}
		for _, sub := range duePastDue {
			if err := s.markPastDue(ctx, sub); err != nil {
				s.billingLogWarn("billing lapse past_due", err, "organization_id", sub.OrganizationID, "subscription_id", sub.ID)
			}
		}
		if len(duePastDue) < int(billingLapseBatch) {
			return nil
		}
	}
}

func (s *BillingService) lapseCancelToDefault(ctx context.Context, sub db.Subscription, defaultPlan db.Plan) error {
	now := time.Now().UTC()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	locked, err := q.LockLiveSubscription(ctx, sub.OrganizationID)
	if err != nil {
		return err
	}
	if locked.ID != sub.ID || !locked.CancelAt.Valid || locked.CancelAt.Time.After(now) {
		return nil
	}
	before, err := q.GetPlanByID(ctx, locked.PlanID)
	if err != nil {
		return err
	}
	actor := audit.System("billing")
	after, err := q.RevertSubscriptionToDefaultAtCancel(ctx, db.RevertSubscriptionToDefaultAtCancelParams{
		ID: locked.ID, OrganizationID: locked.OrganizationID, PlanID: defaultPlan.ID,
		UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := s.recordChange(ctx, q, actor, after, "lapse_cancel",
		map[string]any{"plan_code": before.Code, "cancel_at": audit.Text(locked.CancelAt.Valid, locked.CancelAt.Time.Format(time.RFC3339))},
		map[string]any{"plan_code": defaultPlan.Code}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *BillingService) markPastDue(ctx context.Context, sub db.Subscription) error {
	now := time.Now().UTC()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	locked, err := q.LockLiveSubscription(ctx, sub.OrganizationID)
	if err != nil {
		return err
	}
	if locked.ID != sub.ID || locked.Status != "active" || locked.CancelAt.Valid {
		return nil
	}
	if !locked.CurrentPeriodEnd.Valid || !locked.CurrentPeriodEnd.Time.Before(now) {
		return nil
	}
	plan, err := q.GetPlanByID(ctx, locked.PlanID)
	if err != nil {
		return err
	}
	if !plan.PriceAmount.Valid || plan.PriceAmount.Int64 <= 0 {
		return nil
	}
	actor := audit.System("billing")
	after, err := q.MarkSubscriptionPastDue(ctx, db.MarkSubscriptionPastDueParams{
		ID: locked.ID, OrganizationID: locked.OrganizationID,
		UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := s.recordChange(ctx, q, actor, after, "past_due",
		map[string]any{"status": "active", "plan_code": plan.Code},
		map[string]any{"status": "past_due", "plan_code": plan.Code}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
