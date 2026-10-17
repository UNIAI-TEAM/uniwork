package router

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
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

// ADR 0031: the MCP connector's discovery documents and OAuth endpoints sit
// outside the api wrapper, because their bodies are RFC forms and documents,
// not SDI/SDO. They are bound here by hand and must stay off the OpenAPI spec.
func TestMCPOAuthRoutesAreMountedOutsideTheAPIWrapper(t *testing.T) {
	cfg := config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}
	mux := New(Deps{Cfg: cfg}, stubRoutes())
	bound := walk(t, mux)
	want := map[string]string{
		"GET /.well-known/oauth-protected-resource":     "McpProtectedResource",
		"GET /.well-known/oauth-protected-resource/mcp": "McpProtectedResource",
		"GET /.well-known/oauth-authorization-server":   "McpAuthorizationServer",
		"GET /oauth/authorize":                          "McpAuthorize",
		"POST /oauth/token":                             "McpToken",
		"POST /oauth/revoke":                            "McpRevoke",
		"POST /oauth/register":                          "McpRegister",
		"POST /mcp":                                     "McpServe",
		"GET /mcp":                                      "McpServe",
		"DELETE /mcp":                                   "McpServe",
	}
	for route, field := range want {
		if got := bound[route]; got != field {
			t.Errorf("%s is bound to %q, want Routes.%s", route, got, field)
		}
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	var spec struct {
		Paths map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil || len(spec.Paths) == 0 {
		t.Fatalf("swagger doc: %v (%d paths)", err, len(spec.Paths))
	}
	for path := range spec.Paths {
		if strings.HasPrefix(path, "/oauth") || strings.HasPrefix(path, "/.well-known") || strings.HasPrefix(path, "/mcp") {
			t.Errorf("%s is on the OpenAPI spec; RFC routes stay outside it (ADR 0031)", path)
		}
	}
}

// Upload session OpenAPI (UNI-1862): POST /api/v1/upload-sessions/{sessionID}/complete
// answers DocumentSDO for workspace sessions and DocumentUploadSDO for document
// sessions, so its 200 response schema offers both as oneOf; both DELETE
// upload-session operations advertise an empty-body 204 response.
func TestUploadSessionOpenAPISpec(t *testing.T) {
	cfg := config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}
	mux := New(Deps{Cfg: cfg}, stubRoutes())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /swagger/doc.json = %d, want 200", rec.Code)
	}

	type schemaRef struct {
		Ref   string      `json:"$ref"`
		OneOf []schemaRef `json:"oneOf"`
	}
	type operation struct {
		Responses map[string]struct {
			Description string `json:"description"`
			Content     map[string]struct {
				Schema schemaRef `json:"schema"`
			} `json:"content"`
		} `json:"responses"`
	}
	var spec struct {
		Paths      map[string]map[string]operation `json:"paths"`
		Components struct {
			Schemas map[string]schemaRef `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatalf("unmarshal swagger doc: %v", err)
	}

	completePath := "/api/v1/upload-sessions/{sessionID}/complete"
	completeSchema := spec.Paths[completePath]["post"].Responses["200"].Content["application/json"].Schema
	if name, ok := strings.CutPrefix(completeSchema.Ref, "#/components/schemas/"); ok {
		completeSchema = spec.Components.Schemas[name]
	}
	gotRefs := map[string]bool{}
	for _, item := range completeSchema.OneOf {
		gotRefs[item.Ref] = true
	}
	for _, wantRef := range []string{
		"#/components/schemas/SdoDocumentSDO",
		"#/components/schemas/SdoDocumentUploadSDO",
	} {
		if !gotRefs[wantRef] {
			t.Errorf("POST %s 200 schema oneOf = %+v, missing %s", completePath, completeSchema.OneOf, wantRef)
		}
	}
	if len(completeSchema.OneOf) != 2 {
		t.Errorf("POST %s 200 schema oneOf len = %d (%+v), want 2", completePath, len(completeSchema.OneOf), completeSchema.OneOf)
	}

	for _, delPath := range []string{
		"/api/v1/upload-sessions/{sessionID}",
		"/api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}",
	} {
		resps := spec.Paths[delPath]["delete"].Responses
		resp204, ok := resps["204"]
		if !ok {
			t.Errorf("DELETE %s responses = %v, missing 204", delPath, resps)
			continue
		}
		if len(resp204.Content) != 0 {
			t.Errorf("DELETE %s 204 content = %+v, want empty body (no content)", delPath, resp204.Content)
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

// The BYOK proxy forwards these request headers to the vendor
// (provider/byok_client.go). From a browser they only arrive when the CORS
// preflight lists them.
func TestCORSPreflightAllowsTheForwardedVendorHeaders(t *testing.T) {
	cfg := config.Config{FrontendOrigin: "http://localhost:3000"}
	mux := New(Deps{Cfg: cfg}, stubRoutes())
	for _, header := range []string{"anthropic-beta", "openai-organization", "openai-project", "http-referer", "x-title"} {
		req := httptest.NewRequest(http.MethodOptions, "/api/v1/orgs/o1/ai/byok/anthropic/messages", nil)
		req.Header.Set("Origin", cfg.FrontendOrigin)
		req.Header.Set("Access-Control-Request-Method", http.MethodPost)
		req.Header.Set("Access-Control-Request-Headers", header)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.EqualFold(got, header) {
			t.Errorf("preflight for %s: Access-Control-Allow-Headers = %q (status %d)", header, got, rec.Code)
		}
	}
}

// The access report export (UNI-1643) names its file and counts in response
// headers; a cross-origin browser reads them only when CORS exposes them.
func TestCORSExposesTheAccessReportExportHeaders(t *testing.T) {
	cfg := config.Config{FrontendOrigin: "http://localhost:3000"}
	mux := New(Deps{Cfg: cfg}, stubRoutes())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/w1/documents/access-report/export?format=csv", nil)
	req.Header.Set("Origin", cfg.FrontendOrigin)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	exposed := map[string]bool{}
	for _, h := range strings.Split(rec.Header().Get("Access-Control-Expose-Headers"), ",") {
		exposed[strings.ToLower(strings.TrimSpace(h))] = true
	}
	for _, header := range []string{"Content-Disposition", "X-Report-Rows", "X-Report-Skipped", "X-Report-Generated-At"} {
		if !exposed[strings.ToLower(header)] {
			t.Errorf("Access-Control-Expose-Headers lacks %s (got %q)", header, rec.Header().Get("Access-Control-Expose-Headers"))
		}
	}
}
