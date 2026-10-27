package handler

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

// verifyEmail confirms the signed-in user's address with the mailed code.
func (h *handlers) verifyEmail(w http.ResponseWriter, r *http.Request) {
	var in sdi.VerifyEmailSDI
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

// authProviders tells the sign-in screens which third-party sign-ins exist,
// so a deployment without Google credentials shows no Google button. apple
// keeps the meaning the shipped iPhone app reads (native Sign in with
// Apple), apple_web is Sign in with Apple on the web, and google_native
// stays false until its route exists (ADR 0047 §10).
func (h *handlers) authProviders(w http.ResponseWriter, _ *http.Request) {
	respondJSON(w, http.StatusOK, sdo.AuthProvidersSDO{
		Google: h.Google != nil, Apple: h.AppleAuth.NativeEnabled(), AppleWeb: h.AppleAuth.WebEnabled(),
	})
}
