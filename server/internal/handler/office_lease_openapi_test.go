package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

// The offline lease routes (G5-08s) are on the spec: PUT with its body and
// every wire field of the lease, DELETE beside it. No database needed.
func TestOfficeLeaseOpenAPI(t *testing.T) {
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
		Paths map[string]struct {
			Put    *operation `json:"put"`
			Delete *operation `json:"delete"`
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
	path, ok := spec.Paths["/api/v1/documents/{documentID}/office/offline-lease"]
	if !ok {
		t.Fatal("the offline lease route is missing from the spec")
	}
	if path.Put == nil || path.Delete == nil {
		t.Fatalf("offline lease route: put=%v delete=%v, want both", path.Put != nil, path.Delete != nil)
	}
	for method, op := range map[string]*operation{"PUT": path.Put, "DELETE": path.Delete} {
		found := false
		for _, p := range op.Parameters {
			found = found || p.Name == "documentID"
		}
		if !found {
			t.Errorf("%s is missing the documentID parameter", method)
		}
		if _, ok := op.Responses["200"]; !ok {
			t.Errorf("%s is missing the 200 response", method)
		}
	}
	if len(path.Put.RequestBody) == 0 {
		t.Error("PUT has no request body")
	}
	for schemaName, fields := range map[string][]string{
		"SdiPutOfficeOfflineLeaseSDI": {"lease"},
		"SdoOfficeOfflineLeaseSDO": {
			"lease", "lease_id", "document_id", "organization_id", "workspace_id", "version_id", "version",
			"revision", "level", "policy_epoch", "generation", "renewed", "issued_at", "expires_at", "renew_after", "server_time",
		},
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
}
