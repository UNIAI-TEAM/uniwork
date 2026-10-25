package service

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// AdminBillingListInput filters invoice and payment-intent lists.
type AdminBillingListInput struct {
	Query    string
	Provider string
	Status   string
	From     time.Time
	To       time.Time
	Limit    int32
	Offset   int32
}

type AdminInvoicePage struct {
	Invoices []db.AdminListInvoicesRow
	Total    int64
	Limit    int32
	Offset   int32
}

type AdminPaymentIntentPage struct {
	Intents []db.AdminListPaymentIntentsRow
	Total   int64
	Limit   int32
	Offset  int32
}

func normalizeAdminBillingList(in AdminBillingListInput) AdminBillingListInput {
	if in.Limit <= 0 || in.Limit > 200 {
		in.Limit = 50
	}
	if in.Offset < 0 {
		in.Offset = 0
	}
	in.Query = strings.TrimSpace(in.Query)
	in.Provider = strings.TrimSpace(in.Provider)
	in.Status = strings.TrimSpace(in.Status)
	return in
}

func adminBillingFilters(in AdminBillingListInput) (provider, status, q, dateFrom, dateTo pgtype.Timestamptz) {
	if in.Provider != "" {
		provider = nullText(in.Provider)
	}
	if in.Status != "" {
		status = nullText(in.Status)
	}
	if in.Query != "" {
		q = nullText(in.Query)
	}
	if !in.From.IsZero() {
		dateFrom = pgtype.Timestamptz{Time: in.From, Valid: true}
	}
	if !in.To.IsZero() {
		dateTo = pgtype.Timestamptz{Time: in.To, Valid: true}
	}
	return provider, status, q, dateFrom, dateTo
}

// ListInvoices is GET /admin/invoices — metadata across tenants.
func (s *AdminService) ListInvoices(ctx context.Context, in AdminBillingListInput) (AdminInvoicePage, error) {
	in = normalizeAdminBillingList(in)
	provider, status, q, dateFrom, dateTo := adminBillingFilters(in)
	rows, err := s.q.AdminListInvoices(ctx, db.AdminListInvoicesParams{
		Limit: in.Limit, Offset: in.Offset, Provider: provider, Status: status, Q: q,
		DateFrom: dateFrom, DateTo: dateTo,
	})
	if err != nil {
		return AdminInvoicePage{}, err
	}
	out := AdminInvoicePage{Invoices: rows, Limit: in.Limit, Offset: in.Offset}
	if len(rows) > 0 {
		out.Total = rows[0].TotalCount
		return out, nil
	}
	out.Total, err = s.q.AdminCountInvoices(ctx, db.AdminCountInvoicesParams{
		Provider: provider, Status: status, Q: q, DateFrom: dateFrom, DateTo: dateTo,
	})
	return out, err
}

// ListPaymentIntents is GET /admin/billing/payment-intents — checkout rows for support.
func (s *AdminService) ListPaymentIntents(ctx context.Context, in AdminBillingListInput) (AdminPaymentIntentPage, error) {
	in = normalizeAdminBillingList(in)
	provider, status, q, dateFrom, dateTo := adminBillingFilters(in)
	rows, err := s.q.AdminListPaymentIntents(ctx, db.AdminListPaymentIntentsParams{
		Limit: in.Limit, Offset: in.Offset, Provider: provider, Status: status, Q: q,
		DateFrom: dateFrom, DateTo: dateTo,
	})
	if err != nil {
		return AdminPaymentIntentPage{}, err
	}
	out := AdminPaymentIntentPage{Intents: rows, Limit: in.Limit, Offset: in.Offset}
	if len(rows) > 0 {
		out.Total = rows[0].TotalCount
		return out, nil
	}
	out.Total, err = s.q.AdminCountPaymentIntents(ctx, db.AdminCountPaymentIntentsParams{
		Provider: provider, Status: status, Q: q, DateFrom: dateFrom, DateTo: dateTo,
	})
	return out, err
}

// GetInvoiceMeta loads list-style metadata for one invoice (handler DTO mapping).
func (s *AdminService) GetInvoiceMeta(ctx context.Context, invoiceID string) (db.AdminGetInvoiceByIDRow, error) {
	return s.q.AdminGetInvoiceByID(ctx, invoiceID)
}
