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

func (h *handlers) getEmailHubProviders(w http.ResponseWriter, r *http.Request) {
	p, err := h.EmailHub.Providers(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.EmailHubProvidersSDO{Google: p.Google, Microsoft: p.Microsoft})
}

// The nonce cookie carries the start's nonce to the callback; the sealed
// state holds the same nonce, so a state lifted into another browser does not
// complete there (spec §5.3, §7). Its path covers only the callback routes.
const (
	emailHubOAuthCookie     = "uniwork_email_oauth"
	emailHubOAuthCookiePath = "/api/v1/email-hub-connections/"
)

func (h *handlers) startEmailHubOAuth(w http.ResponseWriter, r *http.Request) {
	var in sdi.StartEmailHubOAuthSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	authURL, nonce, err := h.EmailHub.StartOAuth(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "provider"), in.LoginHint)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.setEmailHubOAuthCookie(w, nonce)
	respondJSON(w, http.StatusOK, sdo.EmailHubOAuthStartSDO{AuthorizationURL: authURL})
}

// setEmailHubOAuthCookie: Lax is what lets the browser send it on the
// top-level GET the provider redirects back to; it lives as long as the state.
func (h *handlers) setEmailHubOAuthCookie(w http.ResponseWriter, nonce string) {
	http.SetCookie(w, &http.Cookie{
		Name: emailHubOAuthCookie, Value: nonce, Path: emailHubOAuthCookiePath,
		MaxAge: int(oauthStateTTL / time.Second), HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: h.Cfg.SecureCookies,
	})
}
