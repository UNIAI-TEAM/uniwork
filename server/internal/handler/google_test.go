package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/auth"
)

// fakeGoogle stands in for the OIDC round trip: "good" yields the configured
// claims, anything else fails like a rejected code.
type fakeGoogle struct {
	claims auth.GoogleClaims
}

func (f *fakeGoogle) AuthCodeURL(state string) string {
	return "https://accounts.google.test/auth?state=" + url.QueryEscape(state)
}

func (f *fakeGoogle) Exchange(_ context.Context, code string) (auth.GoogleClaims, error) {
	if code != "good" {
		return auth.GoogleClaims{}, errors.New("invalid_grant")
	}
	return f.claims, nil
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

func TestGoogleStartSetsStateCookieAndRedirects(t *testing.T) {
	srv := newTestServerWithGoogle(t, &fakeGoogle{})
	res, err := noRedirectClient(srv).Get(srv.URL + "/api/v1/auth/google/start?next=/acme/team")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 302 {
		t.Fatalf("status = %d, want 302", res.StatusCode)
	}
	loc, _ := url.Parse(res.Header.Get("Location"))
	state := loc.Query().Get("state")
	if loc.Host != "accounts.google.test" || len(state) < 32 {
		t.Fatalf("location = %s", loc)
	}
	c := cookieNamed(res, oauthStateCookie)
	if c == nil || !c.HttpOnly || c.Path != "/api/v1/auth/google" || c.SameSite != http.SameSiteLaxMode {
		t.Fatalf("state cookie = %+v", c)
	}
	if !strings.HasPrefix(c.Value, state+"|") || !strings.HasSuffix(c.Value, "|/acme/team") {
		t.Fatalf("cookie value %q must carry state and next", c.Value)
	}
}

func TestGoogleStartDropsUnsafeNext(t *testing.T) {
	srv := newTestServerWithGoogle(t, &fakeGoogle{})
	for _, next := range []string{"//evil.example", "https://evil.example", "/\\evil"} {
		res, _ := noRedirectClient(srv).Get(srv.URL + "/api/v1/auth/google/start?next=" + url.QueryEscape(next))
		c := cookieNamed(res, oauthStateCookie)
		if c == nil || !strings.HasSuffix(c.Value, "|") {
			t.Fatalf("next %q leaked into cookie %q", next, c)
		}
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

func TestGoogleCallbackSignsInAndRedirectsToWeb(t *testing.T) {
	srv := newTestServerWithGoogle(t, &fakeGoogle{claims: auth.GoogleClaims{
		Sub: "sub-1", Email: "g@example.com", EmailVerified: true, Name: "G",
	}})
	start, _ := noRedirectClient(srv).Get(srv.URL + "/api/v1/auth/google/start?next=/acme/team")
	state := cookieNamed(start, oauthStateCookie)
	stateValue := strings.SplitN(state.Value, "|", 2)[0]

	res := googleCallback(t, srv, "code=good&state="+stateValue, state)
	if res.StatusCode != 302 {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if got := res.Header.Get("Location"); got != "http://localhost:3000/auth/callback?next=%2Facme%2Fteam" {
		t.Fatalf("location = %q", got)
	}
	refresh := cookieNamed(res, refreshCookie)
	if refresh == nil || refresh.Value == "" || !refresh.HttpOnly {
		t.Fatalf("refresh cookie = %+v", refresh)
	}
	if c := cookieNamed(res, oauthStateCookie); c == nil || c.MaxAge >= 0 {
		t.Fatalf("state cookie must be cleared, got %+v", c)
	}
	// The refresh cookie starts a normal session.
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/auth/refresh", nil)
	req.AddCookie(refresh)
	res2, _ := srv.Client().Do(req)
	if res2.StatusCode != 200 {
		t.Fatalf("refresh with google session: %d", res2.StatusCode)
	}
}

func TestGoogleCallbackErrorsRedirectToLogin(t *testing.T) {
	srv := newTestServerWithGoogle(t, &fakeGoogle{claims: auth.GoogleClaims{Sub: "s", Email: "u@example.com", EmailVerified: false}})
	start, _ := noRedirectClient(srv).Get(srv.URL + "/api/v1/auth/google/start")
	state := cookieNamed(start, oauthStateCookie)
	stateValue := strings.SplitN(state.Value, "|", 2)[0]

	cases := []struct {
		name, query string
		cookie      *http.Cookie
		want        string
	}{
		{"missing cookie", "code=good&state=" + stateValue, nil, "google_failed"},
		{"state mismatch", "code=good&state=other", state, "google_failed"},
		{"user denied", "error=access_denied&state=" + stateValue, state, "google_denied"},
		{"bad code", "code=bad&state=" + stateValue, state, "google_failed"},
		{"unverified email", "code=good&state=" + stateValue, state, "google_unverified"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := googleCallback(t, srv, tc.query, tc.cookie)
			if res.StatusCode != 302 {
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
}
