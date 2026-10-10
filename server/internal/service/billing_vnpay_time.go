package service

import (
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// intentVNPayTransactionDate is the vnp_TransactionDate fallback for QueryDr/refund when
// provider_pay_date is unset. Prefer intent created_at (matches Pay URL vnp_CreateDate) over
// completed_at, which is server IPN time and often differs from vnp_PayDate by seconds.
func intentVNPayTransactionDate(intent db.BillingPaymentIntent) time.Time {
	return intent.CreatedAt.Time
}
