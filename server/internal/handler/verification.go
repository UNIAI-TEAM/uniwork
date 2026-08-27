package handler

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/middleware"
)

// verifyEmail confirms the signed-in user's address with the mailed code.
func (h *handlers) verifyEmail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	u, err := h.Verification.Confirm(r.Context(), middleware.UserID(r.Context()), in.Code)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(u)})
}

// resendVerification issues a fresh code; the service applies the 60s gap.
func (h *handlers) resendVerification(w http.ResponseWriter, r *http.Request) {
	if err := h.Verification.Send(r.Context(), middleware.UserID(r.Context())); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// authProviders tells the login page which third-party sign-ins exist, so a
// deployment without Google credentials shows no Google button.
func (h *handlers) authProviders(w http.ResponseWriter, _ *http.Request) {
	respondJSON(w, http.StatusOK, map[string]bool{"google": h.Cfg.GoogleEnabled()})
}
