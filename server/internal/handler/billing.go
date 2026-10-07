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

func toInvoiceDTO(inv db.Invoice) sdo.InvoiceDTO {
	return sdo.InvoiceDTO{
		ID: inv.ID, Number: inv.Number, Status: inv.Status, Provider: inv.Provider,
		AmountPaid: inv.AmountPaid, Currency: inv.Currency,
		PeriodStart: inv.PeriodStart.Time.Format(time.RFC3339),
		PeriodEnd:   inv.PeriodEnd.Time.Format(time.RFC3339),
		PaidAt:      optTime(inv.PaidAt),
	}
}

func optInt64(v pgtype.Int8) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

func optTime(v pgtype.Timestamptz) string {
	if !v.Valid {
		return ""
	}
	return v.Time.Format(time.RFC3339)
}

func toPlanDTO(p service.PlanView) sdo.PlanDTO {
	out := sdo.PlanDTO{
		ID: p.Plan.ID, Code: p.Plan.Code, Name: p.Plan.Name, Description: p.Plan.Description,
		BillingPeriod: p.Plan.BillingPeriod, PriceAmount: optInt64(p.Plan.PriceAmount), PriceCurrency: p.Plan.PriceCurrency,
		IsDefault: p.Plan.IsDefault, Features: make([]sdo.PlanFeatureDTO, 0, len(p.Features)),
	}
	for _, f := range p.Features {
		out.Features = append(out.Features, sdo.PlanFeatureDTO{FeatureKey: f.FeatureKey, Enabled: f.Enabled, QuotaLimit: optInt64(f.QuotaLimit)})
	}
	return out
}

func toSubscriptionSDO(s service.EntitlementSnapshot) sdo.SubscriptionSDO {
	sub := s.Subscription
	out := sdo.SubscriptionSDO{
		Subscription: sdo.SubscriptionDTO{
			ID: sub.ID, PlanCode: s.Plan.Code, PlanName: s.Plan.Name, Status: sub.Status, Provider: sub.Provider,
			CurrentPeriodStart: sub.CurrentPeriodStart.Time.Format(time.RFC3339),
			CurrentPeriodEnd:   optTime(sub.CurrentPeriodEnd), CancelAt: optTime(sub.CancelAt), TrialEndsAt: optTime(sub.TrialEndsAt),
			RowVersion: sub.RowVersion,
		},
		Entitlements: make([]sdo.EntitlementDTO, 0, len(s.Entitlements)),
	}
	for _, e := range s.Entitlements {
		out.Entitlements = append(out.Entitlements, sdo.EntitlementDTO{
			FeatureKey: e.Key, Name: e.Name, Kind: e.Kind, Unit: e.Unit, Category: e.Category,
			Enabled: e.Enabled, QuotaLimit: e.Limit, CurrentUsage: e.Current, Metered: e.Metered,
		})
	}
	return out
}

func (h *handlers) listPlans(w http.ResponseWriter, r *http.Request) {
	plans, err := h.Billing.ListPlans(r.Context())
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.PlanDTO, 0, len(plans))
	for _, p := range plans {
		out = append(out, toPlanDTO(p))
	}
	respondJSON(w, 200, sdo.PlanListSDO{Plans: out})
}

func (h *handlers) respondSubscription(w http.ResponseWriter, snap service.EntitlementSnapshot, err error) {
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, toSubscriptionSDO(snap))
}

func (h *handlers) getSubscription(w http.ResponseWriter, r *http.Request) {
	snap, err := h.Billing.Current(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"))
	h.respondSubscription(w, snap, err)
}

func (h *handlers) changePlan(w http.ResponseWriter, r *http.Request) {
	var in sdi.ChangePlanSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	snap, err := h.Billing.ChangePlan(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"), in.PlanCode, in.RowVersion)
	h.respondSubscription(w, snap, err)
}

func (h *handlers) cancelSubscription(w http.ResponseWriter, r *http.Request) {
	snap, err := h.Billing.Cancel(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"))
	h.respondSubscription(w, snap, err)
}

func (h *handlers) resumeSubscription(w http.ResponseWriter, r *http.Request) {
	snap, err := h.Billing.Resume(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"))
	h.respondSubscription(w, snap, err)
}

func (h *handlers) listInvoices(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	rows, err := h.Billing.ListInvoices(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"), int32(limit), int32(offset))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.InvoiceDTO, 0, len(rows))
	for _, inv := range rows {
		out = append(out, toInvoiceDTO(inv))
	}
	respondJSON(w, 200, sdo.InvoiceListSDO{Invoices: out})
}

func (h *handlers) createCheckout(w http.ResponseWriter, r *http.Request) {
	var in sdi.CheckoutSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := service.ValidateCheckoutPath(in.SuccessPath); err != nil {
		h.mapServiceError(w, err)
		return
	}
	if err := service.ValidateCheckoutPath(in.CancelPath); err != nil {
		h.mapServiceError(w, err)
		return
	}
	origin := h.Cfg.FrontendOrigin
	clientIP := middleware.ClientIP(r, h.proxies)
	sess, err := h.Billing.Checkout(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"), in.PlanCode, origin+in.SuccessPath, origin+in.CancelPath, clientIP)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, sdo.CheckoutSDO{URL: sess.URL})
}
