package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/config"
)

func TestSwaggerRoutesOffByDefault(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000"}, Log: slog.Default()})
	req := httptest.NewRequest(http.MethodGet, "/swagger/index.html", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when EnableSwagger is false", rec.Code)
	}
}

func TestSwaggerSpecFollowsChiRoutesAndSDI(t *testing.T) {
	h := New(Deps{
		Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true},
		Log: slog.Default(),
	})
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)

	res, err := srv.Client().Get(srv.URL + "/swagger/doc.json")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("doc.json status = %d, want 200", res.StatusCode)
	}
	var spec struct {
		OpenAPI    string                     `json:"openapi"`
		Paths      map[string]json.RawMessage `json:"paths"`
		Components struct {
			Schemas map[string]json.RawMessage `json:"schemas"`
		} `json:"components"`
	}
	if err := json.NewDecoder(res.Body).Decode(&spec); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(spec.OpenAPI, "3.") {
		t.Fatalf("openapi = %q, want 3.x", spec.OpenAPI)
	}

	router, ok := h.(chi.Routes)
	if !ok {
		t.Fatal("handler is not chi.Routes")
	}
	missing := []string{}
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		switch {
		case strings.HasPrefix(route, "/swagger"):
			return nil
		case strings.HasPrefix(route, "/uploads"):
			return nil
		case route == "/api/v1/ws":
			return nil
		case method == http.MethodOptions:
			return nil
		}
		route = strings.TrimSuffix(route, "/")
		body, ok := spec.Paths[route]
		if !ok {
			missing = append(missing, method+" "+route)
			return nil
		}
		var methods map[string]json.RawMessage
		if err := json.Unmarshal(body, &methods); err != nil {
			t.Errorf("%s: %v", route, err)
			return nil
		}
		if _, ok := methods[strings.ToLower(method)]; !ok {
			missing = append(missing, method+" "+route)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(missing) > 0 {
		t.Fatalf("OpenAPI missing Chi routes: %s", strings.Join(missing, ", "))
	}

	loginSDI := spec.Components.Schemas["SdiLoginSDI"]
	if !strings.Contains(string(loginSDI), "email") || !strings.Contains(string(loginSDI), "password") {
		t.Fatalf("login SDI not reflected in spec: %s", loginSDI)
	}
	if !strings.Contains(string(loginSDI), "an@acme.vn") {
		t.Fatalf("login SDI missing example: %s", loginSDI)
	}
}
