package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func toAdminPlanDTO(v service.AdminPlanCatalogView) sdo.AdminPlanDTO {
	out := sdo.AdminPlanDTO{
		ID: v.Plan.ID, Code: v.Plan.Code, Name: v.Plan.Name, Description: v.Plan.Description,
		BillingPeriod: v.Plan.BillingPeriod, PriceAmount: optInt64(v.Plan.PriceAmount), PriceCurrency: v.Plan.PriceCurrency,
		IsDefault: v.Plan.IsDefault, IsActive: v.Plan.IsActive, SortOrder: v.Plan.SortOrder,
		Features: make([]sdo.AdminPlanFeatureDTO, 0, len(v.Features)),
	}
	for _, f := range v.Features {
		out.Features = append(out.Features, sdo.AdminPlanFeatureDTO{
			FeatureKey: f.FeatureKey, Name: f.Name, Kind: f.Kind, Unit: textOrEmpty(f.Unit),
			Enabled: f.Enabled, QuotaLimit: optInt64(f.QuotaLimit),
		})
	}
	return out
}

func textOrEmpty(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

func (h *handlers) adminCreatePlan(w http.ResponseWriter, r *http.Request) {
	var in sdi.PlanCreateSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	currency := in.PriceCurrency
	if currency == "" {
		currency = "VND"
	}
	view, err := h.Admin.CreatePlanCatalog(r.Context(), middleware.UserID(r.Context()), service.CreatePlanCatalogInput{
		Code: in.Code,
		UpdatePlanCatalogInput: service.UpdatePlanCatalogInput{
			Name: in.Name, Description: in.Description, BillingPeriod: in.BillingPeriod,
			PriceAmount: in.PriceAmount, PriceCurrency: currency, IsActive: in.IsActive, SortOrder: in.SortOrder,
		},
	}, in.Reason)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, sdo.AdminPlanSDO{Plan: toAdminPlanDTO(view)})
}

func (h *handlers) adminListPlans(w http.ResponseWriter, r *http.Request) {
	plans, err := h.Admin.ListPlansCatalog(r.Context())
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AdminPlanDTO, 0, len(plans))
	for _, p := range plans {
		out = append(out, toAdminPlanDTO(p))
	}
	respondJSON(w, 200, sdo.AdminPlanListSDO{Plans: out})
}

func (h *handlers) adminUpdatePlan(w http.ResponseWriter, r *http.Request) {
	var in sdi.PlanUpsertSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	code := chi.URLParam(r, "code")
	currency := in.PriceCurrency
	if currency == "" {
		currency = "VND"
	}
	view, err := h.Admin.SetPlanCatalog(r.Context(), middleware.UserID(r.Context()), code, service.UpdatePlanCatalogInput{
		Name: in.Name, Description: in.Description, BillingPeriod: in.BillingPeriod,
		PriceAmount: in.PriceAmount, PriceCurrency: currency, IsActive: in.IsActive, SortOrder: in.SortOrder,
	}, in.Reason)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AdminPlanSDO{Plan: toAdminPlanDTO(view)})
}

func (h *handlers) adminUpdatePlanFeature(w http.ResponseWriter, r *http.Request) {
	var in sdi.PlanFeatureSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	view, err := h.Admin.SetPlanFeature(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "code"), chi.URLParam(r, "key"), service.UpdatePlanFeatureInput{
			Enabled: in.Enabled, QuotaLimit: in.QuotaLimit,
		}, in.Reason)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AdminPlanSDO{Plan: toAdminPlanDTO(view)})
}
