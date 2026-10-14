package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

// The change feed is on the spec with its query parameters and every wire
// field of the page and the row (G5-01a); no database needed.
func TestDocumentChangesOpenAPI(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	var spec struct {
		Paths map[string]struct {
			Get struct {
				Parameters []struct {
					Name string `json:"name"`
				} `json:"parameters"`
				Responses map[string]json.RawMessage `json:"responses"`
			} `json:"get"`
		} `json:"paths"`
		Components struct {
			Schemas map[string]struct {
				Properties map[string]json.RawMessage `json:"properties"`
			} `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	op, ok := spec.Paths["/api/v1/workspaces/{workspaceID}/documents/changes"]
	if !ok {
		t.Fatal("the change feed route is missing from the spec")
	}
	params := map[string]bool{}
	for _, p := range op.Get.Parameters {
		params[p.Name] = true
	}
	for _, name := range []string{"workspaceID", "cursor", "limit"} {
		if !params[name] {
			t.Errorf("missing parameter %s", name)
		}
	}
	if _, ok := op.Get.Responses["200"]; !ok {
		t.Fatal("missing the 200 response")
	}
	for schemaName, fields := range map[string][]string{
		"SdoDocumentChangeListSDO": {"phase", "changes", "has_more", "next_cursor", "expires_at"},
		"SdoDocumentChangeSDO":     {"document_id", "kind", "revision", "current_version", "version_id"},
	} {
		schema, ok := spec.Components.Schemas[schemaName]
		if !ok {
			t.Errorf("schema %s is missing from the spec", schemaName)
			continue
		}
		for _, field := range fields {
			if _, ok := schema.Properties[field]; !ok {
				t.Errorf("%s is missing %s", schemaName, field)
			}
		}
	}
	// BE-F1-1: revision is a decimal string on the wire (spec §3 invariant 2),
	// never a JSON number - a BIGINT above 2^53 would lose precision in JS.
	var revision struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(spec.Components.Schemas["SdoDocumentChangeSDO"].Properties["revision"], &revision); err != nil {
		t.Fatal(err)
	}
	if revision.Type != "string" {
		t.Fatalf("SdoDocumentChangeSDO.revision type = %q, want string", revision.Type)
	}
}
