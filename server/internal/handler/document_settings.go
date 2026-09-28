package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Organization document settings HTTP (C-01 §5.3; UNI-679, G1-05b). The
// public-links switch is the second key of every link command: the plan
// entitlement is the first, and DocumentService checks both inside the
// command's transaction. Only organization owners/admins may change it.

// setDocumentSettings is PUT /orgs/{orgID}/documents/settings.
func (h *handlers) setDocumentSettings(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.SetDocumentSettingsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	set, err := h.Documents.SetDocumentPublicLinks(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "orgID"), in.PublicLinksEnabled)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentSettingsSDO{OrganizationID: set.OrganizationID, PublicLinksEnabled: set.PublicLinksEnabled}
	if set.UpdatedBy != "" {
		out.UpdatedBy = &set.UpdatedBy
	}
	if set.UpdatedByKind != "" {
		out.UpdatedByKind = &set.UpdatedByKind
	}
	if set.UpdatedAt.Valid {
		at := set.UpdatedAt.Time.UTC().Format(time.RFC3339)
		out.UpdatedAt = &at
	}
	respondJSON(w, http.StatusOK, out)
}
