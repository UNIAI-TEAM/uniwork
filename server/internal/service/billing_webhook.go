package service

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/billing"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const billingWebhookBatch = int32(20)

// RunWorkers polls billing webhook_inbox rows and subscription lapse (cancel / past_due).
func (s *BillingService) RunWorkers(ctx context.Context) {
	webhookTick := time.NewTicker(time.Second)
	lapseTick := time.NewTicker(billingLapseInterval)
	refundReconcileTick := time.NewTicker(billingRefundReconcileInterval)
	defer webhookTick.Stop()
	defer lapseTick.Stop()
	defer refundReconcileTick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-webhookTick.C:
			if err := s.ProcessBillingWebhookInbox(ctx, billingWebhookBatch); err != nil {
				s.billingLogWarn("billing webhook inbox tick", err)
			}
		case <-lapseTick.C:
			if err := s.ProcessSubscriptionLapse(ctx); err != nil {
				s.billingLogWarn("billing subscription lapse tick", err)
			}
		case <-refundReconcileTick.C:
			if err := s.ProcessRefundPendingReconcile(ctx); err != nil {
				s.billingLogWarn("billing refund reconcile tick", err)
			}
			if err := s.ProcessIntentProviderMetaBackfill(ctx); err != nil {
				s.billingLogWarn("billing intent meta backfill tick", err)
			}
		}
	}
}

func (s *BillingService) ProcessBillingWebhookInbox(ctx context.Context, limit int32) error {
	if limit <= 0 {
		limit = billingWebhookBatch
	}
	_ = s.q.ReleaseStaleWebhookInbox(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := s.q.WithTx(tx).ClaimPendingBillingWebhookInbox(ctx, db.ClaimPendingBillingWebhookInboxParams{
		LeaseSeconds: float64(webhookLeaseSeconds), LimitN: limit,
	})
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	for _, row := range rows {
		if err := s.processBillingWebhookRow(ctx, row); err != nil {
			s.markBillingWebhookFailed(ctx, row, err)
			continue
		}
		_ = s.q.MarkWebhookInboxDone(ctx, row.ID)
	}
	return nil
}

func (s *BillingService) processBillingWebhookRow(ctx context.Context, row db.WebhookInbox) error {
	var params map[string]string
	if err := json.Unmarshal([]byte(row.Payload), &params); err != nil {
		return err
	}
	ev := billing.Event{
		ProviderEventID: row.ProviderEventID,
		Type:            row.EventType,
		RawParams:       params,
	}
	if v, ok := params["vnp_TxnRef"]; ok {
		ev.ProviderTxnRef = v
	}
	if params["vnp_ResponseCode"] == "00" {
		ev.Paid = true
		ev.Type = "invoice.paid"
	}
	if amt, ok := params["vnp_Amount"]; ok {
		if n, err := parseVnpayAmount(amt); err == nil {
			ev.Amount = n
		}
	}
	ev.Currency = params["vnp_CurrCode"]
	return s.ApplyProviderEvent(ctx, ev)
}

func parseVnpayAmount(raw string) (int64, error) {
	minor, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, err
	}
	return minor / 100, nil
}

func (s *BillingService) markBillingWebhookFailed(ctx context.Context, row db.WebhookInbox, err error) {
	nextAt, status := outbox.RetryAt(row.AttemptCount+1), "PENDING"
	if row.AttemptCount+1 >= webhookMaxAttempts {
		status = "DEAD_LETTER"
		if s.metrics != nil {
			s.metrics.IncWebhookDead()
		}
	}
	_ = s.q.MarkWebhookInboxFailed(ctx, db.MarkWebhookInboxFailedParams{
		ID: row.ID, LastError: strText(err.Error()),
		NextAttemptAt: pgtype.Timestamptz{Time: nextAt, Valid: true},
		Status:        status,
	})
}
