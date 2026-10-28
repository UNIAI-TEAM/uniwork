package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// browserAccount registers a verified password account and answers its
// access token, id and the browser's uniwork_refresh cookie.
func browserAccount(t *testing.T, srv *httptest.Server, email string) (string, string, *http.Cookie) {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": email, "password": "password123", "display_name": "Browser",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)
	return token, out["user"].(map[string]any)["id"].(string), cookieNamed(res, refreshCookie)
}

// getWith sends a top-level GET carrying cookies and does not follow the
// redirect.
func getWith(t *testing.T, srv *httptest.Server, target string, cookies ...*http.Cookie) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, srv.URL+target, nil)
	for _, c := range cookies {
		if c != nil {
			req.AddCookie(c)
		}
	}
	res, err := noRedirectClient(srv).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// linkResult reads where a link from Settings came back to.
func linkResult(t *testing.T, res *http.Response) (string, url.Values) {
	t.Helper()
	if res.StatusCode != http.StatusSeeOther {
		t.Fatalf("status %d, want 303 back to Settings (%q)", res.StatusCode, res.Header.Get("Location"))
	}
	loc, err := url.Parse(res.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	return loc.Path, loc.Query()
}

// A link from Settings goes through the browser that is signed in (ADR 0049
// §6, spec §3.4): the bearer command, with a step-up token, answers the
// provider's start carrying a five-minute link token bound to the account
// and the browser session. The start goes to the provider only when this
// browser's refresh cookie opens that very session; the callback checks it
// again before it links (the cookie may have changed during the round
// trip). Anything else comes back to Settings with result=session_mismatch
// and links nothing.
func TestLinkStartNeedsTheSameBrowserSession(t *testing.T) {
	g := &fakeGoogle{}
	srv := newTestServerWithGoogle(t, g)
	token, uid, refresh := browserAccount(t, srv, "an@acme.vn")
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/login", "", map[string]string{"email": "an@acme.vn", "password": "password123"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("second browser: %d %v", res.StatusCode, out)
	}
	otherBrowser := cookieNamed(res, refreshCookie)

	res, out = doJSON(t, srv, "POST", "/api/v1/me/sign-in-methods/google/link", token, map[string]string{"return_to": "/acme/team/settings?tab=security"})
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "proof_required" {
		t.Fatalf("link without a proof: %d %v", res.StatusCode, out)
	}
	proof := stepUp(t, srv, token, map[string]any{"password": "password123"})
	res, out = doJSON(t, srv, "POST", "/api/v1/me/sign-in-methods/google/link", token, map[string]string{
		"step_up_token": proof, "return_to": "/acme/team/settings?tab=security",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("link: %d %v", res.StatusCode, out)
	}
	start, err := url.Parse(out["authorization_url"].(string))
	if err != nil || start.Path != "/api/v1/auth/google/start" || start.Query().Get("intent") != "link" || start.Query().Get("link_token") == "" {
		t.Fatalf("authorization_url %q", out["authorization_url"])
	}
	startPath := start.Path + "?" + start.RawQuery

	for why, cookie := range map[string]*http.Cookie{"no session": nil, "another session": otherBrowser} {
		res := getWith(t, srv, startPath, cookie)
		path, q := linkResult(t, res)
		if path != "/acme/team/settings" || q.Get("tab") != "security" || q.Get("sign_in_method") != "google" || q.Get("result") != "session_mismatch" {
			t.Fatalf("start with %s: %q", why, res.Header.Get("Location"))
		}
		if cookieNamed(res, oauthStateCookie) != nil {
			t.Fatalf("start with %s set a state", why)
		}
	}
	if path, q := linkResult(t, getWith(t, srv, "/api/v1/auth/google/start?intent=link&link_token=forged", refresh)); path != "/settings" || q.Get("result") != "failed" {
		t.Fatalf("a forged link token: %s %v", path, q)
	}

	res = getWith(t, srv, startPath, refresh)
	if res.StatusCode != http.StatusFound || !strings.HasPrefix(res.Header.Get("Location"), "https://accounts.google.test/") {
		t.Fatalf("start from the right browser: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
	state := cookieNamed(res, oauthStateCookie)
	st := openGoogleState(t, state)
	if st.Intent != webIntentLink || st.UserID != uid || st.Session == "" || st.ReturnTo != "/acme/team/settings?tab=security" {
		t.Fatalf("state %+v", st)
	}

	g.set(auth.GoogleClaims{Sub: "g-settings", Email: "an.personal@gmail.com", EmailVerified: true, Name: "An"})
	callback := "/api/v1/auth/google/callback?code=good&state=" + st.State
	q := db.New(testPool)
	for why, cookie := range map[string]*http.Cookie{"no session": nil, "another session": otherBrowser} {
		path, values := linkResult(t, getWith(t, srv, callback, state, cookie))
		if path != "/acme/team/settings" || values.Get("result") != "session_mismatch" {
			t.Fatalf("callback with %s: %s %v", why, path, values)
		}
		if u, _ := q.GetUserByID(context.Background(), uid); u.GoogleID.Valid {
			t.Fatalf("callback with %s linked", why)
		}
	}
	res = getWith(t, srv, callback, state, refresh)
	if path, values := linkResult(t, res); path != "/acme/team/settings" || values.Get("result") != "linked" || values.Get("sign_in_method") != "google" {
		t.Fatalf("callback from the right browser: %s %v", path, values)
	}
	if cookieNamed(res, refreshCookie) != nil {
		t.Fatal("a link from Settings is not a sign-in: no session cookie")
	}
	if u, _ := q.GetUserByID(context.Background(), uid); u.GoogleID.String != "g-settings" || u.GoogleEmail.String != "an.personal@gmail.com" {
		t.Fatalf("not linked: %+v", u)
	}
	var via string
	if err := testPool.QueryRow(context.Background(), `SELECT metadata::jsonb->>'via' FROM audit_events
		WHERE action = 'auth.sign_in_method_linked' AND actor_id = $1`, uid).Scan(&via); err != nil || via != "settings" {
		t.Fatalf("link audit via %q (%v)", via, err)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/me/sign-in-methods/google/link", token, map[string]string{"step_up_token": proof})
	if res.StatusCode != http.StatusConflict || errorCode(out) != "sign_in_method_already_linked" {
		t.Fatalf("link twice: %d %v", res.StatusCode, out)
	}
}

// When the Google account a person links from Settings already opens an
// empty account, the callback comes back with result=movable and the masked
// address, and leaves the proved identity as a ticket bound to the browser
// session that started the link, so Settings confirms the move without
// another trip to Google and without asking that session for a proof again
// (spec §3.7). Another session of the same account still needs one.
func TestSettingsLinkOffersToMoveFromAnEmptyAccount(t *testing.T) {
	g := &fakeGoogle{}
	srv := newTestServerWithGoogle(t, g)
	token, uid, refresh := browserAccount(t, srv, "binh@acme.vn")
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/login", "", map[string]string{"email": "binh@acme.vn", "password": "password123"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("second browser: %d %v", res.StatusCode, out)
	}
	otherToken := out["access_token"].(string)
	// Both sessions are older than the ticket the callback will leave:
	// freshness alone does not prove the account.
	if _, err := testPool.Exec(context.Background(), `UPDATE refresh_tokens SET created_at = now() - interval '1 hour' WHERE user_id = $1`, uid); err != nil {
		t.Fatal(err)
	}
	seedGoogleAccount(t, "01EMPTYGOOGLEHOLDER0000000", "binh.personal@gmail.com", "g-empty")
	proof := stepUp(t, srv, token, map[string]any{"password": "password123"})
	_, out = doJSON(t, srv, "POST", "/api/v1/me/sign-in-methods/google/link", token, map[string]string{"step_up_token": proof})
	start, _ := url.Parse(out["authorization_url"].(string))
	res = getWith(t, srv, start.Path+"?"+start.RawQuery, refresh)
	state := cookieNamed(res, oauthStateCookie)
	st := openGoogleState(t, state)
	g.set(auth.GoogleClaims{Sub: "g-empty", Email: "binh.personal@gmail.com", EmailVerified: true})
	res = getWith(t, srv, "/api/v1/auth/google/callback?code=good&state="+st.State, state, refresh)
	path, values := linkResult(t, res)
	if path != "/settings" || values.Get("result") != "movable" || values.Get("masked_email") != "b•••@gmail.com" {
		t.Fatalf("callback: %s %v", path, values)
	}
	ticket := cookieNamed(res, signInTicketCookie)
	if ticket == nil || ticket.Value == "" {
		t.Fatal("no ticket to confirm the move with")
	}
	res, out = ticketRequest(t, srv, http.MethodPost, "/api/v1/auth/sign-in-ticket/link", otherToken, []*http.Cookie{ticket}, map[string]any{"move": true})
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "proof_required" {
		t.Fatalf("a move from another, older session: %d %v", res.StatusCode, out)
	}
	res, out = ticketRequest(t, srv, http.MethodPost, "/api/v1/auth/sign-in-ticket/link", token, []*http.Cookie{ticket}, map[string]any{"move": true})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("the move from the session that started the link: %d %v", res.StatusCode, out)
	}
	if u, _ := db.New(testPool).GetUserByID(context.Background(), uid); u.GoogleID.String != "g-empty" {
		t.Fatalf("not moved: %+v", u)
	}
}

// Over the wire a wrong proof is a 403 with its own code, never the 401 a
// client reads as an expired session; the methods list says which proofs
// the account takes; a first password needs a step-up, a change the
// current one.
func TestStepUpAndPasswordOverHTTP(t *testing.T) {
	srv := newTestServer(t)
	token, _, _ := browserAccount(t, srv, "chi@acme.vn")
	res, out := doJSON(t, srv, "GET", "/api/v1/me/sign-in-methods", token, nil)
	if res.StatusCode != http.StatusOK || out["password"].(map[string]any)["set"] != true {
		t.Fatalf("methods: %d %v", res.StatusCode, out)
	}
	if proofs := out["proofs"].([]any); len(proofs) != 2 || proofs[0] != "password" || proofs[1] != "email_code" {
		t.Fatalf("proofs: %v", proofs)
	}
	for body, code := range map[string]string{`{"password":"wrong"}`: "password_incorrect", `{}`: "proof_required"} {
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/me/step-up", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := readAll(res)
		if res.StatusCode != http.StatusForbidden || !strings.Contains(string(raw), `"`+code+`"`) {
			t.Fatalf("step-up %s: %d %s", body, res.StatusCode, raw)
		}
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/me/step-up/email-code", token, map[string]string{"action": "unknown"})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("an unknown action: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/me/mfa/setup", token, nil)
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "proof_required" {
		t.Fatalf("setup without a proof: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", "/api/v1/me/password", token, map[string]string{"new_password": "brand-new-pass-1", "current_password": "nope"})
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "password_incorrect" {
		t.Fatalf("a wrong current password: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", "/api/v1/me/password", token, map[string]string{"new_password": "brand-new-pass-1", "current_password": "password123"})
	if res.StatusCode != http.StatusOK || out["sign_in_methods"].(map[string]any)["password"].(map[string]any)["changed_at"] == nil {
		t.Fatalf("change: %d %v", res.StatusCode, out)
	}
}
