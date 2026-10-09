package service

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/billing"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var vnpayICT = time.FixedZone("ICT", 7*3600)

// vnpayQueryDRInput builds QueryDr parameters from intent rows (OrderInfo + PayDate must match Pay).
func (s *BillingService) vnpayQueryDRInput(ctx context.Context, q *db.Queries, intent db.BillingPaymentIntent, clientIP string) billing.QueryTransactionInput {
	in := billing.QueryTransactionInput{
		TxnRef:          intent.ProviderTxnRef,
		TransactionDate: intentVNPayTransactionDate(intent),
		OrderInfo:       vnpayOrderInfoFromIntent(ctx, q, intent),
		ClientIP:        clientIP,
	}
	if pd := strings.TrimSpace(pgTextString(intent.ProviderPayDate)); len(pd) == 14 {
		if t, err := time.ParseInLocation("20060102150405", pd, vnpayICT); err == nil {
			in.TransactionDate = t
		}
	}
	return in
}

func vnpayQueryDRInputFromBackfillRow(ctx context.Context, q *db.Queries, row db.ListCompletedBillingIntentsMissingProviderMetaRow, clientIP string) billing.QueryTransactionInput {
	intent := db.BillingPaymentIntent{
		ID:                row.ID,
		OrganizationID:    row.OrganizationID,
		PlanID:            row.PlanID,
		ProviderTxnRef:    row.ProviderTxnRef,
		ProviderOrderInfo: row.ProviderOrderInfo,
		ProviderPayDate:   row.ProviderPayDate,
		CreatedAt:         row.CreatedAt,
		CompletedAt:       row.CompletedAt,
	}
	in := billing.QueryTransactionInput{
		TxnRef:          row.ProviderTxnRef,
		TransactionDate: intentVNPayTransactionDate(intent),
		OrderInfo:       vnpayOrderInfoFromIntent(ctx, q, intent),
		ClientIP:        clientIP,
	}
	if pd := strings.TrimSpace(pgTextString(row.ProviderPayDate)); len(pd) == 14 {
		if t, err := time.ParseInLocation("20060102150405", pd, vnpayICT); err == nil {
			in.TransactionDate = t
		}
	}
	return in
}

func vnpayOrderInfoFromIntent(ctx context.Context, q *db.Queries, intent db.BillingPaymentIntent) string {
	if s := strings.TrimSpace(pgTextString(intent.ProviderOrderInfo)); s != "" {
		return s
	}
	if q != nil && intent.PlanID != "" {
		if plan, err := q.GetPlanByID(ctx, intent.PlanID); err == nil {
			if code := strings.TrimSpace(plan.Code); code != "" {
				return "UniWork " + code
			}
		}
	}
	return "UniWork billing"
}

func vnpayMetaFromProviderEvent(ev billing.Event) (bankCode, txnNo, orderInfo, payDate pgtype.Text) {
	if ev.RawParams == nil {
		return bankCode, txnNo, orderInfo, payDate
	}
	if s := strings.TrimSpace(ev.RawParams["vnp_BankCode"]); s != "" {
		bankCode = pgtype.Text{String: s, Valid: true}
	}
	if s := strings.TrimSpace(ev.RawParams["vnp_TransactionNo"]); s != "" {
		txnNo = pgtype.Text{String: s, Valid: true}
	}
	if s := strings.TrimSpace(ev.RawParams["vnp_OrderInfo"]); s != "" {
		orderInfo = pgtype.Text{String: s, Valid: true}
	}
	if s := strings.TrimSpace(ev.RawParams["vnp_PayDate"]); len(s) == 14 {
		payDate = pgtype.Text{String: s, Valid: true}
	}
	return bankCode, txnNo, orderInfo, payDate
}
