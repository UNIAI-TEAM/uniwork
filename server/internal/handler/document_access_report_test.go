package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

// The access report (UNI-1643) is on the spec: the page and the export, each
// with its query parameters, and every wire field of the page. No database.
func TestAccessReportRoutesExistWithSDO(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	type operation struct {
		Parameters []struct {
			Name string `json:"name"`
			In   string `json:"in"`
		} `json:"parameters"`
		Responses map[string]json.RawMessage `json:"responses"`
	}
	var spec struct {
		Paths map[string]struct {
			Get *operation `json:"get"`
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
	for path, params := range map[string][]string{
		"/api/v1/workspaces/{workspaceID}/documents/access-report":        {"workspaceID", "folder_id", "person_id", "level", "visibility", "cursor", "limit"},
		"/api/v1/workspaces/{workspaceID}/documents/access-report/export": {"workspaceID", "folder_id", "person_id", "level", "visibility", "format"},
	} {
		item, ok := spec.Paths[path]
		if !ok || item.Get == nil {
			t.Errorf("GET %s is missing from the spec", path)
			continue
		}
		have := map[string]bool{}
		for _, p := range item.Get.Parameters {
			have[p.Name] = true
		}
		for _, p := range params {
			if !have[p] {
				t.Errorf("GET %s is missing the %s parameter", path, p)
			}
		}
		if _, ok := item.Get.Responses["200"]; !ok {
			t.Errorf("GET %s is missing the 200 response", path)
		}
	}
	for schemaName, fields := range map[string][]string{
		"SdoDocumentAccessReportSDO":         {"scope", "filter", "generated_at", "documents", "summary", "next_cursor"},
		"SdoDocumentAccessReportScopeDTO":    {"kind", "workspace_id", "folder_id", "folder_title"},
		"SdoDocumentAccessReportFilterDTO":   {"person_id", "level", "visibility"},
		"SdoDocumentAccessReportDocumentDTO": {"document", "rows"},
		"SdoDocumentAccessReportDocumentInfoDTO": {
			"id", "title", "kind", "visibility", "path", "acl_owner", "person_level", "live_link_count", "updated_at",
		},
		"SdoDocumentAccessReportRowDTO": {
			"source", "via", "principal_type", "principal_id", "principal_name", "level", "effective_level", "active",
			"granted_by", "granted_by_name", "granted_by_kind", "granted_at", "share_id",
		},
		"SdoDocumentAccessReportSummaryDTO": {"candidates", "documents", "rows", "skipped"},
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
