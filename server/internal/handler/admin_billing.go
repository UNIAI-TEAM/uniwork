package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func adminBillingQuery(r *http.Request) service.AdminBillingListInput {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	return service.AdminBillingListInput{
		Query: q.Get("q"), Provider: q.Get("provider"), Status: q.Get("status"),
		Limit: int32(limit), Offset: int32(offset),
	}
}

func adminInvoiceDTOFromListRow(inv db.AdminListInvoicesRow) sdo.AdminInvoiceDTO {
	return sdo.AdminInvoiceDTO{
		ID: inv.ID, OrganizationID: inv.OrganizationID, OrgSlug: inv.OrgSlug, OrgName: inv.OrgName,
		Number: inv.Number, Status: inv.Status, Provider: inv.Provider,
		AmountPaid: inv.AmountPaid, Currency: inv.Currency,
		PeriodStart: inv.PeriodStart.Time.Format(time.RFC3339),
		PeriodEnd:   inv.PeriodEnd.Time.Format(time.RFC3339),
		PaidAt:      optTime(inv.PaidAt), CreatedAt: inv.CreatedAt.Time.Format(time.RFC3339),
		UserID: inv.UserID, UserDisplayName: inv.UserDisplayName, UserEmail: inv.UserEmail,
		PlanCode: textOrEmpty(inv.PlanCode), PlanName: textOrEmpty(inv.PlanName),
		RefundRequestedAt: optTime(inv.RefundRequestedAt), RefundedAt: optTime(inv.RefundedAt),
		RefundProviderRef: textOrEmpty(inv.RefundProviderRef),
		RefundReason:      textOrEmpty(inv.RefundReason), RefundConfirmReason: textOrEmpty(inv.RefundConfirmReason),
		AmountRefunded: inv.AmountRefunded, PartialRefundAmount: int64OrZero(inv.PartialRefundAmount),
		ProviderBankCode: textOrEmpty(inv.ProviderBankCode), ProviderTransactionNo: textOrEmpty(inv.ProviderTransactionNo),
		ProviderTxnRef:    inv.ProviderTxnRef,
		ProviderInvoiceID: textOrEmpty(inv.ProviderInvoiceID),
		PaymentIntentID:   textOrEmpty(inv.PaymentIntentID),
	}
}

func adminInvoiceDTOFromInvoice(inv db.Invoice, meta db.AdminGetInvoiceByIDRow) sdo.AdminInvoiceDTO {
	return sdo.AdminInvoiceDTO{
		ID: inv.ID, OrganizationID: inv.OrganizationID, OrgSlug: meta.OrgSlug, OrgName: meta.OrgName,
		Number: inv.Number, Status: inv.Status, Provider: inv.Provider,
		AmountPaid: inv.AmountPaid, Currency: inv.Currency,
		PeriodStart: inv.PeriodStart.Time.Format(time.RFC3339),
		PeriodEnd:   inv.PeriodEnd.Time.Format(time.RFC3339),
		PaidAt:      optTime(inv.PaidAt), CreatedAt: inv.CreatedAt.Time.Format(time.RFC3339),
		PlanCode: textOrEmpty(meta.PlanCode), PlanName: textOrEmpty(meta.PlanName),
		RefundRequestedAt: optTime(inv.RefundRequestedAt), RefundedAt: optTime(inv.RefundedAt),
		RefundProviderRef: textOrEmpty(inv.RefundProviderRef),
		RefundReason:      textOrEmpty(inv.RefundReason), RefundConfirmReason: textOrEmpty(inv.RefundConfirmReason),
		AmountRefunded: inv.AmountRefunded, PartialRefundAmount: int64OrZero(inv.PartialRefundAmount),
		ProviderBankCode: textOrEmpty(meta.ProviderBankCode), ProviderTransactionNo: textOrEmpty(meta.ProviderTransactionNo),
		ProviderTxnRef:    meta.ProviderTxnRef,
		ProviderInvoiceID: textOrEmpty(inv.ProviderInvoiceID),
		PaymentIntentID:   textOrEmpty(inv.PaymentIntentID),
	}
}

func int64OrZero(v pgtype.Int8) int64 {
	if !v.Valid {
		return 0
	}
	return v.Int64
}

func (h *handlers) adminListInvoices(w http.ResponseWriter, r *http.Request) {
	page, err := h.Admin.ListInvoices(r.Context(), adminBillingQuery(r))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AdminInvoiceDTO, 0, len(page.Invoices))
	for _, inv := range page.Invoices {
		out = append(out, adminInvoiceDTOFromListRow(inv))
	}
	respondJSON(w, 200, sdo.AdminInvoiceListSDO{Invoices: out, Total: page.Total, Limit: page.Limit, Offset: page.Offset})
}

func (h *handlers) adminListPaymentIntents(w http.ResponseWriter, r *http.Request) {
	page, err := h.Admin.ListPaymentIntents(r.Context(), adminBillingQuery(r))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AdminPaymentIntentDTO, 0, len(page.Intents))
	for _, pi := range page.Intents {
		out = append(out, sdo.AdminPaymentIntentDTO{
			ID: pi.ID, OrganizationID: pi.OrganizationID, OrgSlug: pi.OrgSlug, OrgName: pi.OrgName,
			PlanCode: pi.PlanCode, Provider: pi.Provider, ProviderTxnRef: pi.ProviderTxnRef,
			Amount: pi.Amount, Currency: pi.Currency, Status: pi.Status,
			ExpiresAt:   pi.ExpiresAt.Time.Format(time.RFC3339),
			CompletedAt: optTime(pi.CompletedAt),
			CreatedAt:   pi.CreatedAt.Time.Format(time.RFC3339),
			UserID:      pi.UserID, UserDisplayName: pi.UserDisplayName, UserEmail: pi.UserEmail,
			ProviderBankCode: textOrEmpty(pi.ProviderBankCode), ProviderTransactionNo: textOrEmpty(pi.ProviderTransactionNo),
		})
	}
	respondJSON(w, 200, sdo.AdminPaymentIntentListSDO{Intents: out, Total: page.Total, Limit: page.Limit, Offset: page.Offset})
}

func (h *handlers) adminRefundInvoice(w http.ResponseWriter, r *http.Request) {
	var in sdi.AdminInvoiceRefundSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	var amount int64
	if in.RefundAmount != nil {
		amount = *in.RefundAmount
	}
	inv, err := h.Admin.RefundInvoice(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "invoiceID"),
		in.Reason, in.ProviderReference, middleware.ClientIP(r, h.proxies), amount)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	meta, err := h.Admin.GetInvoiceMeta(r.Context(), inv.ID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AdminInvoiceSDO{Invoice: adminInvoiceDTOFromInvoice(inv, meta)})
}

func (h *handlers) adminConfirmInvoiceRefund(w http.ResponseWriter, r *http.Request) {
	var in sdi.ReasonSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	inv, err := h.Admin.ConfirmInvoiceRefund(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "invoiceID"), in.Reason)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	meta, err := h.Admin.GetInvoiceMeta(r.Context(), inv.ID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AdminInvoiceSDO{Invoice: adminInvoiceDTOFromInvoice(inv, meta)})
}
