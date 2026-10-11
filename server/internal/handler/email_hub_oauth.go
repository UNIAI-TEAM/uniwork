package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) getEmailHubProviders(w http.ResponseWriter, r *http.Request) {
	p, err := h.EmailHub.Providers(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.EmailHubProvidersSDO{Google: p.Google, Microsoft: p.Microsoft})
}
