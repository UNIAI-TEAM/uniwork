package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
)

// fakeGoogle stands in for the OIDC round trip: "good" yields the configured
// claims, anything else fails like a rejected code. It remembers the PKCE
// verifier and nonce the exchange was handed, which only the sealed state
// cookie carries.
type fakeGoogle struct {
	claims auth.GoogleClaims
	mu     sync.Mutex
	got    struct{ verifier, nonce string }
}

func (f *fakeGoogle) AuthCodeURL(state, nonce, verifier string) string {
	q := url.Values{"state": {state}, "nonce": {nonce}, "code_challenge_method": {"S256"}, "code_challenge": {"c(" + verifier + ")"}}
	return "https://accounts.google.test/auth?" + q.Encode()
}

func (f *fakeGoogle) Exchange(_ context.Context, code, verifier, nonce string) (auth.GoogleClaims, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.got.verifier, f.got.nonce = verifier, nonce
	if code != "good" {
		return auth.GoogleClaims{}, errors.New("invalid_grant")
	}
	return f.claims, nil
}

// set changes the claims the next exchange answers.
func (f *fakeGoogle) set(c auth.GoogleClaims) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.claims = c
}

// seen is what the last exchange was handed.
func (f *fakeGoogle) seen() (verifier, nonce string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.got.verifier, f.got.nonce
}

func noRedirectClient(srv *httptest.Server) *http.Client {
	c := *srv.Client()
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &c
}

func cookieNamed(res *http.Response, name string) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

// testSealer is the sealer newTestDeps wires (keyed from the test JWT secret).
func testSealer(t *testing.T) auth.SecretSealer {
	t.Helper()
	s, err := auth.NewSecretSealer([]byte("test"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// openGoogleState reads the sealed state cookie the way the callback does.
func openGoogleState(t *testing.T, c *http.Cookie) googleState {
	t.Helper()
	raw, err := testSealer(t).OpenFor(auth.PurposeOAuthStateGoogle, c.Value)
	if err != nil {
		t.Fatalf("the state cookie opens for oauth_state:google: %v", err)
	}
	var st googleState
	if err := json.Unmarshal([]byte(raw), &st); err != nil {
		t.Fatal(err)
	}
	return st
}

func TestGoogleStartIs503WhenNotConfigured(t *testing.T) {
	srv := newTestServer(t)
	res, err := noRedirectClient(srv).Get(srv.URL + "/api/v1/auth/google/start")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 503 {
		t.Fatalf("status = %d, want 503", res.StatusCode)
	}
}

// The start seals everything the callback checks into one cookie (ADR 0049):
// the CSRF state, the nonce Google must echo in the ID token, and the PKCE
// verifier whose S256 challenge goes to Google. None of it is readable or
// forgeable in the browser.
func TestGoogleStartSealsStateNonceAndVerifierAndRedirects(t *testing.T) {
	srv := newTestServerWithGoogle(t, &fakeGoogle{})
	res, err := noRedirectClient(srv).Get(srv.URL + "/api/v1/auth/google/start?next=/acme/team&intent=sign_up")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want 302", res.StatusCode)
	}
	loc, _ := url.Parse(res.Header.Get("Location"))
	c := cookieNamed(res, oauthStateCookie)
	if c == nil || !c.HttpOnly || c.Path != "/api/v1/auth/google" || c.SameSite != http.SameSiteLaxMode || c.MaxAge != 600 {
		t.Fatalf("state cookie = %+v", c)
	}
	st := openGoogleState(t, c)
	if loc.Host != "accounts.google.test" || len(st.State) != 64 || loc.Query().Get("state") != st.State {
		t.Fatalf("location %s, state %+v", loc, st)
	}
	if loc.Query().Get("nonce") != st.Nonce || len(st.Nonce) != 64 || loc.Query().Get("code_challenge") != "c("+st.Verifier+")" || len(st.Verifier) != 64 {
		t.Fatalf("nonce and PKCE: location %s, state %+v", loc, st)
	}
	if st.Next != "/acme/team" || st.Intent != "sign_up" || st.Exp <= time.Now().Unix() {
		t.Fatalf("state = %+v", st)
	}
	for _, clear := range []string{st.State, st.Nonce, st.Verifier, "/acme/team"} {
		if strings.Contains(c.Value, clear) {
			t.Fatalf("the cookie carries %q in clear", clear)
		}
	}
	if _, err := testSealer(t).OpenFor(auth.PurposeLinkToken, c.Value); err == nil {
		t.Fatal("the state cookie opened as another purpose")
	}
	// Without an intent it is a sign-in.
	res, _ = noRedirectClient(srv).Get(srv.URL + "/api/v1/auth/google/start")
	if st := openGoogleState(t, cookieNamed(res, oauthStateCookie)); st.Intent != "sign_in" || st.Next != "" {
		t.Fatalf("default state = %+v", st)
	}
}

func TestGoogleStartDropsUnsafeNext(t *testing.T) {
	srv := newTestServerWithGoogle(t, &fakeGoogle{})
	for _, next := range []string{"//evil.example", "https://evil.example", "/\\evil"} {
		res, _ := noRedirectClient(srv).Get(srv.URL + "/api/v1/auth/google/start?next=" + url.QueryEscape(next))
		if st := openGoogleState(t, cookieNamed(res, oauthStateCookie)); st.Next != "" {
			t.Fatalf("next %q leaked into the state %+v", next, st)
		}
	}
}

// An intent the start does not know is refused on the login page, next kept.
func TestGoogleStartRefusesAnUnknownIntent(t *testing.T) {
	srv := newTestServerWithGoogle(t, &fakeGoogle{})
	res, _ := noRedirectClient(srv).Get(srv.URL + "/api/v1/auth/google/start?intent=merge&next=/acme/team")
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "http://localhost:3000/login?error=google_failed&next=%2Facme%2Fteam" {
		t.Fatalf("status = %d location = %q", res.StatusCode, res.Header.Get("Location"))
	}
	if cookieNamed(res, oauthStateCookie) != nil {
		t.Fatal("no state for a refused start")
	}
}

func googleCallback(t *testing.T, srv *httptest.Server, query string, cookie *http.Cookie) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/auth/google/callback?"+query, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res, err := noRedirectClient(srv).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func googleStart(t *testing.T, srv *httptest.Server, next string) (*http.Cookie, googleState) {
	t.Helper()
	return googleStartWith(t, srv, next, "")
}

// googleStartWith starts with an intent (sign_up from the register screen).
func googleStartWith(t *testing.T, srv *httptest.Server, next, intent string) (*http.Cookie, googleState) {
	t.Helper()
	q := url.Values{"next": {next}}
	if intent != "" {
		q.Set("intent", intent)
	}
	start, err := noRedirectClient(srv).Get(srv.URL + "/api/v1/auth/google/start?" + q.Encode())
	if err != nil {
		t.Fatal(err)
	}
	c := cookieNamed(start, oauthStateCookie)
	return c, openGoogleState(t, c)
}

// seedGoogleAccount is an account Google already opens (google_id set).
func seedGoogleAccount(t *testing.T, id, email, sub string) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), `INSERT INTO users (id, email, display_name, google_id, google_email, email_verified_at, locale)
		VALUES ($1, $2, 'G', $3, $2, now(), 'en')`, id, email, sub); err != nil {
		t.Fatal(err)
	}
}

func TestGoogleCallbackSignsInAndRedirectsToWeb(t *testing.T) {
	g := &fakeGoogle{claims: auth.GoogleClaims{Sub: "sub-1", Email: "g@gmail.com", EmailVerified: true, Name: "G"}}
	srv := newTestServerWithGoogle(t, g)
	seedGoogleAccount(t, "01GOOGLESIGNSIN", "g@gmail.com", "sub-1")
	cookie, st := googleStart(t, srv, "/acme/team")

	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/auth/google/callback?code=good&state="+st.State, nil)
	req.AddCookie(cookie)
	// A ticket an earlier sign-in left goes with this one.
	req.AddCookie(&http.Cookie{Name: signInTicketCookie, Value: "stale"})
	res, err := noRedirectClient(srv).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusSeeOther {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if got := res.Header.Get("Location"); got != "http://localhost:3000/auth/callback?next=%2Facme%2Fteam" {
		t.Fatalf("location = %q", got)
	}
	if c := cookieNamed(res, signInTicketCookie); c == nil || c.MaxAge >= 0 {
		t.Fatalf("a sign-in drops the pending ticket: %+v", c)
	}
	if verifier, nonce := g.seen(); verifier != st.Verifier || nonce != st.Nonce {
		t.Fatalf("the exchange is handed the sealed verifier and nonce: %q %q, state %+v", verifier, nonce, st)
	}
	refresh := cookieNamed(res, refreshCookie)
	if refresh == nil || refresh.Value == "" || !refresh.HttpOnly {
		t.Fatalf("refresh cookie = %+v", refresh)
	}
	if c := cookieNamed(res, oauthStateCookie); c == nil || c.MaxAge >= 0 {
		t.Fatalf("state cookie must be cleared, got %+v", c)
	}
	// The refresh cookie starts a normal session.
	req, _ = http.NewRequest("POST", srv.URL+"/api/v1/auth/refresh", nil)
	req.AddCookie(refresh)
	res2, _ := srv.Client().Do(req)
	if res2.StatusCode != 200 {
		t.Fatalf("refresh with google session: %d", res2.StatusCode)
	}
}

// Taking an account back from whoever registered the address first lands
// with reclaimed=1, for the one-time notice.
func TestGoogleCallbackSaysAReclaimHappened(t *testing.T) {
	srv := newTestServerWithGoogle(t, &fakeGoogle{claims: auth.GoogleClaims{Sub: "sub-r", Email: "taken@gmail.com", EmailVerified: true}})
	if res := postJSON(t, srv, "/api/v1/auth/register", map[string]string{"email": "taken@gmail.com", "password": "password123", "display_name": "Squatter"}); res.StatusCode != 200 {
		t.Fatalf("register: %d", res.StatusCode)
	}
	cookie, st := googleStart(t, srv, "")
	res := googleCallback(t, srv, "code=good&state="+st.State, cookie)
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "http://localhost:3000/auth/callback?reclaimed=1" || cookieNamed(res, refreshCookie) == nil {
		t.Fatalf("status = %d location = %q", res.StatusCode, res.Header.Get("Location"))
	}
	if res := postJSON(t, srv, "/api/v1/auth/login", map[string]string{"email": "taken@gmail.com", "password": "password123"}); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("the squatter's password still signs in: %d", res.StatusCode)
	}
}

// An account with a second factor gets its challenge in the uniwork_mfa
// cookie and the login page's second step, next kept.
func TestGoogleCallbackSendsAnMFAAccountToTheSecondStep(t *testing.T) {
	g := &fakeGoogle{claims: auth.GoogleClaims{Sub: "sub-m", Email: "m@gmail.com", EmailVerified: true}}
	srv := newTestServerWithGoogle(t, g)
	cookie, st := googleStartWith(t, srv, "", "sign_up")
	if res := googleCallback(t, srv, "code=good&state="+st.State, cookie); res.StatusCode != http.StatusSeeOther || cookieNamed(res, refreshCookie) == nil {
		t.Fatalf("first sign-in: %d", res.StatusCode)
	}
	if _, err := testPool.Exec(context.Background(), `UPDATE users SET mfa_enabled_at = now() WHERE google_id = 'sub-m'`); err != nil {
		t.Fatal(err)
	}
	cookie, st = googleStart(t, srv, "/acme/team")
	res := googleCallback(t, srv, "code=good&state="+st.State, cookie)
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "http://localhost:3000/login?mfa=1&next=%2Facme%2Fteam" {
		t.Fatalf("status = %d location = %q", res.StatusCode, res.Header.Get("Location"))
	}
	if c := cookieNamed(res, mfaCookie); c == nil || c.Value == "" || !c.HttpOnly {
		t.Fatalf("mfa cookie = %+v", c)
	}
	if cookieNamed(res, refreshCookie) != nil {
		t.Fatal("no session before the second factor")
	}
}

func TestGoogleCallbackErrorsRedirectToLogin(t *testing.T) {
	g := &fakeGoogle{claims: auth.GoogleClaims{Sub: "s", Email: "u@gmail.com", EmailVerified: false}}
	srv := newTestServerWithGoogle(t, g)
	state, st := googleStart(t, srv, "/acme/team")
	sealer := testSealer(t)
	reseal := func(purpose string, mutate func(*googleState)) *http.Cookie {
		cp := st
		mutate(&cp)
		raw, _ := json.Marshal(cp)
		v, err := sealer.SealFor(purpose, string(raw))
		if err != nil {
			t.Fatal(err)
		}
		return &http.Cookie{Name: oauthStateCookie, Value: v}
	}
	tampered := &http.Cookie{Name: oauthStateCookie, Value: state.Value[:len(state.Value)-2] + "AA"}
	expired := reseal(auth.PurposeOAuthStateGoogle, func(s *googleState) { s.Exp = time.Now().Add(-time.Second).Unix() })
	otherPurpose := reseal(auth.PurposeLinkToken, func(*googleState) {})
	// The pre-0049 cookie was "state|next" in clear.
	legacy := &http.Cookie{Name: oauthStateCookie, Value: st.State + "|/acme/team"}

	const next = "&next=%2Facme%2Fteam"
	cases := []struct {
		name, query string
		cookie      *http.Cookie
		want        string
	}{
		{"missing cookie", "code=good&state=" + st.State, nil, "google_failed"},
		{"tampered cookie", "code=good&state=" + st.State, tampered, "google_failed"},
		{"cookie sealed for another purpose", "code=good&state=" + st.State, otherPurpose, "google_failed"},
		{"expired state", "code=good&state=" + st.State, expired, "google_failed"},
		{"clear-text cookie", "code=good&state=" + st.State, legacy, "google_failed"},
		{"state mismatch", "code=good&state=other", state, "google_failed" + next},
		{"user denied", "error=access_denied&state=" + st.State, state, "google_denied" + next},
		{"other oauth error", "error=server_error&state=" + st.State, state, "google_failed" + next},
		{"bad code", "code=bad&state=" + st.State, state, "google_failed" + next},
		{"unverified email", "code=good&state=" + st.State, state, "google_unverified" + next},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := googleCallback(t, srv, tc.query, tc.cookie)
			if res.StatusCode != http.StatusSeeOther {
				t.Fatalf("status = %d", res.StatusCode)
			}
			if got := res.Header.Get("Location"); got != "http://localhost:3000/login?error="+tc.want {
				t.Fatalf("location = %q, want error %s", got, tc.want)
			}
			if cookieNamed(res, refreshCookie) != nil {
				t.Fatal("no session may be started on failure")
			}
		})
	}

	// The shared resolver's refusals reach the login page by their own code.
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `INSERT INTO users (id, email, display_name, google_id, email_verified_at, locale)
		VALUES ('01GOOGLEOTHER', 'linked@gmail.com', 'L', 'another-sub', now(), 'en'),
		       ('01GOOGLETYPED', 'typed@example.com', 'T', NULL, NULL, 'en')`); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		claims auth.GoogleClaims
		want   string
	}{
		{auth.GoogleClaims{Sub: "s2", Email: "linked@gmail.com", EmailVerified: true}, "sign_in_conflict"},
		{auth.GoogleClaims{Sub: "s3", Email: "typed@example.com", EmailVerified: true}, "sign_in_account_unverified"},
	} {
		g.set(tc.claims)
		cookie, st := googleStart(t, srv, "/acme/team")
		res := googleCallback(t, srv, "code=good&state="+st.State, cookie)
		if got := res.Header.Get("Location"); got != "http://localhost:3000/login?error="+tc.want+next {
			t.Fatalf("%s: location = %q", tc.claims.Email, got)
		}
	}
}
