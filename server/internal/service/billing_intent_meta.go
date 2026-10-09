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

func markIntentCompletedParams(intentID, orgID, bankCode, txnNo string) db.MarkBillingPaymentIntentCompletedParams {
	p := db.MarkBillingPaymentIntentCompletedParams{
		ID: intentID, OrganizationID: orgID,
	}
	if bankCode != "" {
		p.ProviderBankCode = pgtype.Text{String: bankCode, Valid: true}
	}
	if txnNo != "" {
		p.ProviderTransactionNo = pgtype.Text{String: txnNo, Valid: true}
	}
	return p
}

func (s *BillingService) patchIntentProviderMeta(ctx context.Context, q *db.Queries, intent db.BillingPaymentIntent, ev billing.Event) error {
	bankCode, txnNo := vnpayProviderMetaFromEvent(ev)
	if bankCode == "" && txnNo == "" {
		return nil
	}
	hasBank := intent.ProviderBankCode.Valid && strings.TrimSpace(intent.ProviderBankCode.String) != ""
	hasTxn := intent.ProviderTransactionNo.Valid && strings.TrimSpace(intent.ProviderTransactionNo.String) != ""
	if hasBank && hasTxn {
		return nil
	}
	var bankArg, txnArg pgtype.Text
	if bankCode != "" {
		bankArg = pgtype.Text{String: bankCode, Valid: true}
	}
	if txnNo != "" {
		txnArg = pgtype.Text{String: txnNo, Valid: true}
	}
	return q.PatchBillingPaymentIntentProviderMeta(ctx, db.PatchBillingPaymentIntentProviderMetaParams{
		ID: intent.ID, OrganizationID: intent.OrganizationID,
		ProviderBankCode: bankArg, ProviderTransactionNo: txnArg,
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
		txDate := row.CreatedAt.Time
		if row.CompletedAt.Valid {
			txDate = row.CompletedAt.Time
		}
		ev, err := vnp.QueryTransaction(ctx, billing.QueryTransactionInput{
			TxnRef:          row.ProviderTxnRef,
			TransactionDate: txDate,
			OrderInfo:       "UniWork billing",
		})
		if err != nil {
			s.billingLogWarn("billing intent meta backfill querydr", err, "intent_id", row.ID)
			continue
		}
		intent := db.BillingPaymentIntent{ID: row.ID, OrganizationID: row.OrganizationID}
		if err := s.patchIntentProviderMeta(ctx, s.q, intent, ev); err != nil {
			s.billingLogWarn("billing intent meta backfill patch", err, "intent_id", row.ID)
		}
	}
	return nil
}
