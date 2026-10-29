package handler

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Sign in with Apple on the web (ADR 0049 §7, spec §3.4) takes three steps:
//
//   - GET /auth/apple/start seals the state into uniwork_apple_state and
//     sends the browser to Apple;
//   - Apple posts its answer to POST /auth/apple/callback from its own site
//     (response_mode=form_post), where no SameSite=Lax cookie arrives: the
//     callback only checks the state, redeems the code and checks the
//     identity token, then leaves what it proved in uniwork_apple_result;
//   - GET /auth/apple/finish, a top-level navigation the callback's 303
//     starts, carries the Lax cookies again (uniwork_refresh, the sign-in
//     ticket), so the sign-in or the link from Settings ends there, through
//     finishWebSignIn or finishBrowserLink like Google's.
//
// Both Apple cookies cross a cross-site POST, so they are SameSite=None,
// which browsers take only Secure: they are Secure always, and Sign in with
// Apple on the web works over https only (Apple takes no other return URL).
const (
	appleStateCookie  = "uniwork_apple_state"
	appleResultCookie = "uniwork_apple_result"
	appleCookiePath   = "/api/v1/auth/apple"
	appleFinishPath   = "/api/v1/auth/apple/finish"
	// appleResultTTL is the callback's result's life: the 303 to the finish
	// follows at once.
	appleResultTTL = 2 * time.Minute
	// appleCallbackMaxBody caps Apple's form post: a code, the state, an
	// error, and the user field's name and address.
	appleCallbackMaxBody = 64 << 10
)

// The error Apple posts when the person cancels on its page.
const appleCancelled = "user_cancelled_authorize"

// appleFlow is what one browser's Apple round trip carries from the start to
// the finish: where to land after and the intent; a link from Settings also
// carries the account and browser session its link token named, the end of
// the step-up that started it, and the page to go back to.
type appleFlow struct {
	Next     string `json:"next,omitempty"`
	Intent   string `json:"intent"`
	UserID   string `json:"uid,omitempty"`
	Session  string `json:"sid,omitempty"`
	ProofExp int64  `json:"proof_exp,omitempty"`
	ReturnTo string `json:"return_to,omitempty"`
}

// linkIntent is the link from Settings the flow carries.
func (f appleFlow) linkIntent() service.LinkIntent {
	return service.LinkIntent{
		UserID: f.UserID, SessionID: f.Session, Provider: service.ProviderApple, ReturnTo: f.ReturnTo,
		ExpectUser: f.UserID, ProofExpiresAt: f.ProofExp,
	}
}

// checked is the flow as a cookie may carry it: paths same-origin, an
// intent the start takes, and a link naming its account and session.
func (f appleFlow) checked() (appleFlow, bool) {
	f.Next, f.ReturnTo = sanitizeNext(f.Next), sanitizeNext(f.ReturnTo)
	switch f.Intent {
	case service.SignInIntentSignIn, service.SignInIntentSignUp:
		return f, true
	case webIntentLink:
		return f, f.UserID != "" && f.Session != ""
	default:
		return appleFlow{}, false
	}
}

// appleState is the uniwork_apple_state cookie, sealed for
// oauth_state:apple: the CSRF state Apple posts back, the raw nonce whose
// hash the identity token must carry (it never leaves the server in clear),
// the flow, and its own expiry so a copied value dies with the attempt.
type appleState struct {
	State string    `json:"state"`
	Nonce string    `json:"nonce"`
	Flow  appleFlow `json:"flow"`
	Exp   int64     `json:"exp"`
}

// appleResult is the uniwork_apple_result cookie, sealed for
// apple_web_result: the identity the callback proved (the Apple consent
// sealed inside it) and the flow, for the finish to act on once.
type appleResult struct {
	Identity service.ProviderIdentity `json:"identity"`
	Flow     appleFlow                `json:"flow"`
	Exp      int64                    `json:"exp"`
}

// appleStart sends the browser to Apple's authorization page with a fresh
// state and nonce, sealed in uniwork_apple_state. intent=link starts a link
// from Settings, only from the browser session its link token names.
func (h *handlers) appleStart(w http.ResponseWriter, r *http.Request) {
	if !h.AppleAuth.WebEnabled() {
		respondError(w, http.StatusServiceUnavailable, "apple_not_configured", "Sign in with Apple on the web is not configured")
		return
	}
	q := r.URL.Query()
	next := sanitizeNext(q.Get("next"))
	intent, ok := webSignInIntent(q.Get("intent"))
	if !ok {
		h.redirectLoginError(w, r, "apple_failed", next)
		return
	}
	st := appleState{Flow: appleFlow{Next: next, Intent: intent}, Exp: time.Now().Add(oauthStateTTL).Unix()}
	if intent == webIntentLink {
		li, ok := h.openBrowserLink(w, r, service.ProviderApple, q.Get("link_token"))
		if !ok {
			return
		}
		st.Flow = appleFlow{Intent: intent, UserID: li.UserID, Session: li.SessionID, ProofExp: li.ProofExpiresAt, ReturnTo: li.ReturnTo}
	}
	var err error
	for _, v := range []*string{&st.State, &st.Nonce} {
		if *v, err = randomHex(32); err != nil {
			h.mapServiceError(w, err)
			return
		}
	}
	sealed, err := h.sealJSON(auth.PurposeOAuthStateApple, st)
	if err != nil {
		h.Log.Error("apple start: state not sealed", "err", err)
		h.appleFailed(w, r, st.Flow, "apple_failed")
		return
	}
	setAppleCookie(w, appleStateCookie, sealed, oauthStateTTL)
	http.Redirect(w, r, h.AppleAuth.WebAuthorizeURL(st.State, st.Nonce), http.StatusFound)
}

// appleCallback is Apple's form post. The state cookie goes whatever
// happens. Nothing here signs in: the browser sent no Lax cookie on this
// cross-site POST, so what the code proved waits in uniwork_apple_result for
// the same-site finish.
func (h *handlers) appleCallback(w http.ResponseWriter, r *http.Request) {
	setAppleCookie(w, appleStateCookie, "", 0)
	st, ok := h.appleState(r)
	if !ok || !h.AppleAuth.WebEnabled() {
		h.redirectLoginError(w, r, "apple_failed", "")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, appleCallbackMaxBody)
	if err := r.ParseForm(); err != nil {
		h.appleFailed(w, r, st.Flow, "apple_failed")
		return
	}
	form := r.PostForm
	if subtle.ConstantTimeCompare([]byte(form.Get("state")), []byte(st.State)) != 1 {
		h.appleFailed(w, r, st.Flow, "apple_failed")
		return
	}
	if e := form.Get("error"); e != "" {
		code := "apple_failed"
		if e == appleCancelled {
			code = "apple_denied"
		}
		h.appleFailed(w, r, st.Flow, code)
		return
	}
	id, err := h.AppleAuth.WebIdentity(r.Context(), form.Get("code"), st.Nonce, form.Get("user"))
	if err != nil {
		h.Log.Warn("apple web sign-in refused", "err", err)
		h.appleFailed(w, r, st.Flow, "apple_failed")
		return
	}
	sealed, err := h.sealJSON(auth.PurposeAppleWebResult, appleResult{Identity: id, Flow: st.Flow, Exp: time.Now().Add(appleResultTTL).Unix()})
	if err != nil {
		h.Log.Error("apple callback: result not sealed", "err", err)
		h.appleFailed(w, r, st.Flow, "apple_failed")
		return
	}
	setAppleCookie(w, appleResultCookie, sealed, appleResultTTL)
	http.Redirect(w, r, appleFinishPath, http.StatusSeeOther)
}

// appleFinish ends the round trip on a same-site navigation: the result
// cookie goes, then a link from Settings links (finishBrowserLink, which
// checks the browser session again) and anything else signs in
// (finishWebSignIn: a session, the second step, or the choice screen).
func (h *handlers) appleFinish(w http.ResponseWriter, r *http.Request) {
	setAppleCookie(w, appleResultCookie, "", 0)
	res, ok := h.appleResult(r)
	if !ok || !h.AppleAuth.WebEnabled() {
		h.redirectLoginError(w, r, "apple_failed", "")
		return
	}
	if res.Flow.Intent == webIntentLink {
		h.finishBrowserLink(w, r, res.Flow.linkIntent(), res.Identity)
		return
	}
	out, err := h.AppleAuth.WebSignIn(h.authCtx(r).Context(), res.Identity, requestLocale(r), res.Flow.Intent)
	if err != nil {
		var ce service.CodedError
		if errors.As(err, &ce) {
			h.Log.Info("apple sign-in refused", "code", ce.Code)
		} else {
			h.Log.Error("apple sign-in", "err", err)
		}
		h.redirectLoginError(w, r, webSignInError(service.ProviderApple, err), res.Flow.Next)
		return
	}
	h.finishWebSignIn(w, r, out, res.Flow.Next)
}

// appleFailed ends a round trip that proved no one: a link from Settings
// goes back to its page (result denied or failed), a sign-in to /login
// with the code, next kept.
func (h *handlers) appleFailed(w http.ResponseWriter, r *http.Request, f appleFlow, code string) {
	if f.Intent != webIntentLink {
		h.redirectLoginError(w, r, code, f.Next)
		return
	}
	err := errors.New("apple link failed")
	if code == "apple_denied" {
		err = errLinkDenied
	}
	h.redirectLinkResult(w, r, f.ReturnTo, service.ProviderApple, err)
}

// appleState opens the state cookie; false when it is missing, was not
// sealed by this server for this purpose, or has expired.
func (h *handlers) appleState(r *http.Request) (appleState, bool) {
	c, err := r.Cookie(appleStateCookie)
	if err != nil {
		return appleState{}, false
	}
	var st appleState
	if err := h.openJSON(auth.PurposeOAuthStateApple, c.Value, &st); err != nil {
		return appleState{}, false
	}
	if st.State == "" || st.Nonce == "" || time.Now().Unix() > st.Exp {
		return appleState{}, false
	}
	var ok bool
	st.Flow, ok = st.Flow.checked()
	return st, ok
}

// appleResult opens the result cookie the callback left; false when it is
// missing, not this server's for this purpose, expired, or names no Apple
// identity.
func (h *handlers) appleResult(r *http.Request) (appleResult, bool) {
	c, err := r.Cookie(appleResultCookie)
	if err != nil {
		return appleResult{}, false
	}
	var res appleResult
	if err := h.openJSON(auth.PurposeAppleWebResult, c.Value, &res); err != nil {
		return appleResult{}, false
	}
	if res.Identity.Provider != service.ProviderApple || res.Identity.Subject == "" || time.Now().Unix() > res.Exp {
		return appleResult{}, false
	}
	var ok bool
	res.Flow, ok = res.Flow.checked()
	return res, ok
}

// setAppleCookie writes one of the Apple cookies: HttpOnly, sent only to
// the Apple routes, SameSite=None and so Secure always. An empty value
// clears it.
func setAppleCookie(w http.ResponseWriter, name, value string, ttl time.Duration) {
	c := &http.Cookie{
		Name: name, Value: value, Path: appleCookiePath, MaxAge: int(ttl / time.Second),
		HttpOnly: true, SameSite: http.SameSiteNoneMode, Secure: true,
	}
	if value == "" {
		c.MaxAge = -1
	}
	http.SetCookie(w, c)
}
