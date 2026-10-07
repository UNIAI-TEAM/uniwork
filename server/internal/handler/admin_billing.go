package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
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

func (h *handlers) adminListInvoices(w http.ResponseWriter, r *http.Request) {
	page, err := h.Admin.ListInvoices(r.Context(), adminBillingQuery(r))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AdminInvoiceDTO, 0, len(page.Invoices))
	for _, inv := range page.Invoices {
		out = append(out, sdo.AdminInvoiceDTO{
			ID: inv.ID, OrganizationID: inv.OrganizationID, OrgSlug: inv.OrgSlug, OrgName: inv.OrgName,
			Number: inv.Number, Status: inv.Status, Provider: inv.Provider,
			AmountPaid: inv.AmountPaid, Currency: inv.Currency,
			PeriodStart: inv.PeriodStart.Time.Format(time.RFC3339),
			PeriodEnd:   inv.PeriodEnd.Time.Format(time.RFC3339),
			PaidAt:      optTime(inv.PaidAt), CreatedAt: inv.CreatedAt.Time.Format(time.RFC3339),
			UserID: inv.UserID, UserDisplayName: inv.UserDisplayName, UserEmail: inv.UserEmail,
		})
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
		})
	}
	respondJSON(w, 200, sdo.AdminPaymentIntentListSDO{Intents: out, Total: page.Total, Limit: page.Limit, Offset: page.Offset})
}
