package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/metrics"
)

// The client series name a build only for a request the server authenticated:
// WithUserID tells the metrics middleware above it, and a request turned away
// (no or a bad bearer) or answered on a public route stays under "other".
func TestAuthenticatedRequestsAloneNameAClientBuild(t *testing.T) {
	minter := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	token, err := minter.Mint("01J8X4USER0000000000000001")
	if err != nil {
		t.Fatal(err)
	}
	registry := metrics.NewRegistry(metrics.RegistryOptions{})
	r := chi.NewRouter()
	r.Use(registry.HTTP.Middleware)
	ok := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }
	r.With(RequireAuth(minter)).Get("/me", ok)
	r.With(OptionalAuth(minter)).Get("/config", ok)
	call := func(path, version, bearer string) {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set(HeaderClientPlatform, "mobile")
		req.Header.Set(HeaderClientVersion, version)
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		r.ServeHTTP(httptest.NewRecorder(), req)
	}
	call("/me", "1.0.0", token)
	call("/config", "1.0.1", token)
	call("/config", "6.6.6", "")
	call("/me", "6.6.7", "not-a-token")

	rec := httptest.NewRecorder()
	metrics.NewHandler(registry.Gatherer).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := rec.Body.String()
	for _, want := range []string{`client_version="1.0.0"`, `client_version="1.0.1"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("an authenticated request names its build (%s):\n%s", want, body)
		}
	}
	if strings.Contains(body, "6.6.6") || strings.Contains(body, "6.6.7") {
		t.Fatalf("an anonymous or refused request named a build:\n%s", body)
	}
}
