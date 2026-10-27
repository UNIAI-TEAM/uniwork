package handler

import (
	"context"
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
	d.AppleAuth = service.NewAppleAuthService(pool, q, desktop, verifier, nil, d.Sealer)
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

// /auth/providers only ever gains flags (ADR 0047 §10): apple keeps meaning
// the native iPhone sign-in the shipped app reads; the web's Apple reports
// false without its Services ID (TestAuthProvidersReportsEachAppleDoor), and
// the app's Google SDK until its route exists.
func TestAuthProvidersReportsApple(t *testing.T) {
	srv, _ := newAppleTestServer(t)
	res, out := doJSON(t, srv, http.MethodGet, "/api/v1/auth/providers", "", nil)
	if res.StatusCode != http.StatusOK || out["apple"] != true || out["google"] != false || out["apple_web"] != false || out["google_native"] != false {
		t.Fatalf("providers = %d %v", res.StatusCode, out)
	}
	// Without the service (no APPLE_SIWA_AUDIENCES) the provider is off.
	rec := httptest.NewRecorder()
	(&handlers{}).authProviders(rec, httptest.NewRequest(http.MethodGet, "/auth/providers", nil))
	if body := rec.Body.String(); !strings.Contains(body, `"apple":false`) || !strings.Contains(body, `"apple_web":false`) || !strings.Contains(body, `"google_native":false`) {
		t.Fatalf("providers without apple = %s", body)
	}
}

// The shipped iPhone app reads the codes POST /auth/apple/native answered
// before ADR 0047, so the route keeps them while the shared rules decide
// underneath (spec §3.6): a second factor is 403 mfa_required with nothing
// linked, an address Apple does not vouch for is 401 apple_token_invalid,
// every other refusal is 409 apple_account_conflict; a new identity still
// opens an account at once, and a reclaim still signs in without the
// squatter's second factor.
func TestLegacyAppleNativeKeepsItsCodes(t *testing.T) {
	srv, issuer := newAppleTestServer(t)
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `INSERT INTO users (id, email, display_name, apple_id, email_verified_at, mfa_enabled_at, locale) VALUES
		('01LEGACYLINKED', 'linked@icloud.com', 'L', 'apple-someone', now(), NULL, 'en'),
		('01LEGACYRELAY', 'held@privaterelay.appleid.com', 'R', NULL, now(), NULL, 'en'),
		('01LEGACYGMAIL', 'verified@gmail.com', 'G', NULL, now(), NULL, 'en'),
		('01LEGACYTYPED', 'typed@gmail.com', 'T', NULL, NULL, NULL, 'en'),
		('01LEGACYMFA', 'mfa@icloud.com', 'M', NULL, now(), now(), 'en'),
		('01LEGACYMFASUB', 'mfa-sub@icloud.com', 'S', 'apple-mfa-sub', now(), now(), 'en'),
		('01LEGACYSQUAT', 'squat@icloud.com', 'Q', NULL, NULL, now(), 'en'),
		('01LEGACYOWNER', 'owner@icloud.com', 'O', NULL, now(), NULL, 'en')`); err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(ctx, `UPDATE users SET password_hash = 'x', totp_secret = 'sealed' WHERE id = '01LEGACYSQUAT'`); err != nil {
		t.Fatal(err)
	}
	unverified := appletest.Claims("com.uniworkos.chat", "apple-unverified", "who@example.com", false, "n")
	unverified["email_verified"] = "false"
	cases := []struct {
		name    string
		claims  map[string]any
		status  int
		code    string
		account string // the account a sign-in lands in, when one is expected
	}{
		{"new identity", appletest.Claims("com.uniworkos.chat", "apple-new", "new@privaterelay.appleid.com", true, "n"), http.StatusOK, "", ""},
		{"verified iCloud account", appletest.Claims("com.uniworkos.chat", "apple-owner", "owner@icloud.com", false, "n"), http.StatusOK, "", "01LEGACYOWNER"},
		{"reclaim past the squatter's second factor", appletest.Claims("com.uniworkos.chat", "apple-squat", "squat@icloud.com", false, "n"), http.StatusOK, "", "01LEGACYSQUAT"},
		{"second factor on the matched account", appletest.Claims("com.uniworkos.chat", "apple-mfa-sub", "mfa-sub@icloud.com", false, "n"), http.StatusForbidden, "mfa_required", ""},
		{"second factor on the account to link", appletest.Claims("com.uniworkos.chat", "apple-mfa", "mfa@icloud.com", false, "n"), http.StatusForbidden, "mfa_required", ""},
		{"address linked to another Apple ID", appletest.Claims("com.uniworkos.chat", "apple-thief", "linked@icloud.com", false, "n"), http.StatusConflict, "apple_account_conflict", ""},
		{"relay address someone holds", appletest.Claims("com.uniworkos.chat", "apple-relay", "held@privaterelay.appleid.com", true, "n"), http.StatusConflict, "apple_account_conflict", ""},
		{"address Apple does not own (link required)", appletest.Claims("com.uniworkos.chat", "apple-gmail", "verified@gmail.com", false, "n"), http.StatusConflict, "apple_account_conflict", ""},
		{"unverified account Apple cannot reclaim", appletest.Claims("com.uniworkos.chat", "apple-typed", "typed@gmail.com", false, "n"), http.StatusConflict, "apple_account_conflict", ""},
		{"address Apple does not vouch for", unverified, http.StatusUnauthorized, "apple_token_invalid", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, out := doJSON(t, srv, http.MethodPost, "/api/v1/auth/apple/native", "", appleBody(issuer.Token(t, tc.claims), "n"))
			if res.StatusCode != tc.status {
				t.Fatalf("status = %d, want %d: %v", res.StatusCode, tc.status, out)
			}
			if tc.code != "" {
				if e, _ := out["error"].(map[string]any); e["code"] != tc.code {
					t.Fatalf("error = %v, want %s", out, tc.code)
				}
				if _, ok := out["access_token"]; ok {
					t.Fatal("a refusal carries no session")
				}
				return
			}
			if out["access_token"] == nil || (tc.account != "" && out["account_id"] != tc.account) {
				t.Fatalf("session = %v, want account %s", out, tc.account)
			}
		})
	}
	var linked int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM users WHERE apple_id IS NOT NULL AND id IN ('01LEGACYRELAY', '01LEGACYGMAIL', '01LEGACYTYPED', '01LEGACYMFA')`).Scan(&linked); err != nil || linked != 0 {
		t.Fatalf("a refused sign-in links nothing: %d %v", linked, err)
	}
	var mfa, password bool
	if err := testPool.QueryRow(ctx, `SELECT mfa_enabled_at IS NOT NULL, password_hash IS NOT NULL FROM users WHERE id = '01LEGACYSQUAT'`).Scan(&mfa, &password); err != nil || mfa || password {
		t.Fatalf("the reclaim cleared the squatter's factors: mfa=%v password=%v %v", mfa, password, err)
	}
}
