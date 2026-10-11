package handler

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
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

// emailHubOAuthScript is the only script the callback page runs. It is a
// constant, so its CSP hash is too, whatever the result (spec §5.4); the
// origin and the result ride in the JSON data block it reads.
const emailHubOAuthScript = `const r=JSON.parse(document.getElementById("r").textContent);` +
	`window.opener?.postMessage({type:"uniwork:email-hub-oauth",ok:r.ok,code:r.code},r.origin);` +
	`window.close();`

// emailHubOAuthCSP allows that one script by hash and nothing else; it
// replaces the API default, so it restates frame-ancestors and base-uri,
// which default-src does not cover.
var emailHubOAuthCSP = func() string {
	sum := sha256.Sum256([]byte(emailHubOAuthScript))
	return "default-src 'none'; script-src 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) +
		"'; frame-ancestors 'none'; base-uri 'none'"
}()

// completeEmailHubOAuth is the provider's redirect target, outside the authed
// group: the sealed state names the member and the nonce cookie ties the flow
// to the browser that started it. It always answers the result page.
func (h *handlers) completeEmailHubOAuth(w http.ResponseWriter, r *http.Request) {
	var nonce string
	if c, err := r.Cookie(emailHubOAuthCookie); err == nil {
		nonce = c.Value
	}
	// Cleared on every branch: one start, one callback.
	http.SetCookie(w, &http.Cookie{
		Name: emailHubOAuthCookie, Value: "", Path: emailHubOAuthCookiePath, MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: h.Cfg.SecureCookies,
	})
	code := service.EmailHubOAuthFailed
	if h.EmailHub != nil && h.EmailHub.Enabled() {
		q := r.URL.Query()
		code = h.EmailHub.CompleteOAuth(r.Context(), chi.URLParam(r, "provider"),
			q.Get("state"), q.Get("code"), q.Get("error"), nonce)
	}
	writeEmailHubOAuthPage(w, h.Cfg.FrontendOrigin, code)
}

// writeEmailHubOAuthPage answers 200 with the postMessage page. json.Marshal
// escapes <, > and &, so no origin or code can close the data block.
func writeEmailHubOAuthPage(w http.ResponseWriter, origin, code string) {
	// Three plain fields: Marshal cannot fail.
	data, _ := json.Marshal(struct {
		Origin string `json:"origin"`
		OK     bool   `json:"ok"`
		Code   string `json:"code"`
	}{Origin: origin, OK: code == service.EmailHubOAuthConnected, Code: code})
	hdr := w.Header()
	hdr.Set("Content-Type", "text/html; charset=utf-8")
	hdr.Set("Cache-Control", "no-store")
	hdr.Set("Content-Security-Policy", emailHubOAuthCSP)
	_, _ = io.WriteString(w, `<!doctype html><html><head><meta charset="utf-8"><title>UniWork</title></head><body>`+
		`<script type="application/json" id="r">`+string(data)+`</script>`+
		`<script>`+emailHubOAuthScript+`</script></body></html>`)
}
