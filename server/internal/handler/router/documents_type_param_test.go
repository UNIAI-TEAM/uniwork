package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

// UNI-2113 contract A: the four document list routes and the sources route document `type` as one
// query parameter that repeats (?type=docx&type=xlsx), so a generated client
// sends one type= per value instead of a comma-joined string.
func TestDocumentListsDocumentTheRepeatedTypeParam(t *testing.T) {
	cfg := config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}
	mux := New(Deps{Cfg: cfg}, stubRoutes())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /swagger/doc.json = %d, want 200", rec.Code)
	}
	var spec struct {
		Paths map[string]map[string]struct {
			Parameters []struct {
				Name    string `json:"name"`
				In      string `json:"in"`
				Explode *bool  `json:"explode"`
				Schema  struct {
					Type  string `json:"type"`
					Items struct {
						Type string `json:"type"`
					} `json:"items"`
				} `json:"schema"`
			} `json:"parameters"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/workspaces/{workspaceID}/documents"
	for _, path := range []string{base, base + "/recent", base + "/favorites", base + "/shared-with-me", base + "/sources"} {
		found := false
		for _, p := range spec.Paths[path]["get"].Parameters {
			if p.Name != "type" {
				continue
			}
			found = true
			if p.In != "query" || p.Schema.Type != "array" || p.Schema.Items.Type != "string" {
				t.Errorf("%s: type = in %q schema %q of %q, want a query array of strings", path, p.In, p.Schema.Type, p.Schema.Items.Type)
			}
			if p.Explode != nil && !*p.Explode {
				t.Errorf("%s: type is not exploded, so it would not repeat", path)
			}
		}
		if !found {
			t.Errorf("%s documents no type query parameter", path)
		}
	}
}
