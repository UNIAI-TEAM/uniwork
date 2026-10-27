package handler

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDesktopAuthUnavailableResponsesAreNoStore(t *testing.T) {
	h := &handlers{}
	tests := []struct {
		name string
		h    http.HandlerFunc
		req  *http.Request
	}{
		{name: "start", h: h.desktopStart, req: httptest.NewRequest(http.MethodGet, "/auth/desktop/start", nil)},
		{name: "exchange", h: h.desktopExchange, req: httptest.NewRequest(http.MethodPost, "/auth/desktop/exchange", strings.NewReader(`{}`))},
		{name: "consent command", h: h.desktopConsentCommand, req: httptest.NewRequest(http.MethodPost, "/auth/desktop/authorize", strings.NewReader(`{}`))},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			tt.h(rec, tt.req)
			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
			}
			if got := rec.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", got)
			}
			if strings.Contains(rec.Body.String(), "token") {
				t.Fatalf("unavailable response contains a token-like field: %s", rec.Body.String())
			}
		})
	}
}

// The app's provider button rides the authorization URL of the PKCE start
// (spec §3.5); a provider that is not one is 400 invalid_request.
func TestDesktopStartPassesTheProviderHint(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("desktop-handler-test"), TTL: time.Minute}
	cfg := config.Config{FrontendOrigin: "http://localhost:13380", DesktopAuthClientID: "uniwork-office", DesktopAuthRedirectURIs: []string{"uniwork-office://auth/callback"}, DesktopAuthDeploymentIDs: []string{"default"}, DesktopAuthAttemptTTL: 10 * time.Minute, RefreshTokenTTL: time.Hour}
	h := &handlers{Deps: Deps{DesktopAuth: service.NewDesktopAuthService(pool, q, minter, cfg), Log: slog.Default()}}
	sum := sha256.Sum256([]byte("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"))
	start := func(provider string) (*httptest.ResponseRecorder, map[string]any) {
		v := url.Values{"client_id": {"uniwork-office"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"},
			"state": {"s-" + provider}, "redirect_uri": {"uniwork-office://auth/callback"}, "deployment_id": {"default"}}
		if provider != "" {
			v.Set("provider", provider)
		}
		rec := httptest.NewRecorder()
		h.desktopStart(rec, httptest.NewRequest(http.MethodGet, "/api/v1/auth/desktop/start?"+v.Encode(), nil))
		var out map[string]any
		_ = json.NewDecoder(rec.Body).Decode(&out)
		return rec, out
	}
	authorizeQuery := func(out map[string]any) url.Values {
		raw, _ := out["authorization_url"].(string)
		u, err := url.Parse(raw)
		if err != nil || raw == "" {
			t.Fatalf("authorization_url = %q", raw)
		}
		return u.Query()
	}
	rec, out := start("apple")
	if q := authorizeQuery(out); rec.Code != http.StatusOK || q.Get("provider") != "apple" || q.Get("attempt_id") == "" {
		t.Fatalf("apple: %d %v", rec.Code, out)
	}
	rec, out = start("")
	if q := authorizeQuery(out); rec.Code != http.StatusOK || q.Has("provider") {
		t.Fatalf("no hint: %d %v", rec.Code, out)
	}
	if rec, out := start("github"); rec.Code != http.StatusBadRequest || errorCode(out) != "invalid_request" {
		t.Fatalf("github: %d %v", rec.Code, out)
	}
}
