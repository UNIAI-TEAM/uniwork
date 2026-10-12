package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

// officeAppCapabilities is GET /api/v1/orgs/{orgID}/office/capabilities: the
// Office features enabled for one organization, read by the desktop app
// (plan X-03). It is not the per-document route of the same name
// (GET /documents/{documentID}/office/capabilities, OfficeCapabilitySDO).
//
// The handler makes no permission or database decision of its own: the service
// checks organization membership through RequireMember and evaluates the flags
// with the same override resolution GET /api/v1/config uses. A read writes no
// audit row.
func (h *handlers) officeAppCapabilities(w http.ResponseWriter, r *http.Request) {
	if h.OfficeCapabilities == nil {
		// The same wire code the sibling Office routes answer when a
		// dependency is missing (handler/office.go:48): a client switches on
		// the code, so a second name for one condition is a name no client
		// knows.
		respondError(w, http.StatusServiceUnavailable, "office_not_configured", "office capabilities are not configured")
		return
	}
	caps, err := h.OfficeCapabilities.Get(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.OfficeAppCapabilitiesSDO{
		SyncFeed:         caps.SyncFeed,
		SyncWrite:        caps.SyncWrite,
		OfflineLibrary:   caps.OfflineLibrary,
		AIUniwork:        caps.AIUniwork,
		AIUniworkFormats: caps.AIUniworkFormats,
		TTLSeconds:       caps.TTLSeconds,
	})
}
