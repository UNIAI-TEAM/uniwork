package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

// The zip download job routes (UNI-2045 SV-9) are on the spec with their path
// parameters, the 202, and every wire field of the SDI/SDO. No database needed.
func TestDocumentDownloadJobOpenAPI(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	type operation struct {
		Parameters []struct {
			Name string `json:"name"`
		} `json:"parameters"`
		RequestBody json.RawMessage            `json:"requestBody"`
		Responses   map[string]json.RawMessage `json:"responses"`
	}
	var spec struct {
		Paths      map[string]map[string]*operation `json:"paths"`
		Components struct {
			Schemas map[string]struct {
				Properties map[string]json.RawMessage `json:"properties"`
			} `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	const base = "/api/v1/workspaces/{workspaceID}/documents/download-jobs"
	routes := []struct {
		method, path, status string
		params               []string
		body                 bool
	}{
		{"post", base, "202", []string{"workspaceID"}, true},
		{"get", base + "/{jobID}", "200", []string{"workspaceID", "jobID"}, false},
		{"get", base + "/{jobID}/download", "200", []string{"workspaceID", "jobID"}, false},
	}
	for _, r := range routes {
		op := spec.Paths[r.path][r.method]
		if op == nil {
			t.Errorf("spec lacks %s %s", r.method, r.path)
			continue
		}
		if _, ok := op.Responses[r.status]; !ok {
			t.Errorf("%s %s has no %s response: %v", r.method, r.path, r.status, op.Responses)
		}
		if (len(op.RequestBody) > 0) != r.body {
			t.Errorf("%s %s request body documented = %v, want %v", r.method, r.path, len(op.RequestBody) > 0, r.body)
		}
		have := map[string]bool{}
		for _, p := range op.Parameters {
			have[p.Name] = true
		}
		for _, p := range r.params {
			if !have[p] {
				t.Errorf("%s %s lacks path parameter %s", r.method, r.path, p)
			}
		}
	}
	for schema, fields := range map[string][]string{
		"SdiCreateDocumentDownloadJobSDI": {"document_ids"},
		"SdoDocumentDownloadJobSDO":       {"id", "status", "created_at", "expires_at", "download_url", "file_count", "skipped", "error"},
		"SdoDocumentDownloadSkipSDO":      {"document_id", "reason"},
	} {
		s, ok := spec.Components.Schemas[schema]
		if !ok {
			t.Errorf("spec lacks schema %s", schema)
			continue
		}
		for _, f := range fields {
			if _, ok := s.Properties[f]; !ok {
				t.Errorf("schema %s lacks field %s", schema, f)
			}
		}
	}
}
