package service

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/billing"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const billingIntentMetaBackfillBatch = int32(10)

func vnpayProviderMetaFromEvent(ev billing.Event) (bankCode, txnNo string) {
	if ev.RawParams == nil {
		return "", ""
	}
	return strings.TrimSpace(ev.RawParams["vnp_BankCode"]), strings.TrimSpace(ev.RawParams["vnp_TransactionNo"])
}

func markIntentCompletedParams(intentID, orgID, bankCode, txnNo string, ev billing.Event) db.MarkBillingPaymentIntentCompletedParams {
	p := db.MarkBillingPaymentIntentCompletedParams{
		ID: intentID, OrganizationID: orgID,
	}
	if bankCode != "" {
		p.ProviderBankCode = pgtype.Text{String: bankCode, Valid: true}
	}
	if txnNo != "" {
		p.ProviderTransactionNo = pgtype.Text{String: txnNo, Valid: true}
	}
	_, _, orderInfo, payDate := vnpayMetaFromProviderEvent(ev)
	if orderInfo.Valid {
		p.ProviderOrderInfo = orderInfo
	}
	if payDate.Valid {
		p.ProviderPayDate = payDate
	}
	return p
}

func (s *BillingService) patchIntentProviderMeta(ctx context.Context, q *db.Queries, intent db.BillingPaymentIntent, ev billing.Event) error {
	bankCode, txnNo, orderInfo, payDate := vnpayMetaFromProviderEvent(ev)
	if !bankCode.Valid && !txnNo.Valid && !orderInfo.Valid && !payDate.Valid {
		return nil
	}
	hasBank := intent.ProviderBankCode.Valid && strings.TrimSpace(intent.ProviderBankCode.String) != ""
	hasTxn := intent.ProviderTransactionNo.Valid && strings.TrimSpace(intent.ProviderTransactionNo.String) != ""
	hasOrder := intent.ProviderOrderInfo.Valid && strings.TrimSpace(intent.ProviderOrderInfo.String) != ""
	hasPayDate := intent.ProviderPayDate.Valid && strings.TrimSpace(intent.ProviderPayDate.String) != ""
	if hasBank && hasTxn && hasOrder && hasPayDate {
		return nil
	}
	var bankArg, txnArg, orderArg, payArg pgtype.Text
	if bankCode.Valid && !hasBank {
		bankArg = bankCode
	}
	if txnNo.Valid && !hasTxn {
		txnArg = txnNo
	}
	if orderInfo.Valid && !hasOrder {
		orderArg = orderInfo
	}
	if payDate.Valid && !hasPayDate {
		payArg = payDate
	}
	if !bankArg.Valid && !txnArg.Valid && !orderArg.Valid && !payArg.Valid {
		return nil
	}
	return q.PatchBillingPaymentIntentProviderMeta(ctx, db.PatchBillingPaymentIntentProviderMetaParams{
		ID: intent.ID, OrganizationID: intent.OrganizationID,
		ProviderBankCode: bankArg, ProviderTransactionNo: txnArg,
		ProviderOrderInfo: orderArg, ProviderPayDate: payArg,
	})
}

// ProcessIntentProviderMetaBackfill fills bank / VNPay txn no on completed intents via QueryDr.
func (s *BillingService) ProcessIntentProviderMetaBackfill(ctx context.Context) error {
	vnp, ok := s.provider.(*billing.VNPay)
	if !ok {
		return nil
	}
	rows, err := s.q.ListCompletedBillingIntentsMissingProviderMeta(ctx, billingIntentMetaBackfillBatch)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := ctx.Err(); err != nil {
			return err
		}
		intent := db.BillingPaymentIntent{
			ID: row.ID, OrganizationID: row.OrganizationID, PlanID: row.PlanID,
			ProviderTxnRef: row.ProviderTxnRef, ProviderOrderInfo: row.ProviderOrderInfo,
			ProviderPayDate: row.ProviderPayDate, CreatedAt: row.CreatedAt, CompletedAt: row.CompletedAt,
		}
		ev, err := s.vnpayQueryDR(ctx, vnp, intent, "")
		if err != nil {
			s.billingLogWarn("billing intent meta backfill querydr", err, "intent_id", row.ID)
			continue
		}
		if err := s.patchIntentProviderMeta(ctx, s.q, intent, ev); err != nil {
			s.billingLogWarn("billing intent meta backfill patch", err, "intent_id", row.ID)
		}
	}
	return nil
}
