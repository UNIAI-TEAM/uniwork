package service

import (
	"context"
	"errors"
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
	if in.PaymentIntentID.Valid && strings.TrimSpace(in.PaymentIntentID.String) != "" {
		intent, err := q.GetBillingPaymentIntentForInvoice(ctx, db.GetBillingPaymentIntentForInvoiceParams{
			ID: in.PaymentIntentID.String, OrganizationID: in.OrganizationID,
		})
		if err == nil {
			return intent, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return db.BillingPaymentIntent{}, err
		}
	}
	return q.GetCompletedPaymentIntentForInvoice(ctx, db.GetCompletedPaymentIntentForInvoiceParams{
		OrganizationID: in.OrganizationID, SubscriptionID: in.SubscriptionID,
		Provider: in.Provider, Amount: in.AmountPaid,
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
