package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// web_sign_in.go is where every browser provider sign-in ends (ADR 0047,
// spec §3.4): the provider's callback hands the service's answer to
// finishWebSignIn, which sets the cookie that answer needs and sends the
// browser on with a 303. Every target is built with url.Values, so the
// sanitized next path rides as a parameter and never splices into a query.

// Browser sign-in intents a provider start accepts.
const (
	webIntentSignIn = "sign_in"
	webIntentSignUp = "sign_up"
	// webIntentLink is a link from Settings (spec §3.4): the start carries a
	// link_token, and the round trip ends back on Settings, never in a
	// sign-in.
	webIntentLink = "link"
)

// webSignInIntent reads the start's intent; empty is a sign-in. sign_up
// (the register screen) creates an unmatched identity's account at once
// instead of the choice screen's ticket; link links into the account the
// link token names.
func webSignInIntent(raw string) (string, bool) {
	switch raw {
	case "", webIntentSignIn:
		return service.SignInIntentSignIn, true
	case webIntentSignUp:
		return service.SignInIntentSignUp, true
	case webIntentLink:
		return webIntentLink, true
	default:
		return "", false
	}
}

// defaultLinkReturn is where a link from Settings comes back to when its
// link token named nothing usable.
const defaultLinkReturn = "/settings?tab=security"

// The result codes a link from Settings comes back with (spec §3.4).
const (
	linkResultLinked          = "linked"
	linkResultDenied          = "denied"
	linkResultFailed          = "failed"
	linkResultTaken           = "taken"
	linkResultMovable         = "movable"
	linkResultAlreadyLinked   = "already_linked"
	linkResultSessionMismatch = "session_mismatch"
)

// errLinkDenied: the person said no on the provider's page.
var errLinkDenied = errors.New("link denied at the provider")

// linkResultOf is the result code of a link the service answered.
func linkResultOf(err error) string {
	switch {
	case err == nil:
		return linkResultLinked
	case errors.Is(err, errLinkDenied):
		return linkResultDenied
	case errors.Is(err, service.ErrSignInMethodTaken):
		return linkResultTaken
	case errors.Is(err, service.ErrSignInMethodMovable):
		return linkResultMovable
	case errors.Is(err, service.ErrSignInMethodAlreadyLinked):
		return linkResultAlreadyLinked
	case errors.Is(err, service.ErrLinkSessionMismatch):
		return linkResultSessionMismatch
	default:
		return linkResultFailed
	}
}

// redirectLinkResult sends a link from Settings back to returnTo (a
// sanitized same-origin path) with sign_in_method and result merged into its
// query, and the masked address of the account holding the identity when the
// answer named one (taken, movable).
func (h *handlers) redirectLinkResult(w http.ResponseWriter, r *http.Request, returnTo, provider string, err error) {
	if returnTo == "" {
		returnTo = defaultLinkReturn
	}
	params := url.Values{"sign_in_method": {provider}, "result": {linkResultOf(err)}}
	var ce service.CodedError
	if errors.As(err, &ce) {
		if masked, ok := ce.Fields["masked_email"].(string); ok && masked != "" {
			params.Set("masked_email", masked)
		}
	}
	h.redirectWeb(w, r, returnTo, params)
}

// refreshCookieOf is the browser's uniwork_refresh cookie, which a link from
// Settings holds to the session that started it.
func refreshCookieOf(r *http.Request) string {
	if c, err := r.Cookie(refreshCookie); err == nil {
		return c.Value
	}
	return ""
}

// randomHex is n random bytes, hex: an OAuth state, a nonce or a PKCE
// verifier (64 characters of [0-9a-f] is a valid RFC 7636 verifier).
func randomHex(n int) (string, error) {
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

// sealJSON seals v for one purpose with the server's sealer.
func (h *handlers) sealJSON(purpose string, v any) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return h.Sealer.SealFor(purpose, string(raw))
}

// openJSON opens a blob sealJSON sealed for the same purpose into v.
func (h *handlers) openJSON(purpose, blob string, v any) error {
	raw, err := h.Sealer.OpenFor(purpose, blob)
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(raw), v)
}

// finishWebSignIn answers a provider sign-in the service accepted:
//
//   - no account to sign in to (unmatched, link_required): the ticket in the
//     uniwork_sign_in_ticket cookie, then the choice screen /auth/continue
//     (spec §3.2);
//   - a second factor owed: the challenge in the uniwork_mfa cookie (a
//     redirect has no JSON body, spec F-01 §2 I5), then /login?mfa=1; the
//     challenge carries the identity when it waits to be linked, and POST
//     /auth/mfa/verify links it (or answers link_skipped);
//   - a session: the refresh cookie, then /auth/callback, which reads the
//     session and goes on to next; reclaimed=1 when the sign-in took the
//     account back, for the one-time notice. A pending ticket goes, unless
//     next is the choice screen's link step: this sign-in is the account
//     that ticket is about to be linked into.
func (h *handlers) finishWebSignIn(w http.ResponseWriter, r *http.Request, res service.ProviderSignInResult, next string) {
	sess := res.Session
	params := url.Values{}
	if next != "" {
		params.Set("next", next)
	}
	if res.Ticket != "" {
		h.setSignInTicketCookie(w, res.Ticket)
		h.redirectWeb(w, r, "/auth/continue", params)
		return
	}
	if sess.MFAPending() {
		h.setMFACookie(w, sess.MFAToken)
		params.Set("mfa", "1")
		h.redirectWeb(w, r, "/login", params)
		return
	}
	h.setRefreshCookie(w, sess.RefreshToken, sess.RefreshExpiresAt)
	if !keepsSignInTicket(next) {
		h.clearSignInTicket(w)
	}
	if res.Reclaimed {
		params.Set("reclaimed", "1")
	}
	h.redirectWeb(w, r, "/auth/callback", params)
}

// redirectLoginError sends a failed browser sign-in to /login with its code
// (spec §3.4), keeping next so the person lands where they were going once
// they sign in another way.
func (h *handlers) redirectLoginError(w http.ResponseWriter, r *http.Request, code, next string) {
	params := url.Values{"error": {code}}
	if next != "" {
		params.Set("next", next)
	}
	h.redirectWeb(w, r, "/login", params)
}

// redirectWeb answers 303 to a frontend path, its parameters merged into
// whatever query the path already carries.
func (h *handlers) redirectWeb(w http.ResponseWriter, r *http.Request, path string, params url.Values) {
	target, err := url.Parse(h.Cfg.FrontendOrigin + path)
	if err != nil {
		target, _ = url.Parse(h.Cfg.FrontendOrigin + "/login")
	}
	q := target.Query()
	for k, vs := range params {
		q[k] = vs
	}
	target.RawQuery = q.Encode()
	http.Redirect(w, r, target.String(), http.StatusSeeOther)
}

// webSignInError is the /login code of a sign-in the service refused (spec
// §3.4): the shared resolver's refusals by their code, anything else the
// provider's own failure.
func webSignInError(provider string, err error) string {
	var ce service.CodedError
	if errors.As(err, &ce) {
		switch ce.Code {
		case "sign_in_email_unverified":
			if provider == service.ProviderGoogle {
				return "google_unverified"
			}
			return "sign_in_unverified"
		case "sign_in_account_unverified":
			return "sign_in_account_unverified"
		case "sign_in_account_conflict":
			return "sign_in_conflict"
		}
	}
	return provider + "_failed"
}

// sanitizeNext mirrors sanitizeNextUrl in packages/core/paths: a same-origin
// path only, so the callback can never bounce the browser off-site.
func sanitizeNext(raw string) string {
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.HasPrefix(raw, "/\\") {
		return ""
	}
	return raw
}
