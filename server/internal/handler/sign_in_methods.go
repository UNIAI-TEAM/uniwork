package handler

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Step-up and Settings › Sign-in methods (ADR 0047 §5-6, spec §3.7). Every
// route here is the bearer's own account; the service judges the proof, the
// session and the account, and the handler only shapes the answer.

func (h *handlers) stepUp(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	var in sdi.StepUpSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	p := service.StepUpProof{Password: in.Password, Code: in.Code, Action: in.Action}
	if in.ProviderToken != nil {
		p.Provider = &service.ProviderProof{Provider: in.ProviderToken.Provider, Token: in.ProviderToken.Token, Nonce: in.ProviderToken.Nonce}
	}
	g, err := h.Auth.StepUp(h.authCtx(r).Context(), middleware.UserID(r.Context()), p)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StepUpSDO{StepUpToken: g.Token, ExpiresAt: g.ExpiresAt.UTC().Format(time.RFC3339), Method: g.Method})
}

func (h *handlers) stepUpEmailCode(w http.ResponseWriter, r *http.Request) {
	var in sdi.StepUpEmailCodeSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Auth.SendStepUpCode(h.authCtx(r).Context(), middleware.UserID(r.Context()), in.Action); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "sent"})
}

func (h *handlers) signInMethods(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	m, err := h.Auth.SignInMethods(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toSignInMethodsSDO(m))
}

// signInMethodsReady answers 503 when the server runs without the sign-in
// methods service.
func (h *handlers) signInMethodsReady(w http.ResponseWriter) bool {
	if h.SignInMethods == nil {
		respondError(w, http.StatusServiceUnavailable, "sign_in_methods_unavailable", "sign-in methods are not configured")
		return false
	}
	return true
}

func (h *handlers) setPassword(w http.ResponseWriter, r *http.Request) {
	if !h.signInMethodsReady(w) {
		return
	}
	var in sdi.SetPasswordSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	out, err := h.SignInMethods.SetPassword(h.authCtx(r).Context(), middleware.UserID(r.Context()), service.PasswordInput{
		New: in.NewPassword, Current: in.CurrentPassword, StepUpToken: in.StepUpToken,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toSignInMethodsChangeSDO(out))
}

// signInMethodLink starts linking provider from the browser that is signed
// in: the answer is the provider's start with intent=link and a five-minute
// link token bound to this account and browser session. The round trip
// ends back on return_to with sign_in_method and result (google.go).
func (h *handlers) signInMethodLink(provider string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		if !h.signInMethodsReady(w) {
			return
		}
		if provider == service.ProviderGoogle && h.Google == nil {
			respondError(w, http.StatusServiceUnavailable, "google_not_configured", "Google sign-in is not configured")
			return
		}
		var in sdi.LinkSignInMethodSDI
		if !decode(w, r, &in, maxJSONBody) {
			return
		}
		returnTo := sanitizeNext(in.ReturnTo)
		if returnTo == "" {
			returnTo = defaultLinkReturn
		}
		token, err := h.SignInMethods.StartLink(r.Context(), middleware.UserID(r.Context()), provider, in.StepUpToken, returnTo)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		start := strings.TrimRight(h.Cfg.APIPublicURL, "/") + "/api/v1/auth/" + provider + "/start?" +
			url.Values{"intent": {webIntentLink}, "link_token": {token}}.Encode()
		respondJSON(w, http.StatusOK, sdo.AuthorizationURLSDO{AuthorizationURL: start})
	}
}

func (h *handlers) signInMethodUnlink(provider string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !h.signInMethodsReady(w) {
			return
		}
		var in sdi.StepUpTokenSDI
		if !decode(w, r, &in, maxJSONBody) {
			return
		}
		out, err := h.SignInMethods.Unlink(h.authCtx(r).Context(), middleware.UserID(r.Context()), provider, in.StepUpToken)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		respondJSON(w, http.StatusOK, toSignInMethodsChangeSDO(out))
	}
}
