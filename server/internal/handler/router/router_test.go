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

func (fakeRoles) PlatformRole(context.Context, string) (string, bool, error) {
	return "admin", true, nil
}

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

// The router sheds load past HTTP_MAX_IN_FLIGHT with a 503 the browser can
// read (CORS headers and Retry-After), while the probes keep answering.
func TestRouterShedsLoadPastTheInFlightBound(t *testing.T) {
	cfg := config.Config{FrontendOrigin: "http://localhost:3000", HTTPMaxInFlight: 1}
	h := stubRoutes()
	entered, release := make(chan struct{}), make(chan struct{})
	h.Config = func(w http.ResponseWriter, _ *http.Request) {
		close(entered)
		<-release
	}
	mux := New(Deps{Cfg: cfg}, h)
	done := make(chan struct{})
	go func() {
		defer close(done)
		mux.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
	}()
	<-entered
	defer func() { close(release); <-done }()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("over the bound: %d Retry-After=%q, want 503 with Retry-After", rec.Code, rec.Header().Get("Retry-After"))
	}
	if rec.Header().Get("Access-Control-Allow-Origin") == "" {
		t.Fatal("a shed response without CORS headers is unreadable to the browser")
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code == http.StatusServiceUnavailable {
		t.Fatal("/healthz was shed")
	}
}

// The motions list is refetched by every client in the room after every
// ballot, and a formal meeting often sits behind one office NAT. Behind the
// 60/min credential budget a refused refetch right after a vote opens hides
// the vote from members; the list is a session/guest-gated read and lives on
// the global budget only (per signed-in user; per address for guests and
// anonymous callers).
func TestMotionListIsNotOnTheCredentialBudget(t *testing.T) {
	refuse := func(http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTooManyRequests) })
	}
	pass := func(next http.Handler) http.Handler { return next }
	mux := chi.NewRouter()
	registerPublicMeetings(newAPI(mux, &apiCatalog{}), stubRoutes(), refuse, pass, pass)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/meetings/m1/motions", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "ListMotions" {
		t.Fatalf("GET motions = %d %q, want 200 from ListMotions", rec.Code, rec.Body.String())
	}
}
