package handler

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// oauthStateCookie carries the sealed googleState between /google/start and
// /google/callback. Lax is what lets the browser send it on the top-level
// GET Google redirects back to.
const oauthStateCookie = "uniwork_oauth_state"

const oauthStateTTL = 10 * time.Minute

// GoogleExchanger is the OIDC round trip; auth.GoogleOAuth in production.
// The authorization request carries the state, the nonce and the PKCE
// verifier's S256 challenge; the exchange sends the verifier and refuses an
// ID token whose nonce is not this sign-in's.
type GoogleExchanger interface {
	AuthCodeURL(state, nonce, verifier string) string
	Exchange(ctx context.Context, code, verifier, nonce string) (auth.GoogleClaims, error)
}

// googleState is the uniwork_oauth_state cookie, sealed for
// oauth_state:google (ADR 0047): the CSRF state, the nonce the ID token must
// echo, the PKCE verifier, where to land after, the intent, and its own
// expiry so a copied cookie value dies with the attempt. A link from
// Settings also carries the account and browser session the link token
// named, and where to go back to.
type googleState struct {
	State    string `json:"state"`
	Nonce    string `json:"nonce"`
	Verifier string `json:"verifier"`
	Next     string `json:"next,omitempty"`
	Intent   string `json:"intent"`
	UserID   string `json:"uid,omitempty"`
	Session  string `json:"sid,omitempty"`
	ReturnTo string `json:"return_to,omitempty"`
	Exp      int64  `json:"exp"`
}

// linkIntent is the link from Settings a state cookie carries.
func (st googleState) linkIntent() service.LinkIntent {
	return service.LinkIntent{UserID: st.UserID, SessionID: st.Session, Provider: service.ProviderGoogle, ReturnTo: st.ReturnTo, ExpectUser: st.UserID}
}

func (h *handlers) googleStart(w http.ResponseWriter, r *http.Request) {
	if h.Google == nil {
		respondError(w, http.StatusServiceUnavailable, "google_not_configured", "Google sign-in is not configured")
		return
	}
	q := r.URL.Query()
	next := sanitizeNext(q.Get("next"))
	intent, ok := webSignInIntent(q.Get("intent"))
	if !ok {
		h.redirectLoginError(w, r, "google_failed", next)
		return
	}
	st := googleState{Next: next, Intent: intent, Exp: time.Now().Add(oauthStateTTL).Unix()}
	if intent == webIntentLink {
		li, ok := h.openBrowserLink(w, r, service.ProviderGoogle, q.Get("link_token"))
		if !ok {
			return
		}
		st.Next, st.UserID, st.Session, st.ReturnTo = "", li.UserID, li.SessionID, li.ReturnTo
	}
	var err error
	for _, v := range []*string{&st.State, &st.Nonce, &st.Verifier} {
		if *v, err = randomHex(32); err != nil {
			h.mapServiceError(w, err)
			return
		}
	}
	sealed, err := h.sealJSON(auth.PurposeOAuthStateGoogle, st)
	if err != nil {
		h.Log.Error("google start: state not sealed", "err", err)
		h.redirectLoginError(w, r, "google_failed", next)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: oauthStateCookie, Value: sealed, Path: "/api/v1/auth/google",
		MaxAge: int(oauthStateTTL / time.Second), HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: h.Cfg.SecureCookies,
	})
	http.Redirect(w, r, h.Google.AuthCodeURL(st.State, st.Nonce, st.Verifier), http.StatusFound)
}

func (h *handlers) googleCallback(w http.ResponseWriter, r *http.Request) {
	h.clearOAuthState(w)
	if h.Google == nil {
		h.redirectLoginError(w, r, "google_failed", "")
		return
	}
	st, ok := h.googleState(r)
	if !ok {
		h.redirectLoginError(w, r, "google_failed", "")
		return
	}
	q := r.URL.Query()
	if st.Intent == webIntentLink {
		// A link from Settings never ends in a sign-in, whatever happens.
		if h.SignInMethods == nil {
			h.redirectLinkResult(w, r, st.ReturnTo, service.ProviderGoogle, service.ErrLinkTokenInvalid)
			return
		}
		h.googleLinkCallback(w, r, st)
		return
	}
	if subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(st.State)) != 1 {
		h.redirectLoginError(w, r, "google_failed", st.Next)
		return
	}
	if e := q.Get("error"); e != "" {
		code := "google_failed"
		if e == "access_denied" {
			code = "google_denied"
		}
		h.redirectLoginError(w, r, code, st.Next)
		return
	}
	claims, err := h.Google.Exchange(r.Context(), q.Get("code"), st.Verifier, st.Nonce)
	if err != nil {
		h.Log.Warn("google exchange", "err", err)
		h.redirectLoginError(w, r, "google_failed", st.Next)
		return
	}
	res, err := h.GoogleAuth.SignIn(h.authCtx(r).Context(), claims, requestLocale(r), st.Intent)
	if err != nil {
		code := webSignInError(service.ProviderGoogle, err)
		var ce service.CodedError
		if errors.As(err, &ce) {
			h.Log.Info("google sign-in refused", "code", ce.Code)
		} else {
			h.Log.Error("google sign-in", "err", err)
		}
		h.redirectLoginError(w, r, code, st.Next)
		return
	}
	h.finishWebSignIn(w, r, res, st.Next)
}

// googleLinkCallback ends a link from Settings (finishBrowserLink): every
// answer goes back to the Settings page that started it with
// sign_in_method=google and a result, never to a sign-in.
func (h *handlers) googleLinkCallback(w http.ResponseWriter, r *http.Request, st googleState) {
	q := r.URL.Query()
	fail := errors.New("google link failed")
	if subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(st.State)) != 1 {
		h.redirectLinkResult(w, r, st.ReturnTo, service.ProviderGoogle, fail)
		return
	}
	if e := q.Get("error"); e != "" {
		if e == "access_denied" {
			fail = errLinkDenied
		}
		h.redirectLinkResult(w, r, st.ReturnTo, service.ProviderGoogle, fail)
		return
	}
	claims, err := h.Google.Exchange(r.Context(), q.Get("code"), st.Verifier, st.Nonce)
	if err != nil {
		h.Log.Warn("google link exchange", "err", err)
		h.redirectLinkResult(w, r, st.ReturnTo, service.ProviderGoogle, fail)
		return
	}
	h.finishBrowserLink(w, r, st.linkIntent(), service.GoogleIdentity(claims))
}

// googleState opens the state cookie; false when it is missing, was not
// sealed by this server for this purpose, or has expired.
func (h *handlers) googleState(r *http.Request) (googleState, bool) {
	c, err := r.Cookie(oauthStateCookie)
	if err != nil {
		return googleState{}, false
	}
	var st googleState
	if err := h.openJSON(auth.PurposeOAuthStateGoogle, c.Value, &st); err != nil {
		return googleState{}, false
	}
	if st.State == "" || st.Nonce == "" || st.Verifier == "" || time.Now().Unix() > st.Exp {
		return googleState{}, false
	}
	st.Next, st.ReturnTo = sanitizeNext(st.Next), sanitizeNext(st.ReturnTo)
	if st.Intent == webIntentLink && (st.UserID == "" || st.Session == "") {
		return googleState{}, false
	}
	return st, true
}

func (h *handlers) clearOAuthState(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: oauthStateCookie, Value: "", Path: "/api/v1/auth/google", MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: h.Cfg.SecureCookies,
	})
}
