package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/auth/appletest"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestAppleSignInUnavailableIsNoStore503(t *testing.T) {
	h := &handlers{}
	rec := httptest.NewRecorder()
	h.appleSignIn(rec, httptest.NewRequest(http.MethodPost, "/auth/apple/native", strings.NewReader(`{}`)))
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "apple_auth_unavailable") {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("the answer is no-store")
	}
}

// newAppleTestServer is the test server with Sign in with Apple on, its tokens
// signed by a fake Apple.
func newAppleTestServer(t *testing.T) (*httptest.Server, *appletest.Issuer) {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	cfg := config.Config{JWTSecret: "test", DesktopAuthClients: []config.DesktopAuthClient{{ID: "uniwork-chat-mobile", RedirectURIs: []string{"uniworkchat://auth/callback"}}}, DesktopAuthDeploymentIDs: []string{"default"}, RefreshTokenTTL: time.Hour}
	desktop := service.NewDesktopAuthService(pool, q, d.Minter, cfg)
	issuer := appletest.New(t)
	verifier := auth.NewAppleVerifier(auth.AppleIssuer, issuer.JWKSURL, []string{"com.uniworkos.chat"}, nil)
	d.DesktopAuth = desktop
	d.AppleAuth = service.NewAppleAuthService(pool, q, desktop, verifier, nil)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	return srv, issuer
}

func appleBody(token, nonce string) map[string]any {
	return map[string]any{
		"identity_token": token, "nonce": nonce, "authorization_code": "c", "given_name": "Lan", "family_name": "Phạm",
		"client_id": "uniwork-chat-mobile", "deployment_id": "default", "device_label": "UniChat (iOS)", "platform": "ios",
	}
}

func TestAppleSignInAnswersTheNativeSession(t *testing.T) {
	srv, issuer := newAppleTestServer(t)
	token := issuer.Token(t, appletest.Claims("com.uniworkos.chat", "apple-h1", "lan@privaterelay.appleid.com", true, "nonce-1"))
	res, out := doJSON(t, srv, http.MethodPost, "/api/v1/auth/apple/native", "", appleBody(token, "nonce-1"))
	if res.StatusCode != http.StatusOK || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("status = %d %v", res.StatusCode, out)
	}
	for _, k := range []string{"account_id", "device_session_id", "session_id", "access_token", "refresh_token"} {
		if s, _ := out[k].(string); s == "" {
			t.Fatalf("%s missing: %v", k, out)
		}
	}
	if out["deployment_id"] != "default" || out["token_type"] != "Bearer" || out["refresh_rotates"] != true {
		t.Fatalf("session = %v", out)
	}
	res, me := doJSON(t, srv, http.MethodGet, "/api/v1/me", out["access_token"].(string), nil)
	user, _ := me["user"].(map[string]any)
	if res.StatusCode != http.StatusOK || user["display_name"] != "Lan Phạm" || user["onboarded_at"] != nil {
		t.Fatalf("/me with the native session: %d %v", res.StatusCode, me)
	}
	if raw, _ := json.Marshal(me); strings.Contains(string(raw), "apple_") {
		t.Fatalf("/me never echoes the Apple link: %v", me)
	}
}

func TestAppleSignInRefusals(t *testing.T) {
	srv, issuer := newAppleTestServer(t)
	cases := []struct {
		name   string
		body   any
		status int
		code   string
	}{
		{"wrong audience", appleBody(issuer.Token(t, appletest.Claims("com.example.other", "s", "a@example.com", false, "n")), "n"), http.StatusUnauthorized, "apple_token_invalid"},
		{"bad nonce", appleBody(issuer.Token(t, appletest.Claims("com.uniworkos.chat", "s", "a@example.com", false, "n")), "other"), http.StatusUnauthorized, "apple_token_invalid"},
		{"not a token", appleBody("garbage", "n"), http.StatusUnauthorized, "apple_token_invalid"},
		{"unknown client", func() map[string]any {
			b := appleBody(issuer.Token(t, appletest.Claims("com.uniworkos.chat", "s", "a@example.com", false, "n")), "n")
			b["client_id"] = "someone-else"
			return b
		}(), http.StatusBadRequest, ""},
		{"not JSON", "nope", http.StatusBadRequest, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, out := doJSON(t, srv, http.MethodPost, "/api/v1/auth/apple/native", "", tc.body)
			if res.StatusCode != tc.status {
				t.Fatalf("status = %d, want %d: %v", res.StatusCode, tc.status, out)
			}
			if tc.code != "" {
				if e, _ := out["error"].(map[string]any); e["code"] != tc.code {
					t.Fatalf("error = %v, want %s", out, tc.code)
				}
			}
			if _, ok := out["access_token"]; ok {
				t.Fatal("a refusal carries no session")
			}
		})
	}
}

func TestAuthProvidersReportsApple(t *testing.T) {
	srv, _ := newAppleTestServer(t)
	res, out := doJSON(t, srv, http.MethodGet, "/api/v1/auth/providers", "", nil)
	if res.StatusCode != http.StatusOK || out["apple"] != true || out["google"] != false {
		t.Fatalf("providers = %d %v", res.StatusCode, out)
	}
	// Without the service (no APPLE_SIWA_AUDIENCES) the provider is off.
	rec := httptest.NewRecorder()
	(&handlers{}).authProviders(rec, httptest.NewRequest(http.MethodGet, "/auth/providers", nil))
	if !strings.Contains(rec.Body.String(), `"apple":false`) {
		t.Fatalf("providers without apple = %s", rec.Body.String())
	}
}
