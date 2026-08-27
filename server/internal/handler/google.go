package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// oauthStateCookie carries the CSRF state (and the sanitized post-login
// path) between /google/start and /google/callback. Lax is what lets the
// browser send it on the top-level GET Google redirects back to.
const oauthStateCookie = "uniwork_oauth_state"

const oauthStateTTL = 10 * time.Minute

// GoogleExchanger is the OIDC round trip; auth.GoogleOAuth in production.
type GoogleExchanger interface {
	AuthCodeURL(state string) string
	Exchange(ctx context.Context, code string) (auth.GoogleClaims, error)
}

func (h *handlers) googleStart(w http.ResponseWriter, r *http.Request) {
	if h.Google == nil {
		respondError(w, http.StatusServiceUnavailable, "google_not_configured", "Google sign-in is not configured")
		return
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		h.mapServiceError(w, err)
		return
	}
	state := hex.EncodeToString(raw)
	next := sanitizeNext(r.URL.Query().Get("next"))
	http.SetCookie(w, &http.Cookie{
		Name: oauthStateCookie, Value: state + "|" + next, Path: "/api/v1/auth/google",
		MaxAge: int(oauthStateTTL / time.Second), HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: h.Cfg.SecureCookies,
	})
	http.Redirect(w, r, h.Google.AuthCodeURL(state), http.StatusFound)
}

func (h *handlers) googleCallback(w http.ResponseWriter, r *http.Request) {
	h.clearOAuthState(w)
	if h.Google == nil {
		h.redirectLoginError(w, r, "google_failed")
		return
	}
	c, err := r.Cookie(oauthStateCookie)
	if err != nil {
		h.redirectLoginError(w, r, "google_failed")
		return
	}
	state, next, _ := strings.Cut(c.Value, "|")
	q := r.URL.Query()
	if state == "" || q.Get("state") != state {
		h.redirectLoginError(w, r, "google_failed")
		return
	}
	if q.Get("error") == "access_denied" {
		h.redirectLoginError(w, r, "google_denied")
		return
	}
	claims, err := h.Google.Exchange(r.Context(), q.Get("code"))
	if err != nil {
		h.Log.Warn("google exchange", "err", err)
		h.redirectLoginError(w, r, "google_failed")
		return
	}
	sess, err := h.GoogleAuth.SignIn(r.Context(), claims)
	switch {
	case errors.Is(err, service.ErrEmailUnverified):
		h.redirectLoginError(w, r, "google_unverified")
		return
	case err != nil:
		h.Log.Error("google sign-in", "err", err)
		h.redirectLoginError(w, r, "google_failed")
		return
	}
	h.setRefreshCookie(w, sess.RefreshToken, sess.RefreshExpiresAt)
	target := h.Cfg.FrontendOrigin + "/auth/callback"
	if next != "" {
		target += "?next=" + url.QueryEscape(next)
	}
	http.Redirect(w, r, target, http.StatusFound)
}

func (h *handlers) clearOAuthState(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: oauthStateCookie, Value: "", Path: "/api/v1/auth/google", MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: h.Cfg.SecureCookies,
	})
}

func (h *handlers) redirectLoginError(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, h.Cfg.FrontendOrigin+"/login?error="+code, http.StatusFound)
}

// sanitizeNext mirrors sanitizeNextUrl in packages/core/paths: a same-origin
// path only, so the callback can never bounce the browser off-site.
func sanitizeNext(raw string) string {
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.HasPrefix(raw, "/\\") {
		return ""
	}
	return raw
}
