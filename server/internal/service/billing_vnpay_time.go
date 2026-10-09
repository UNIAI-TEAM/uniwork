package service

import (
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// intentVNPayTransactionDate is the pay date VNPay QueryDr/refund expect (completed_at when known).
func intentVNPayTransactionDate(intent db.BillingPaymentIntent) time.Time {
	if intent.CompletedAt.Valid {
		return intent.CompletedAt.Time
	}
	return intent.CreatedAt.Time
}
