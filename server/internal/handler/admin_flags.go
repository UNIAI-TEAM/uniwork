package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (h *handlers) adminListFlags(w http.ResponseWriter, r *http.Request) {
	flags, err := h.Admin.ListFlags(r.Context())
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AdminFlagDTO, 0, len(flags))
	for _, f := range flags {
		out = append(out, sdo.AdminFlagDTO{
			Key: f.Key, Description: f.Description, Default: f.Default, Public: f.Public,
			Owner: f.Owner, ReviewAt: f.ReviewAt.Format("2006-01-02"), OverrideCount: f.OverrideCount,
		})
	}
	respondJSON(w, 200, sdo.AdminFlagListSDO{Flags: out})
}

func (h *handlers) adminListFlagOverrides(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Admin.ListFlagOverrides(r.Context(), chi.URLParam(r, "key"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, toOverrideList(rows))
}

func (h *handlers) adminSetFlagOverride(w http.ResponseWriter, r *http.Request) {
	var in sdi.FlagOverrideSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	input := service.FlagOverrideInput{ScopeType: in.ScopeType, ScopeID: in.ScopeID, Enabled: in.Enabled, Reason: in.Reason}
	if in.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, in.ExpiresAt)
		if err != nil {
			respondError(w, 400, "invalid_request", "expires_at phải là RFC 3339")
			return
		}
		input.ExpiresAt = &t
	}
	rows, err := h.Admin.SetFlagOverride(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "key"), input)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, toOverrideList(rows))
}

func (h *handlers) adminDeleteFlagOverride(w http.ResponseWriter, r *http.Request) {
	var in sdi.FlagOverrideDeleteSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	rows, err := h.Admin.DeleteFlagOverride(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "key"), in.ScopeType, in.ScopeID, in.Reason)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, toOverrideList(rows))
}

func toOverrideList(rows []db.FeatureFlagOverride) sdo.AdminFlagOverrideListSDO {
	out := sdo.AdminFlagOverrideListSDO{Overrides: make([]sdo.AdminFlagOverrideDTO, 0, len(rows))}
	for _, o := range rows {
		out.Overrides = append(out.Overrides, sdo.AdminFlagOverrideDTO{
			ID: o.ID, FlagKey: o.FlagKey, ScopeType: o.ScopeType, ScopeID: o.ScopeID, Enabled: o.Enabled,
			Note: o.Note, CreatedBy: o.CreatedBy, CreatedAt: o.CreatedAt.Time.Format(time.RFC3339), ExpiresAt: optTime(o.ExpiresAt),
		})
	}
	return out
}
