package service

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type invoiceIntentLookup struct {
	OrganizationID  string
	SubscriptionID  string
	Provider        string
	AmountPaid      int64
	PaymentIntentID pgtype.Text
}

func (s *BillingService) paymentIntentForInvoice(ctx context.Context, q *db.Queries, in invoiceIntentLookup) (db.BillingPaymentIntent, error) {
	if q == nil {
		q = s.q
	}
	if !in.PaymentIntentID.Valid || strings.TrimSpace(in.PaymentIntentID.String) == "" {
		return db.BillingPaymentIntent{}, pgx.ErrNoRows
	}
	return q.GetBillingPaymentIntentForInvoice(ctx, db.GetBillingPaymentIntentForInvoiceParams{
		ID: in.PaymentIntentID.String, OrganizationID: in.OrganizationID,
	})
}

func invoiceIntentLookupFromAdminRow(row db.AdminGetInvoiceByIDRow) invoiceIntentLookup {
	return invoiceIntentLookup{
		OrganizationID: row.OrganizationID, SubscriptionID: row.SubscriptionID,
		Provider: row.Provider, AmountPaid: row.AmountPaid, PaymentIntentID: row.PaymentIntentID,
	}
}

func invoiceIntentLookupFromReconcileRow(row db.ListInvoicesRefundPendingForReconcileRow) invoiceIntentLookup {
	return invoiceIntentLookup{
		OrganizationID: row.OrganizationID, SubscriptionID: row.SubscriptionID,
		Provider: row.Provider, AmountPaid: row.AmountPaid, PaymentIntentID: row.PaymentIntentID,
	}
}
