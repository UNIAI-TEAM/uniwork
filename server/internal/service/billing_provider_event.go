package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/billing"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ParseProviderWebhook verifies the configured provider and normalises the request.
func (s *BillingService) ParseProviderWebhook(r *http.Request) (billing.Event, error) {
	return s.provider.ParseWebhook(r)
}

// HandleProviderWebhook applies a provider callback synchronously (S1). Returns
// whether the gateway should acknowledge success (VNPay RspCode=00).
func (s *BillingService) HandleProviderWebhook(ctx context.Context, ev billing.Event, payload []byte) (bool, error) {
	if ev.ProviderEventID == "" {
		return false, errors.New("billing: missing provider_event_id")
	}
	inboxID := util.NewID()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	n, err := q.InsertWebhookInbox(ctx, db.InsertWebhookInboxParams{
		ID: inboxID, Provider: s.provider.Name(), ProviderEventID: ev.ProviderEventID,
		EventType: ev.Type, Payload: string(payload),
	})
	if err != nil {
		return false, err
	}
	// Duplicate IPN: inbox row already committed from a successful apply.
	if n == 0 {
		return true, nil
	}
	if err := s.applyProviderEvent(ctx, q, ev); err != nil {
		return false, err
	}
	if err := q.MarkWebhookInboxDone(ctx, inboxID); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

// ApplyProviderEvent is the idempotent writer path (worker or tests).
func (s *BillingService) ApplyProviderEvent(ctx context.Context, ev billing.Event) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := s.applyProviderEvent(ctx, s.q.WithTx(tx), ev); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *BillingService) applyProviderEvent(ctx context.Context, q *db.Queries, ev billing.Event) error {
	if ev.ProviderTxnRef == "" {
		return errors.New("billing: missing provider txn ref")
	}
	intent, err := q.GetBillingPaymentIntentByTxnRef(ctx, ev.ProviderTxnRef)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("billing: unknown txn ref %q", ev.ProviderTxnRef)
	}
	if err != nil {
		return err
	}
	if !ev.Paid {
		if intent.Status == "pending" {
			_ = q.MarkBillingPaymentIntentFailed(ctx, db.MarkBillingPaymentIntentFailedParams{
				ID: intent.ID, OrganizationID: intent.OrganizationID,
			})
		}
		return nil
	}
	if intent.Status == "completed" {
		return nil
	}
	if intent.Status == "expired" {
		if time.Since(intent.ExpiresAt.Time) > billingExpiredGrace {
			return fmt.Errorf("billing: intent expired beyond grace")
		}
	}
	if ev.Amount > 0 && ev.Amount != intent.Amount {
		_ = q.MarkBillingPaymentIntentFailed(ctx, db.MarkBillingPaymentIntentFailedParams{
			ID: intent.ID, OrganizationID: intent.OrganizationID,
		})
		return fmt.Errorf("billing: amount mismatch")
	}
	if ev.Currency != "" && ev.Currency != intent.Currency {
		return fmt.Errorf("billing: currency mismatch")
	}

	plan, err := q.GetPlanByID(ctx, intent.PlanID)
	if err != nil {
		return err
	}
	sub, err := q.LockLiveSubscription(ctx, intent.OrganizationID)
	if err != nil {
		return err
	}
	start := time.Now().UTC()
	periodEnd := subscriptionPeriodEnd(start, plan.BillingPeriod)
	actor := audit.System("billing")
	beforePlan, err := q.GetPlanByID(ctx, sub.PlanID)
	if err != nil {
		return err
	}
	after, err := q.ApplyPaidSubscriptionFromProvider(ctx, db.ApplyPaidSubscriptionFromProviderParams{
		ID: sub.ID, OrganizationID: intent.OrganizationID, PlanID: intent.PlanID,
		Provider:           s.provider.Name(),
		CurrentPeriodStart: pgtype.Timestamptz{Time: start, Valid: true},
		CurrentPeriodEnd:   periodEnd,
		UpdatedBy:          actor.ID, UpdatedByKind: string(actor.Kind),
	})
	if err != nil {
		return err
	}
	if _, err := q.MarkBillingPaymentIntentCompleted(ctx, db.MarkBillingPaymentIntentCompletedParams{
		ID: intent.ID, OrganizationID: intent.OrganizationID,
	}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	invID := util.NewID()
	providerInvID := ev.ProviderEventID
	if ev.Invoice != nil && ev.Invoice.ProviderInvoiceID != "" {
		providerInvID = ev.Invoice.ProviderInvoiceID
	}
	var initiatedBy, initiatedKind pgtype.Text
	if intent.CreatedBy.Valid {
		initiatedBy = intent.CreatedBy
		initiatedKind = intent.CreatedByKind
	}
	_, err = q.InsertInvoice(ctx, db.InsertInvoiceParams{
		ID: invID, OrganizationID: intent.OrganizationID, SubscriptionID: sub.ID,
		Provider: s.provider.Name(), ProviderInvoiceID: pgtype.Text{String: providerInvID, Valid: providerInvID != ""},
		Number: invoiceNumber(start), AmountDue: intent.Amount, AmountPaid: intent.Amount, Currency: intent.Currency,
		PeriodStart: pgtype.Timestamptz{Time: start, Valid: true}, PeriodEnd: periodEnd,
		InitiatedBy: initiatedBy, InitiatedByKind: initiatedKind,
	})
	if err != nil {
		return err
	}
	return s.recordChange(ctx, q, actor, after, "provider_paid",
		map[string]any{"plan_code": beforePlan.Code},
		map[string]any{"plan_code": plan.Code, "provider_event_id": ev.ProviderEventID})
}

func subscriptionPeriodEnd(start time.Time, billingPeriod string) pgtype.Timestamptz {
	var end time.Time
	switch billingPeriod {
	case "year":
		end = start.AddDate(1, 0, 0)
	case "month":
		end = start.AddDate(0, 1, 0)
	default:
		end = start.AddDate(0, 1, 0)
	}
	return pgtype.Timestamptz{Time: end, Valid: true}
}

func invoiceNumber(at time.Time) string {
	return fmt.Sprintf("UW-%d-%s", at.Year(), util.NewID()[:8])
}

// ProviderWebhookPayloadJSON serialises raw provider params for webhook_inbox.
func ProviderWebhookPayloadJSON(ev billing.Event) ([]byte, error) {
	if len(ev.RawParams) > 0 {
		return json.Marshal(ev.RawParams)
	}
	return json.Marshal(ev)
}
