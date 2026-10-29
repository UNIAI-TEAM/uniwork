package router

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/config"
)

// UniWork never stores, receives or forwards a person's own AI provider key:
// no route on the session mount or the Office frame mount reads a key store
// or proxies to a vendor.
func TestNoProviderKeyRoutes(t *testing.T) {
	cfg := config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true, AdminRateLimitPerMin: 60}
	mux := New(Deps{Cfg: cfg, PlatformRoles: fakeRoles{}}, stubRoutes())

	err := chi.Walk(mux.(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.Contains(route, "/ai/credentials") || strings.Contains(route, "/ai/byok/") {
			t.Errorf("route %s %s still registered; Office AI runs on UniWork AI only", method, route)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
