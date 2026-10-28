package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/auth/appletest"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The web door of the test server: its Services ID and return URL.
const (
	testServicesID  = "com.uniworkos.web"
	testAppleReturn = "https://api.example.com/api/v1/auth/apple/callback"
)

// fakeAppleWeb stands in for Apple's token and revoke endpoints: a web code
// redeems once, for the identity token issue named, with a refresh token
// named after the code.
type fakeAppleWeb struct {
	issuer  *appletest.Issuer
	mu      sync.Mutex
	codes   map[string]string
	issued  int
	revoked []string
}

func (f *fakeAppleWeb) RefreshTokenForCode(context.Context, string, string) (string, error) {
	return "", auth.AppleClientError{Op: "token", Status: http.StatusBadRequest, Code: "invalid_grant"}
}

func (f *fakeAppleWeb) Revoke(_ context.Context, clientID, token string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.revoked = append(f.revoked, clientID+" "+token)
	return nil
}

func (f *fakeAppleWeb) ExchangeWebCode(_ context.Context, clientID, code, redirectURI string) (auth.AppleWebTokens, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	tok, ok := f.codes[code]
	if !ok || clientID != testServicesID || redirectURI != testAppleReturn {
		return auth.AppleWebTokens{}, auth.AppleClientError{Op: "token", Status: http.StatusBadRequest, Code: "invalid_grant"}
	}
	delete(f.codes, code)
	return auth.AppleWebTokens{IDToken: tok, RefreshToken: "refresh-for-" + code}, nil
}

// issue is Apple answering an authorization: a code for a token issued to
// aud, carrying the hash of nonce.
func (f *fakeAppleWeb) issue(t *testing.T, aud, sub, email, nonce string) string {
	t.Helper()
	tok := f.issuer.Token(t, appletest.Claims(aud, sub, email, false, nonce))
	f.mu.Lock()
	defer f.mu.Unlock()
	f.issued++
	code := fmt.Sprintf("code-%s-%d", sub, f.issued)
	f.codes[code] = tok
	return code
}

func (f *fakeAppleWeb) revokedNow() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.revoked...)
}

// newAppleWebTestServer is the test server with both Apple doors open: the
// app's (bundle id com.uniworkos.chat) and the web's (the Services ID), each
// with its own verifier; native false leaves the app's door closed.
func newAppleWebTestServer(t *testing.T, native bool) (*httptest.Server, *fakeAppleWeb) {
	t.Helper()
	return newAppleWebTestServerWithGoogle(t, native, nil)
}

// newAppleWebTestServerWithGoogle is newAppleWebTestServer with Google on the
// web beside Apple; nil leaves Google off.
func newAppleWebTestServerWithGoogle(t *testing.T, native bool, google GoogleExchanger) (*httptest.Server, *fakeAppleWeb) {
	t.Helper()
	d, pool := newTestDeps(t, google, discardOutbox{})
	q := db.New(pool)
	cfg := config.Config{JWTSecret: "test", DesktopAuthClients: []config.DesktopAuthClient{{ID: "uniwork-chat-mobile", RedirectURIs: []string{"uniworkchat://auth/callback"}}}, DesktopAuthDeploymentIDs: []string{"default"}, RefreshTokenTTL: time.Hour}
	desktop := service.NewDesktopAuthService(pool, q, d.Minter, cfg)
	fake := &fakeAppleWeb{issuer: appletest.New(t), codes: map[string]string{}}
	var verifier service.AppleTokenVerifier
	if native {
		verifier = auth.NewAppleVerifier(auth.AppleIssuer, fake.issuer.JWKSURL, []string{"com.uniworkos.chat"}, nil)
	}
	apple := service.NewAppleAuthService(pool, q, desktop, verifier, fake, d.Sealer)
	apple.SetWeb(d.Auth, service.AppleWeb{
		ServicesID: testServicesID, RedirectURI: testAppleReturn, Client: fake,
		Verifier: auth.NewAppleVerifier(auth.AppleIssuer, fake.issuer.JWKSURL, []string{testServicesID}, nil),
	})
	d.Auth.SetApple(apple)
	d.DesktopAuth, d.AppleAuth = desktop, apple
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	return srv, fake
}

// openAppleState reads the sealed state cookie the way the callback does.
func openAppleState(t *testing.T, c *http.Cookie) appleState {
	t.Helper()
	if c == nil {
		t.Fatal("no state cookie")
	}
	raw, err := testSealer(t).OpenFor(auth.PurposeOAuthStateApple, c.Value)
	if err != nil {
		t.Fatalf("the state cookie opens for oauth_state:apple: %v", err)
	}
	var st appleState
	if err := json.Unmarshal([]byte(raw), &st); err != nil {
		t.Fatal(err)
	}
	return st
}

// appleWebStart starts a browser sign-in and answers its state cookie.
func appleWebStart(t *testing.T, srv *httptest.Server, query string, cookies ...*http.Cookie) (*http.Cookie, appleState) {
	t.Helper()
	res := getWith(t, srv, "/api/v1/auth/apple/start?"+query, cookies...)
	if res.StatusCode != http.StatusFound {
		t.Fatalf("start: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
	c := cookieNamed(res, appleStateCookie)
	return c, openAppleState(t, c)
}

// applePost is Apple's form post to the callback, carrying cookies.
func applePost(t *testing.T, srv *httptest.Server, form url.Values, cookies ...*http.Cookie) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/auth/apple/callback", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	// Apple's page posts it: a cross-site form, which no login-CSRF guard
	// may turn away.
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req.Header.Set("Origin", "https://appleid.apple.com")
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

// appleRoundTrip runs start, Apple and the callback for sub/email with aud
// as the token's audience, and answers the callback's response.
func appleRoundTrip(t *testing.T, srv *httptest.Server, fake *fakeAppleWeb, query, sub, email string, cookies ...*http.Cookie) *http.Response {
	t.Helper()
	state, st := appleWebStart(t, srv, query, cookies...)
	code := fake.issue(t, testServicesID, sub, email, st.Nonce)
	return applePost(t, srv, url.Values{"code": {code}, "state": {st.State}, "user": {`{"name":{"firstName":"Lan","lastName":"Phạm"}}`}}, append(cookies, state)...)
}

// wantFinish checks the callback's answer: the result cookie, and the 303
// to the same-site finish.
func wantFinish(t *testing.T, res *http.Response) *http.Cookie {
	t.Helper()
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != appleFinishPath {
		t.Fatalf("callback: %d %q, want 303 to the finish", res.StatusCode, res.Header.Get("Location"))
	}
	c := cookieNamed(res, appleResultCookie)
	if c == nil || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteNoneMode || c.Path != appleCookiePath || c.MaxAge != 120 {
		t.Fatalf("result cookie = %+v", c)
	}
	if cookieNamed(res, refreshCookie) != nil {
		t.Fatal("the cross-site callback opens no session")
	}
	return c
}

func wantCleared(t *testing.T, res *http.Response, name string) {
	t.Helper()
	if c := cookieNamed(res, name); c == nil || c.MaxAge >= 0 {
		t.Fatalf("%s must be cleared, got %+v", name, c)
	}
}

func TestAppleWebIs503WhenNotConfigured(t *testing.T) {
	srv := newTestServer(t)
	res := getWith(t, srv, "/api/v1/auth/apple/start")
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("start: %d", res.StatusCode)
	}
	token, _, _ := browserAccount(t, srv, "nolink@acme.vn")
	res, out := doJSON(t, srv, http.MethodPost, "/api/v1/me/sign-in-methods/apple/link", token, map[string]string{"step_up_token": "x"})
	if res.StatusCode != http.StatusServiceUnavailable || errorCode(out) != "apple_not_configured" {
		t.Fatalf("link: %d %v", res.StatusCode, out)
	}
	// Without its state the callback and the finish refuse.
	if res := applePost(t, srv, url.Values{"code": {"c"}, "state": {"s"}}); res.Header.Get("Location") != "http://localhost:3000/login?error=apple_failed" {
		t.Fatalf("callback: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
}

// The start seals what the callback checks into one cookie (ADR 0049 §7):
// the state Apple posts back and the raw nonce, whose hash only goes to
// Apple. The cookie must travel on Apple's cross-site form post, so it is
// SameSite=None and Secure whatever the deployment's scheme.
func TestAppleWebStartSealsStateAndNonceAndRedirects(t *testing.T) {
	srv, _ := newAppleWebTestServer(t, false)
	res := getWith(t, srv, "/api/v1/auth/apple/start?next=/acme/team&intent=sign_up")
	if res.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want 302", res.StatusCode)
	}
	c := cookieNamed(res, appleStateCookie)
	if c == nil || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteNoneMode || c.Path != "/api/v1/auth/apple" || c.MaxAge != 600 {
		t.Fatalf("state cookie = %+v", c)
	}
	st := openAppleState(t, c)
	if len(st.State) != 64 || len(st.Nonce) != 64 || st.Flow.Next != "/acme/team" || st.Flow.Intent != "sign_up" || st.Exp <= time.Now().Unix() {
		t.Fatalf("state = %+v", st)
	}
	loc, err := url.Parse(res.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	q := loc.Query()
	if loc.Host != "appleid.apple.com" || loc.Path != "/auth/authorize" || q.Get("client_id") != testServicesID || q.Get("redirect_uri") != testAppleReturn ||
		q.Get("response_mode") != "form_post" || q.Get("response_type") != "code" || q.Get("scope") != "name email" ||
		q.Get("state") != st.State || q.Get("nonce") != auth.AppleNonceHash(st.Nonce) {
		t.Fatalf("location = %s", loc)
	}
	for _, clear := range []string{st.State, st.Nonce, "/acme/team"} {
		if strings.Contains(c.Value, clear) {
			t.Fatalf("the cookie carries %q in clear", clear)
		}
	}
	if strings.Contains(res.Header.Get("Location"), st.Nonce) {
		t.Fatal("the raw nonce went to Apple")
	}
	if _, err := testSealer(t).OpenFor(auth.PurposeOAuthStateGoogle, c.Value); err == nil {
		t.Fatal("the Apple state opened as Google's")
	}
	res = getWith(t, srv, "/api/v1/auth/apple/start?intent=merge&next=/acme/team")
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "http://localhost:3000/login?error=apple_failed&next=%2Facme%2Fteam" || cookieNamed(res, appleStateCookie) != nil {
		t.Fatalf("unknown intent: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
	res = getWith(t, srv, "/api/v1/auth/apple/start?next="+url.QueryEscape("//evil.example"))
	if st := openAppleState(t, cookieNamed(res, appleStateCookie)); st.Flow.Next != "" || st.Flow.Intent != "sign_in" {
		t.Fatalf("an off-site next leaked into the state: %+v", st)
	}
}

// Apple's form post proves no one unless it carries the state of this
// browser's start and a code whose identity token is the web's (audience the
// Services ID) and this sign-in's (nonce). Every refusal lands on /login
// with its code and next, clears the state cookie and leaves no result; the
// finish refuses a missing, forged or stale result.
func TestAppleWebCallbackChecksStateNonceAndAudience(t *testing.T) {
	srv, fake := newAppleWebTestServer(t, true)
	sealer := testSealer(t)
	state, st := appleWebStart(t, srv, "next=/acme/team")
	reseal := func(purpose string, mutate func(*appleState)) *http.Cookie {
		cp := st
		mutate(&cp)
		raw, _ := json.Marshal(cp)
		v, err := sealer.SealFor(purpose, string(raw))
		if err != nil {
			t.Fatal(err)
		}
		return &http.Cookie{Name: appleStateCookie, Value: v}
	}
	good := func() string { return fake.issue(t, testServicesID, "callback-sub", "callback@icloud.com", st.Nonce) }

	const next = "&next=%2Facme%2Fteam"
	cases := []struct {
		name   string
		form   url.Values
		cookie *http.Cookie
		want   string
	}{
		{"missing cookie", url.Values{"code": {good()}, "state": {st.State}}, nil, "apple_failed"},
		{"tampered cookie", url.Values{"code": {good()}, "state": {st.State}}, &http.Cookie{Name: appleStateCookie, Value: state.Value[:len(state.Value)-2] + "AA"}, "apple_failed"},
		{"cookie sealed for Google", url.Values{"code": {good()}, "state": {st.State}}, reseal(auth.PurposeOAuthStateGoogle, func(*appleState) {}), "apple_failed"},
		{"expired state", url.Values{"code": {good()}, "state": {st.State}}, reseal(auth.PurposeOAuthStateApple, func(s *appleState) { s.Exp = time.Now().Add(-time.Second).Unix() }), "apple_failed"},
		{"bad state", url.Values{"code": {good()}, "state": {"other"}}, state, "apple_failed" + next},
		{"no state", url.Values{"code": {good()}}, state, "apple_failed" + next},
		{"cancelled", url.Values{"error": {"user_cancelled_authorize"}, "state": {st.State}}, state, "apple_denied" + next},
		{"other error", url.Values{"error": {"invalid_request"}, "state": {st.State}}, state, "apple_failed" + next},
		{"bad nonce", url.Values{"code": {fake.issue(t, testServicesID, "callback-sub", "callback@icloud.com", "another-sign-in-nonce")}, "state": {st.State}}, state, "apple_failed" + next},
		{"app audience", url.Values{"code": {fake.issue(t, "com.uniworkos.chat", "callback-sub", "callback@icloud.com", st.Nonce)}, "state": {st.State}}, state, "apple_failed" + next},
		{"code Apple will not redeem", url.Values{"code": {"never-issued"}, "state": {st.State}}, state, "apple_failed" + next},
		{"no code", url.Values{"state": {st.State}}, state, "apple_failed" + next},
		{"body over 64 KiB", url.Values{"code": {good()}, "state": {st.State}, "user": {strings.Repeat("x", 70<<10)}}, state, "apple_failed" + next},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := applePost(t, srv, tc.form, tc.cookie)
			if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "http://localhost:3000/login?error="+tc.want {
				t.Fatalf("status %d location %q, want error %s", res.StatusCode, res.Header.Get("Location"), tc.want)
			}
			wantCleared(t, res, appleStateCookie)
			if cookieNamed(res, appleResultCookie) != nil || cookieNamed(res, refreshCookie) != nil {
				t.Fatal("a refusal leaves no result and no session")
			}
		})
	}
	if _, err := db.New(testPool).GetUserByEmail(context.Background(), "callback@icloud.com"); err == nil {
		t.Fatal("a refused callback opened an account")
	}

	// The finish acts only on a result this server sealed for it, in time.
	result := wantFinish(t, applePost(t, srv, url.Values{"code": {good()}, "state": {st.State}}, state))
	raw, err := sealer.OpenFor(auth.PurposeAppleWebResult, result.Value)
	if err != nil {
		t.Fatal(err)
	}
	var r appleResult
	if err := json.Unmarshal([]byte(raw), &r); err != nil || r.Identity.Subject != "callback-sub" || r.Identity.AppleClientID != testServicesID || r.Flow.Next != "/acme/team" {
		t.Fatalf("result = %+v %v", r, err)
	}
	if strings.Contains(result.Value, "callback@icloud.com") {
		t.Fatal("the result carries the address in clear")
	}
	restale := func(purpose string, mutate func(*appleResult)) *http.Cookie {
		cp := r
		mutate(&cp)
		b, _ := json.Marshal(cp)
		v, err := sealer.SealFor(purpose, string(b))
		if err != nil {
			t.Fatal(err)
		}
		return &http.Cookie{Name: appleResultCookie, Value: v}
	}
	for name, c := range map[string]*http.Cookie{
		"no result":          nil,
		"tampered result":    {Name: appleResultCookie, Value: result.Value[:len(result.Value)-2] + "AA"},
		"result as a ticket": restale(auth.PurposeSignInTicket, func(*appleResult) {}),
		"expired result":     restale(auth.PurposeAppleWebResult, func(r *appleResult) { r.Exp = time.Now().Add(-time.Second).Unix() }),
		"not an Apple one":   restale(auth.PurposeAppleWebResult, func(r *appleResult) { r.Identity.Provider = service.ProviderGoogle }),
	} {
		res := getWith(t, srv, appleFinishPath, c)
		if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "http://localhost:3000/login?error=apple_failed" || cookieNamed(res, refreshCookie) != nil {
			t.Fatalf("finish with %s: %d %q", name, res.StatusCode, res.Header.Get("Location"))
		}
		wantCleared(t, res, appleResultCookie)
	}
}

// The finish signs in through the end every browser provider shares
// (finishWebSignIn): the register screen's intent creates the account, with
// the Apple consent kept for the Services ID; an identity no account matches
// lands on the choice screen with a ticket; a refusal lands on /login by
// the resolver's code.
func TestAppleWebFinishSignsInThroughTheSharedFinish(t *testing.T) {
	srv, fake := newAppleWebTestServer(t, false)
	result := wantFinish(t, appleRoundTrip(t, srv, fake, "intent=sign_up&next=/acme/team", "web-new", "new7@privaterelay.appleid.com"))
	res := getWith(t, srv, appleFinishPath, result, &http.Cookie{Name: signInTicketCookie, Value: "stale"})
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "http://localhost:3000/auth/callback?next=%2Facme%2Fteam" {
		t.Fatalf("finish: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
	wantCleared(t, res, appleResultCookie)
	wantCleared(t, res, signInTicketCookie)
	refresh := cookieNamed(res, refreshCookie)
	if refresh == nil || refresh.Value == "" {
		t.Fatal("no session cookie")
	}
	u, err := db.New(testPool).GetUserByEmail(context.Background(), "new7@privaterelay.appleid.com")
	if err != nil || u.AppleID.String != "web-new" || u.AppleClientID.String != testServicesID || !u.AppleRefreshTokenEnc.Valid || u.DisplayName != "Lan Phạm" {
		t.Fatalf("account = %+v %v", u, err)
	}
	if n := countUsersWithApple(t, "web-new"); n != 1 {
		t.Fatalf("%d accounts for the subject", n)
	}

	// An account with a second factor gets its challenge in the uniwork_mfa
	// cookie and the login page's second step, next kept.
	if _, err := testPool.Exec(context.Background(), `UPDATE users SET mfa_enabled_at = now() WHERE apple_id = 'web-new'`); err != nil {
		t.Fatal(err)
	}
	result = wantFinish(t, appleRoundTrip(t, srv, fake, "next=/acme/team", "web-new", "new7@privaterelay.appleid.com"))
	res = getWith(t, srv, appleFinishPath, result)
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "http://localhost:3000/login?mfa=1&next=%2Facme%2Fteam" {
		t.Fatalf("second step: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
	if c := cookieNamed(res, mfaCookie); c == nil || c.Value == "" || cookieNamed(res, refreshCookie) != nil {
		t.Fatalf("want the challenge and no session: %+v", c)
	}

	result = wantFinish(t, appleRoundTrip(t, srv, fake, "next=/acme/team", "web-unmatched", "unmatched@icloud.com"))
	res = getWith(t, srv, appleFinishPath, result)
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "http://localhost:3000/auth/continue?next=%2Facme%2Fteam" {
		t.Fatalf("unmatched: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
	ticket := cookieNamed(res, signInTicketCookie)
	if ticket == nil || ticket.Value == "" || cookieNamed(res, refreshCookie) != nil {
		t.Fatalf("want the ticket and no session: %+v", ticket)
	}
	res, out := ticketRequest(t, srv, http.MethodGet, "/api/v1/auth/sign-in-ticket", "", []*http.Cookie{ticket}, nil)
	if res.StatusCode != http.StatusOK || out["provider"] != "apple" || out["email"] != "unmatched@icloud.com" {
		t.Fatalf("ticket: %d %v", res.StatusCode, out)
	}

	if _, err := testPool.Exec(context.Background(), `INSERT INTO users (id, email, display_name, apple_id, email_verified_at, locale)
		VALUES ('01APPLEWEBHELD', 'held@icloud.com', 'H', 'another-subject', now(), 'en')`); err != nil {
		t.Fatal(err)
	}
	result = wantFinish(t, appleRoundTrip(t, srv, fake, "next=/acme/team", "web-conflict", "held@icloud.com"))
	res = getWith(t, srv, appleFinishPath, result)
	if res.Header.Get("Location") != "http://localhost:3000/login?error=sign_in_conflict&next=%2Facme%2Fteam" || cookieNamed(res, refreshCookie) != nil {
		t.Fatalf("conflict: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
	revoked := fake.revokedNow()
	if len(revoked) != 1 || !strings.HasPrefix(revoked[0], testServicesID+" refresh-for-code-web-conflict-") {
		t.Fatalf("the refused sign-in's consent goes back to Apple for the Services ID: %v", revoked)
	}
}

// Link mode across providers (spec §3.4, §4.4): a Google sign-in waits to be
// linked, the person takes Apple to reach the account it joins, and the Apple
// ID opens no account either. The waiting ticket stays as it was, /login says
// apple_no_account with next kept, nothing is created, and the consent Apple
// gave for the sign-in that was given up goes back to Apple.
func TestLinkModeKeepsTheWaitingTicketWhenAppleMatchesNothing(t *testing.T) {
	g := &fakeGoogle{}
	srv, fake := newAppleWebTestServerWithGoogle(t, false, g)
	_, waiting := googleTicketCookie(t, srv, g, auth.GoogleClaims{Sub: "g-waits-apple", Email: "waits.apple@gmail.com", EmailVerified: true}, "")
	next := "/auth/continue?" + url.Values{"step": {"link"}, "next": {"/acme"}}.Encode()

	result := wantFinish(t, appleRoundTrip(t, srv, fake, url.Values{"next": {next}}.Encode(), "web-nobody", "nobody@icloud.com"))
	res := getWith(t, srv, appleFinishPath, result, waiting)
	want := "http://localhost:3000/login?" + url.Values{"error": {"apple_no_account"}, "next": {next}}.Encode()
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != want {
		t.Fatalf("link mode, Apple matched nothing: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
	wantCleared(t, res, appleResultCookie)
	if cookieNamed(res, signInTicketCookie) != nil || cookieNamed(res, refreshCookie) != nil {
		t.Fatalf("the waiting ticket is neither replaced nor dropped, and no session opens: %+v", res.Cookies())
	}
	if revoked := fake.revokedNow(); len(revoked) != 1 || !strings.HasPrefix(revoked[0], testServicesID+" refresh-for-code-web-nobody-") {
		t.Fatalf("the given-up sign-in's consent goes back to Apple: %v", revoked)
	}
	if n := countUsersWithApple(t, "web-nobody"); n != 0 {
		t.Fatalf("%d accounts for an Apple ID that matched nothing", n)
	}
	res, out := ticketRequest(t, srv, http.MethodGet, "/api/v1/auth/sign-in-ticket", "", []*http.Cookie{waiting}, nil)
	if res.StatusCode != http.StatusOK || out["provider"] != "google" || out["email"] != "waits.apple@gmail.com" {
		t.Fatalf("the waiting sign-in: %d %v", res.StatusCode, out)
	}
}

func countUsersWithApple(t *testing.T, sub string) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE apple_id = $1`, sub).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// A link from Settings goes through Apple like Google's (spec §3.4): the
// start needs the very browser session its link token names, the finish
// checks it again, and every answer goes back to Settings, never to a
// sign-in. The account keeps the consent for the Services ID.
func TestAppleWebLinksFromSettingsThroughTheSameBrowserSession(t *testing.T) {
	srv, fake := newAppleWebTestServer(t, false)
	token, uid, refresh := browserAccount(t, srv, "settings@acme.vn")
	res, out := doJSON(t, srv, http.MethodPost, "/api/v1/auth/login", "", map[string]string{"email": "settings@acme.vn", "password": "password123"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("second browser: %d %v", res.StatusCode, out)
	}
	otherBrowser := cookieNamed(res, refreshCookie)

	proof := stepUp(t, srv, token, map[string]any{"password": "password123"})
	res, out = doJSON(t, srv, http.MethodPost, "/api/v1/me/sign-in-methods/apple/link", token, map[string]string{
		"step_up_token": proof, "return_to": "/acme/team/settings?tab=security",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("link: %d %v", res.StatusCode, out)
	}
	start, err := url.Parse(out["authorization_url"].(string))
	if err != nil || start.Path != "/api/v1/auth/apple/start" || start.Query().Get("intent") != "link" || start.Query().Get("link_token") == "" {
		t.Fatalf("authorization_url %q", out["authorization_url"])
	}
	query := start.RawQuery
	if path, q := linkResult(t, getWith(t, srv, "/api/v1/auth/apple/start?"+query, otherBrowser)); path != "/acme/team/settings" || q.Get("sign_in_method") != "apple" || q.Get("result") != "session_mismatch" {
		t.Fatalf("start from another browser: %s %v", path, q)
	}

	// Cancelled on Apple's page: back to Settings with denied.
	state, st := appleWebStart(t, srv, query, refresh)
	if st.Flow.Intent != webIntentLink || st.Flow.UserID != uid || st.Flow.Session == "" || st.Flow.ReturnTo != "/acme/team/settings?tab=security" ||
		st.Flow.ProofExp != stepUpEnd(t, proof) {
		t.Fatalf("state %+v, want the link and the end of its step-up", st)
	}
	res = applePost(t, srv, url.Values{"error": {"user_cancelled_authorize"}, "state": {st.State}}, state)
	if path, q := linkResult(t, res); path != "/acme/team/settings" || q.Get("result") != "denied" || q.Get("sign_in_method") != "apple" {
		t.Fatalf("cancelled link: %s %v", path, q)
	}

	result := wantFinish(t, appleRoundTrip(t, srv, fake, query, "web-settings", "settings.personal@icloud.com", refresh))
	users := db.New(testPool)
	for why, cookie := range map[string]*http.Cookie{"no session": nil, "another session": otherBrowser} {
		path, q := linkResult(t, getWith(t, srv, appleFinishPath, result, cookie))
		if path != "/acme/team/settings" || q.Get("result") != "session_mismatch" {
			t.Fatalf("finish with %s: %s %v", why, path, q)
		}
		if u, _ := users.GetUserByID(context.Background(), uid); u.AppleID.Valid {
			t.Fatalf("finish with %s linked", why)
		}
	}
	res = getWith(t, srv, appleFinishPath, result, refresh)
	if path, q := linkResult(t, res); path != "/acme/team/settings" || q.Get("result") != "linked" || q.Get("sign_in_method") != "apple" {
		t.Fatalf("finish from the right browser: %s %v", path, q)
	}
	if cookieNamed(res, refreshCookie) != nil {
		t.Fatal("a link from Settings is not a sign-in")
	}
	u, _ := users.GetUserByID(context.Background(), uid)
	if u.AppleID.String != "web-settings" || u.AppleEmail.String != "settings.personal@icloud.com" || u.AppleClientID.String != testServicesID || !u.AppleRefreshTokenEnc.Valid {
		t.Fatalf("not linked with its consent: %+v", u)
	}
}

// /auth/providers reports each Apple door by itself (ADR 0049 §10): apple
// keeps meaning the iPhone's native sign-in, apple_web is the web's. A
// deployment with the web's Services ID only answers 503 at the app's door.
func TestAuthProvidersReportsEachAppleDoor(t *testing.T) {
	// One server per subtest: each holds the test database's lock until it ends.
	t.Run("both doors", func(t *testing.T) {
		both, _ := newAppleWebTestServer(t, true)
		if res, out := doJSON(t, both, http.MethodGet, "/api/v1/auth/providers", "", nil); res.StatusCode != http.StatusOK || out["apple"] != true || out["apple_web"] != true {
			t.Fatalf("both doors: %d %v", res.StatusCode, out)
		}
	})
	t.Run("web only", func(t *testing.T) {
		web, _ := newAppleWebTestServer(t, false)
		if res, out := doJSON(t, web, http.MethodGet, "/api/v1/auth/providers", "", nil); res.StatusCode != http.StatusOK || out["apple"] != false || out["apple_web"] != true {
			t.Fatalf("web only: %d %v", res.StatusCode, out)
		}
		res, out := doJSON(t, web, http.MethodPost, "/api/v1/auth/apple/native", "", appleBody("token", "nonce"))
		if res.StatusCode != http.StatusServiceUnavailable || errorCode(out) != "apple_auth_unavailable" {
			t.Fatalf("the app's door on a web-only deployment: %d %v", res.StatusCode, out)
		}
	})
}

// The OpenAPI spec documents what Apple posts as the form it is (never
// JSON) and each step by its redirect: 302 to Apple, 303 to the finish, 303
// to the web.
func TestAppleWebRoutesDocumentTheFormAndTheRedirects(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}, Log: slog.Default()})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	type op struct {
		RequestBody *struct {
			Content map[string]struct {
				Schema struct {
					Ref string `json:"$ref"`
				} `json:"schema"`
			} `json:"content"`
		} `json:"requestBody"`
		Responses map[string]json.RawMessage `json:"responses"`
		Security  []map[string][]string      `json:"security"`
	}
	var spec struct {
		Paths      map[string]map[string]op `json:"paths"`
		Components struct {
			Schemas map[string]struct {
				Properties map[string]json.RawMessage `json:"properties"`
			} `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]struct {
		method string
		status string
	}{
		"/api/v1/auth/apple/start":    {"get", "302"},
		"/api/v1/auth/apple/callback": {"post", "303"},
		"/api/v1/auth/apple/finish":   {"get", "303"},
	} {
		o, ok := spec.Paths[path][want.method]
		if !ok {
			t.Fatalf("%s %s is not on the spec", want.method, path)
		}
		if _, ok := o.Responses[want.status]; !ok || len(o.Security) != 0 {
			t.Fatalf("%s: responses %v security %v, want %s and no bearer", path, o.Responses, o.Security, want.status)
		}
	}
	cb := spec.Paths["/api/v1/auth/apple/callback"]["post"]
	form, ok := cb.RequestBody.Content["application/x-www-form-urlencoded"]
	if !ok || len(cb.RequestBody.Content) != 1 {
		t.Fatalf("callback body = %+v, want the form only", cb.RequestBody)
	}
	schema := spec.Components.Schemas[strings.TrimPrefix(form.Schema.Ref, "#/components/schemas/")]
	for _, field := range []string{"code", "state", "user", "error"} {
		if _, ok := schema.Properties[field]; !ok {
			t.Fatalf("the form documents no %s: %v", field, schema.Properties)
		}
	}
	if _, ok := spec.Paths["/api/v1/me/sign-in-methods/apple/link"]["post"]; !ok {
		t.Fatal("the Apple link from Settings is not on the spec")
	}
}
