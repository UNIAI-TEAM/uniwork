package handler

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

// The owner reads which sign-in buttons to show. Tests register no OAuth
// client, so both keys are present and false.
func TestEmailHubProvidersForTheOwner(t *testing.T) {
	srv, token, wsID, _, _ := setupEmailHubHTTP(t)
	res, out := doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/email-hub/providers", token, nil)
	google, gOK := out["google"].(bool)
	microsoft, mOK := out["microsoft"].(bool)
	if res.StatusCode != http.StatusOK || !gOK || !mOK || google || microsoft {
		t.Fatalf("providers: %d %v", res.StatusCode, out)
	}
}

// Start answers the provider URL and sets the nonce cookie only the callback
// path receives. The cookie holds the nonce sealed in the state, never the
// PKCE verifier, and a provider that is off sets no cookie (spec §5.3).
func TestEmailHubOAuthStartSetsTheNonceCookie(t *testing.T) {
	srv, token, wsID, _, box := setupEmailHubHTTP(t, func(d *Deps) {
		d.EmailHub.ConfigureOAuth(config.Config{
			APIPublicURL:           "https://api.uniwork.test",
			EmailHubGoogleClientID: "g-client", EmailHubGoogleClientSecret: "g-secret",
		})
	})
	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/email-hub/oauth/google/start", token,
		map[string]any{"login_hint": "me@gmail.com"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("start: %d %v", res.StatusCode, out)
	}
	raw, _ := out["authorization_url"].(string)
	u, err := url.Parse(raw)
	if err != nil || u.Host != "accounts.google.com" || u.Query().Get("login_hint") != "me@gmail.com" {
		t.Fatalf("authorization_url = %q (%v)", raw, err)
	}
	var cookie *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == emailHubOAuthCookie {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("no nonce cookie")
	}
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/api/v1/email-hub-connections/" ||
		cookie.MaxAge != 600 || cookie.Secure {
		t.Fatalf("cookie = %+v", cookie)
	}
	sealed, err := base64.RawURLEncoding.DecodeString(u.Query().Get("state"))
	if err != nil {
		t.Fatal(err)
	}
	plain, err := box.Open(sealed)
	if err != nil {
		t.Fatal(err)
	}
	var st struct {
		Nonce    string `json:"nonce"`
		Verifier string `json:"verifier"`
	}
	if err := json.Unmarshal(plain, &st); err != nil {
		t.Fatal(err)
	}
	if st.Nonce == "" || cookie.Value != st.Nonce || st.Verifier == "" || strings.Contains(raw, st.Verifier) {
		t.Fatalf("cookie %q, state nonce %q; the verifier must stay sealed", cookie.Value, st.Nonce)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/email-hub/oauth/microsoft/start", token, map[string]any{})
	if res.StatusCode != http.StatusNotFound || len(res.Cookies()) != 0 {
		t.Fatalf("a provider without a client: %d %v cookies=%v", res.StatusCode, out, res.Cookies())
	}
}

// Secure follows the frontend origin's scheme, like the refresh cookie.
func TestEmailHubOAuthCookieSecureFollowsConfig(t *testing.T) {
	for _, secure := range []bool{false, true} {
		h := &handlers{Deps: Deps{Cfg: config.Config{SecureCookies: secure}}}
		rec := httptest.NewRecorder()
		h.setEmailHubOAuthCookie(rec, "nonce-1")
		cookies := rec.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Name != emailHubOAuthCookie || cookies[0].Value != "nonce-1" || cookies[0].Secure != secure {
			t.Fatalf("secure=%v: cookies = %+v", secure, cookies)
		}
	}
}

var (
	emailHubOAuthDataRE   = regexp.MustCompile(`<script type="application/json" id="r">([^<]*)</script>`)
	emailHubOAuthInlineRE = regexp.MustCompile(`<script>([^<]*)</script>`)
)

// emailHubOAuthPageData is the data block the callback page's script reads.
type emailHubOAuthPageData struct {
	Origin string `json:"origin"`
	OK     bool   `json:"ok"`
	Code   string `json:"code"`
}

func readEmailHubOAuthPage(t *testing.T, body string) emailHubOAuthPageData {
	t.Helper()
	m := emailHubOAuthDataRE.FindStringSubmatch(body)
	if m == nil {
		t.Fatalf("no data block in %q", body)
	}
	var d emailHubOAuthPageData
	if err := json.Unmarshal([]byte(m[1]), &d); err != nil {
		t.Fatalf("data block %q: %v", m[1], err)
	}
	return d
}

func wantEmailHubOAuthCookieCleared(t *testing.T, name string, cookies []*http.Cookie) {
	t.Helper()
	for _, c := range cookies {
		if c.Name == emailHubOAuthCookie {
			if c.MaxAge >= 0 || c.Value != "" || c.Path != emailHubOAuthCookiePath || !c.HttpOnly {
				t.Errorf("%s: nonce cookie not cleared on its path: %+v", name, c)
			}
			return
		}
	}
	t.Errorf("%s: no Set-Cookie clearing %s", name, emailHubOAuthCookie)
}

// The provider redirects the popup here with no Authorization header: the
// route must answer its page, not 401 (spec §5.1). Without an Email Hub key
// the same page answers failed, and the OpenAPI entry asks for no bearer.
func TestEmailHubOAuthCallbackIsNotBehindAuth(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}, Log: slog.Default()})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/email-hub-connections/google/callback?state=s&code=c", nil)
	req.AddCookie(&http.Cookie{Name: emailHubOAuthCookie, Value: "nonce"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "text/html; charset=utf-8" {
		t.Fatalf("callback without a session = %d %q, want 200 text/html", rec.Code, rec.Header().Get("Content-Type"))
	}
	if got := rec.Header().Get("Content-Security-Policy"); got != emailHubOAuthCSP {
		t.Fatalf("the page's policy must replace the API default, got %q", got)
	}
	if d := readEmailHubOAuthPage(t, rec.Body.String()); d.Code != "failed" || d.OK || d.Origin != "http://localhost:3000" {
		t.Fatalf("Email Hub off must answer failed, got %+v", d)
	}
	wantEmailHubOAuthCookieCleared(t, "email hub off", rec.Result().Cookies())

	doc := httptest.NewRecorder()
	h.ServeHTTP(doc, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	var spec struct {
		Paths map[string]struct {
			Get *struct {
				Security  []map[string][]string `json:"security"`
				Responses map[string]struct {
					Content map[string]json.RawMessage `json:"content"`
				} `json:"responses"`
			} `json:"get"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(doc.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	op := spec.Paths["/api/v1/email-hub-connections/{provider}/callback"].Get
	if op == nil || len(op.Security) != 0 || op.Responses["200"].Content["text/html"] == nil {
		t.Fatalf("OpenAPI callback entry = %+v, want a GET with no security answering text/html", op)
	}
}

// Every branch clears the nonce cookie on its scoped path, before the service
// runs: a missing cookie, a tampered state, and the user declining consent
// (spec §5.4 step 2). The state and cookie come from a real start.
func TestEmailHubOAuthCallbackClearsCookieOnEveryBranch(t *testing.T) {
	srv, token, wsID, _, _ := setupEmailHubHTTP(t, func(d *Deps) {
		d.EmailHub.ConfigureOAuth(config.Config{
			APIPublicURL:               "http://localhost:8080",
			EmailHubGoogleClientID:     "email-hub-test-client",
			EmailHubGoogleClientSecret: "email-hub-test-secret",
		})
	})
	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/email-hub/oauth/google/start", token, map[string]string{})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("start: %d %v", res.StatusCode, out)
	}
	rawURL, _ := out["authorization_url"].(string)
	authURL, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	state := authURL.Query().Get("state")
	nonce := cookieNamed(res, emailHubOAuthCookie)
	if state == "" || nonce == nil || nonce.Value == "" ||
		!strings.HasPrefix("/api/v1/email-hub-connections/google/callback", nonce.Path) {
		t.Fatalf("start must hand out a state and a nonce cookie the callback receives: state=%q cookie=%+v", state, nonce)
	}
	sent := &http.Cookie{Name: emailHubOAuthCookie, Value: nonce.Value}

	cases := []struct {
		name   string
		query  string
		cookie *http.Cookie
		code   string
	}{
		{"no cookie", "state=" + url.QueryEscape(state) + "&error=access_denied", nil, "state_invalid"},
		{"tampered state", "state=" + url.QueryEscape(state+"x") + "&code=c", sent, "state_invalid"},
		{"access denied", "state=" + url.QueryEscape(state) + "&error=access_denied", sent, "denied"},
	}
	for _, tc := range cases {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/email-hub-connections/google/callback?"+tc.query, nil)
		if tc.cookie != nil {
			req.AddCookie(tc.cookie)
		}
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := readAll(res)
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s: status %d, want 200", tc.name, res.StatusCode)
		}
		if d := readEmailHubOAuthPage(t, string(body)); d.Code != tc.code || d.OK {
			t.Errorf("%s: page %+v, want code %s", tc.name, d, tc.code)
		}
		wantEmailHubOAuthCookieCleared(t, tc.name, res.Cookies())
	}
}

// One constant script, so one hash for every result and no 'unsafe-inline';
// FRONTEND_ORIGIN and the code ride in a data block no value can close
// (spec §5.4).
func TestEmailHubOAuthCallbackPage(t *testing.T) {
	if !strings.Contains(emailHubOAuthScript, `type:"uniwork:email-hub-oauth"`) {
		t.Fatalf("the script must post the message type the client listens for: %s", emailHubOAuthScript)
	}
	for _, code := range []string{"connected", "state_invalid", "denied", "failed"} {
		rec := httptest.NewRecorder()
		writeEmailHubOAuthPage(rec, "http://localhost:3000", code)
		body := rec.Body.String()
		m := emailHubOAuthInlineRE.FindStringSubmatch(body)
		if m == nil || m[1] != emailHubOAuthScript || strings.Count(body, "<script") != 2 {
			t.Fatalf("%s: the page must run exactly the constant script: %q", code, body)
		}
		sum := sha256.Sum256([]byte(m[1]))
		want := "default-src 'none'; script-src 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) +
			"'; frame-ancestors 'none'; base-uri 'none'"
		if got := rec.Header().Get("Content-Security-Policy"); got != want || got != emailHubOAuthCSP || strings.Contains(got, "unsafe-inline") {
			t.Errorf("%s: CSP %q, want %q", code, got, want)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control %q, want no-store", code, got)
		}
		if got := rec.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
			t.Errorf("%s: Content-Type %q", code, got)
		}
		if d := readEmailHubOAuthPage(t, body); d.Origin != "http://localhost:3000" || d.Code != code || d.OK != (code == "connected") {
			t.Errorf("%s: data block %+v", code, d)
		}
	}

	evil := `https://x.example</script><script>alert(1)</script>`
	rec := httptest.NewRecorder()
	writeEmailHubOAuthPage(rec, evil, "failed")
	body := rec.Body.String()
	if strings.Contains(body, "</script><script>alert") || strings.Count(body, "<script") != 2 {
		t.Fatalf("a crafted FRONTEND_ORIGIN broke out of the data block: %q", body)
	}
	if d := readEmailHubOAuthPage(t, body); d.Origin != evil {
		t.Fatalf("the data block must carry the origin verbatim once decoded, got %q", d.Origin)
	}
}
