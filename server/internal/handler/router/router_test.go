package router

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/config"
)

type fakeRoles struct{}

func (fakeRoles) PlatformRole(context.Context, string) (string, error) { return "admin", nil }

// stubRoutes fills every Routes field with a handler that answers with the
// field's name, so a walk over the mux can tell which fields it reached.
func stubRoutes() Routes {
	var h Routes
	v := reflect.ValueOf(&h).Elem()
	for i := 0; i < v.NumField(); i++ {
		name := v.Type().Field(i).Name
		v.Field(i).Set(reflect.ValueOf(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(name))
		})))
	}
	return h
}

// walk calls every endpoint handler directly (no middleware) and returns
// route → what it wrote, i.e. the Routes field bound there.
func walk(t *testing.T, mux http.Handler) map[string]string {
	t.Helper()
	bound := map[string]string{}
	err := chi.Walk(mux.(chi.Routes), func(method, route string, h http.Handler, _ ...func(http.Handler) http.Handler) error {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(method, "/", nil))
		bound[method+" "+route] = rec.Body.String()
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return bound
}

// A Routes field that no route file binds is a handler nobody can reach;
// this catches the missing line the compiler cannot.
func TestEveryRouteFieldIsBound(t *testing.T) {
	cfg := config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true, AdminRateLimitPerMin: 60}
	bound := walk(t, New(Deps{Cfg: cfg, PlatformRoles: fakeRoles{}}, stubRoutes()))

	seen := map[string]bool{}
	for _, name := range bound {
		seen[name] = true
	}
	rt := reflect.TypeOf(Routes{})
	for i := 0; i < rt.NumField(); i++ {
		if !seen[rt.Field(i).Name] {
			t.Errorf("Routes.%s is not bound to any route", rt.Field(i).Name)
		}
	}
	for _, want := range []string{"GET /healthz", "GET /api/v1/admin/me", "GET /swagger/doc.json", "POST /api/v1/rum"} {
		if _, ok := bound[want]; !ok {
			t.Errorf("missing route %s", want)
		}
	}
}

// Without a platform-role source the admin console does not exist: no
// route, not a 403 — a tenant cannot learn the console is there.
func TestAdminRoutesNeedPlatformRoleSource(t *testing.T) {
	cfg := config.Config{FrontendOrigin: "http://localhost:3000"}
	bound := walk(t, New(Deps{Cfg: cfg}, stubRoutes()))
	for route := range bound {
		if len(route) > 18 && route[len(route)-len("/admin/me"):] == "/admin/me" {
			t.Fatalf("admin route registered without PlatformRoles: %s", route)
		}
	}
	if _, ok := bound["GET /swagger/doc.json"]; ok {
		t.Fatal("swagger mounted while EnableSwagger is false")
	}
}
