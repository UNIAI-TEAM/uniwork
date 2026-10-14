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

// VNPay IPN acknowledgement codes (merchant response, HTTP 200 JSON).
const (
	vnpayIPNConfirmed     = "00"
	vnpayIPNOrderNotFound = "01"
	vnpayIPNAlreadyDone   = "02"
	vnpayIPNBadAmount     = "04"
	vnpayIPNUnknown       = "99"
)

var (
	errUnknownTxnRef          = errors.New("billing: unknown txn ref")
	errIntentAlreadyCompleted = errors.New("billing: intent already completed")
	errAmountMismatch         = errors.New("billing: amount mismatch")
	errCurrencyMismatch       = errors.New("billing: currency mismatch")
)

// HandleProviderWebhook applies a provider callback synchronously (S1).
// The string is the VNPay RspCode the handler writes back.
func (s *BillingService) HandleProviderWebhook(ctx context.Context, ev billing.Event, payload []byte) (string, error) {
	if ev.ProviderEventID == "" {
		return vnpayIPNUnknown, errors.New("billing: missing provider_event_id")
	}
	inboxID := util.NewID()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return vnpayIPNUnknown, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	n, err := q.InsertWebhookInbox(ctx, db.InsertWebhookInboxParams{
		ID: inboxID, Provider: s.provider.Name(), ProviderEventID: ev.ProviderEventID,
		EventType: ev.Type, Payload: string(payload),
	})
	if err != nil {
		return vnpayIPNUnknown, err
	}
	ack := func(code string) (string, error) {
		if err := q.MarkWebhookInboxDone(ctx, inboxID); err != nil {
			return vnpayIPNUnknown, err
		}
		if err := tx.Commit(ctx); err != nil {
			return vnpayIPNUnknown, err
		}
		return code, nil
	}
	// Duplicate IPN: the row was already committed, either applied or queued for the worker.
	if n == 0 {
		return vnpayIPNAlreadyDone, nil
	}
	if err := s.applyProviderEvent(ctx, q, ev); err != nil {
		if errors.Is(err, errUnknownTxnRef) {
			// Roll the inbox back so a retry stays 01. A stored row would look like a duplicate (02).
			return vnpayIPNOrderNotFound, nil
		}
		if errors.Is(err, errIntentAlreadyCompleted) {
			return ack(vnpayIPNAlreadyDone)
		}
		var term intentTerminalErr
		if !errors.As(err, &term) {
			// Keep the payload outside the rolled-back transaction so the worker
			// can retry and dead-letter it. Unknown txn refs stay unstored above.
			_ = tx.Rollback(ctx)
			if _, qerr := s.q.InsertWebhookInbox(ctx, db.InsertWebhookInboxParams{
				ID: inboxID, Provider: s.provider.Name(), ProviderEventID: ev.ProviderEventID,
				EventType: ev.Type, Payload: string(payload),
			}); qerr != nil {
				return vnpayIPNUnknown, errors.Join(err, qerr)
			}
			s.billingLogWarn("billing webhook queued for retry", err, "provider_event_id", ev.ProviderEventID)
			return vnpayIPNConfirmed, nil
		}
		// Amount or currency mismatch is 04. Quota and other terminal
		// failures stay 00; UNI-1272 owns the quota reply.
		if errors.Is(term.cause, errAmountMismatch) || errors.Is(term.cause, errCurrencyMismatch) {
			return ack(vnpayIPNBadAmount)
		}
		return ack(vnpayIPNConfirmed)
	}
	return ack(vnpayIPNConfirmed)
}

// intentTerminalErr marks a provider-event failure whose side effects (typically
// billing_payment_intents → failed) must commit even though the call returns error.
type intentTerminalErr struct{ cause error }

func (e intentTerminalErr) Error() string { return e.cause.Error() }
func (e intentTerminalErr) Unwrap() error { return e.cause }

// ApplyProviderEvent is the idempotent writer path (worker or tests).
func (s *BillingService) ApplyProviderEvent(ctx context.Context, ev billing.Event) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	err = s.applyProviderEvent(ctx, s.q.WithTx(tx), ev)
	if err != nil {
		if errors.Is(err, errIntentAlreadyCompleted) {
			return tx.Commit(ctx)
		}
		var term intentTerminalErr
		if errors.As(err, &term) {
			if commitErr := tx.Commit(ctx); commitErr != nil {
				_ = tx.Rollback(ctx)
				return errors.Join(term.cause, commitErr)
			}
			return term.cause
		}
		_ = tx.Rollback(ctx)
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
		return errUnknownTxnRef
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
		if err := s.patchIntentProviderMeta(ctx, q, intent, ev); err != nil {
			return err
		}
		return errIntentAlreadyCompleted
	}
	// expired stays payable: the VNPay URL has no expiry, so a superseded
	// checkout can still be paid. Amount and quota checks below still apply.
	if intent.Status != "pending" && intent.Status != "failed" && intent.Status != "expired" {
		return fmt.Errorf("billing: intent %q not payable (status=%s)", intent.ID, intent.Status)
	}
	if ev.Amount != intent.Amount {
		_ = q.MarkBillingPaymentIntentFailed(ctx, db.MarkBillingPaymentIntentFailedParams{
			ID: intent.ID, OrganizationID: intent.OrganizationID,
		})
		return intentTerminalErr{cause: errAmountMismatch}
	}
	if ev.Currency != "" && ev.Currency != intent.Currency {
		_ = q.MarkBillingPaymentIntentFailed(ctx, db.MarkBillingPaymentIntentFailedParams{
			ID: intent.ID, OrganizationID: intent.OrganizationID,
		})
		return intentTerminalErr{cause: errCurrencyMismatch}
	}

	plan, err := q.GetPlanByID(ctx, intent.PlanID)
	if err != nil {
		return err
	}
	sub, err := q.LockLiveSubscription(ctx, intent.OrganizationID)
	if err != nil {
		return err
	}
	if err := s.fitsUnder(ctx, q, sub, plan); err != nil {
		_ = q.MarkBillingPaymentIntentFailed(ctx, db.MarkBillingPaymentIntentFailedParams{
			ID: intent.ID, OrganizationID: intent.OrganizationID,
		})
		return intentTerminalErr{cause: err}
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
	bankCode, txnNo := vnpayProviderMetaFromEvent(ev)
	if _, err := q.MarkBillingPaymentIntentCompleted(ctx, markIntentCompletedParams(intent.ID, intent.OrganizationID, bankCode, txnNo, ev)); err != nil && !errors.Is(err, pgx.ErrNoRows) {
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
		Number: invoiceNumber(start, invID), AmountDue: intent.Amount, AmountPaid: intent.Amount, Currency: intent.Currency,
		PeriodStart: pgtype.Timestamptz{Time: start, Valid: true}, PeriodEnd: periodEnd,
		InitiatedBy: initiatedBy, InitiatedByKind: initiatedKind,
		PaymentIntentID: pgtype.Text{String: intent.ID, Valid: true},
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

// invoiceNumber keeps the invoice id's random suffix. A ULID's first ten
// characters are only the time, so a short prefix repeats for about a second
// and the later InsertInvoice hits idx_invoices_number. The year is Vietnam
// time: UTC would label the first seven hours of 1 January with the previous year.
func invoiceNumber(at time.Time, id string) string {
	suffix := id
	if len(id) > 10 {
		suffix = id[10:]
	}
	return fmt.Sprintf("UW-%d-%s", at.In(vnpayICT).Year(), suffix)
}

// ProviderWebhookPayloadJSON serialises raw provider params for webhook_inbox.
func ProviderWebhookPayloadJSON(ev billing.Event) ([]byte, error) {
	if len(ev.RawParams) > 0 {
		return json.Marshal(ev.RawParams)
	}
	return json.Marshal(ev)
}
