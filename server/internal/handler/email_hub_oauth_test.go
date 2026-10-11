package handler

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
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
