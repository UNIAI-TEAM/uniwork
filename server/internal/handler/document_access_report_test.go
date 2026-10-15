package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func accessReportDocIDs(t *testing.T, out map[string]any) []string {
	t.Helper()
	raw, ok := out["documents"].([]any)
	if !ok {
		t.Fatalf("documents missing: %v", out)
	}
	ids := make([]string, 0, len(raw))
	for _, item := range raw {
		ids = append(ids, item.(map[string]any)["document"].(map[string]any)["id"].(string))
	}
	return ids
}

// The handler half of the report: query parsing, the cursor guard, the 400s
// and the export headers (contract v1 §10 S13).
func TestAccessReportHandlerParams(t *testing.T) {
	w := newDocsWorld(t)
	for _, title := range []string{"Một", "Hai", "Ba"} {
		docsCreatePageBody(t, w, w.token, map[string]any{"title": title, "kind": "page"})
	}
	base := "/api/v1/workspaces/" + w.wsID + "/documents/access-report"

	res, out := doJSON(t, w.srv, "GET", base+"?limit=2", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("page 1: %d %v", res.StatusCode, out)
	}
	if ids := accessReportDocIDs(t, out); len(ids) != 2 {
		t.Fatalf("page 1 ids = %v", ids)
	}
	cursor, _ := out["next_cursor"].(string)
	if cursor == "" {
		t.Fatalf("a full page carries a cursor: %v", out)
	}
	if scope := out["scope"].(map[string]any); scope["kind"] != "workspace" || scope["folder_id"] != nil {
		t.Fatalf("scope = %v", scope)
	}
	if filter := out["filter"].(map[string]any); filter["person_id"] != nil || len(filter["level"].([]any)) != 0 {
		t.Fatalf("filter = %v", filter)
	}
	res, out = doJSON(t, w.srv, "GET", base+"?limit=2&cursor="+cursor, w.token, nil)
	if res.StatusCode != 200 || len(accessReportDocIDs(t, out)) != 1 || out["next_cursor"] != nil {
		t.Fatalf("page 2: %d %v", res.StatusCode, out)
	}

	for name, query := range map[string]string{
		"garbage cursor":         "?cursor=***",
		"undecodable cursor":     "?cursor=bm90LWpzb24",
		"cursor of other filter": "?level=view&cursor=" + cursor,
		"cursor of other folder": "?folder_id=01J8X4FLD0N1P2Q3R4S5T6U7&cursor=" + cursor,
		"negative limit":         "?limit=-1",
		"non-numeric limit":      "?limit=abc",
		"unknown level":          "?level=owner",
		"unknown visibility":     "?visibility=public",
	} {
		res, out := doJSON(t, w.srv, "GET", base+query, w.token, nil)
		if res.StatusCode != 400 {
			t.Errorf("%s: %d %v, want 400", name, res.StatusCode, out)
		}
	}

	res, out = doJSON(t, w.srv, "GET", base+"?folder_id=01J8X4FLD0N1P2Q3R4S5T6U7", w.token, nil)
	wantErr(t, res, out, 404, "not_found", "")

	req, _ := http.NewRequest("GET", w.srv.URL+base+"/export?format=csv&level=manage,view", nil)
	req.Header.Set("Authorization", "Bearer "+w.token)
	resp, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := readAll(resp)
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/csv") {
		t.Fatalf("export: %d %q %s", resp.StatusCode, resp.Header.Get("Content-Type"), body)
	}
	if cd := resp.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, `attachment; filename="access-report-docs-ws-`) || !strings.HasSuffix(cd, `.csv"`) {
		t.Fatalf("Content-Disposition = %q", cd)
	}
	if resp.Header.Get("X-Report-Rows") == "" || resp.Header.Get("X-Report-Skipped") != "0" || resp.Header.Get("X-Report-Generated-At") == "" {
		t.Fatalf("report headers: %v", resp.Header)
	}
	if !bytes.HasPrefix(body, []byte{0xEF, 0xBB, 0xBF}) {
		t.Fatal("the CSV export starts without a BOM")
	}
	for name, query := range map[string]string{"missing format": "", "unknown format": "?format=pdf"} {
		res, out := doJSON(t, w.srv, "GET", base+"/export"+query, w.token, nil)
		if res.StatusCode != 400 {
			t.Errorf("%s: %d %v, want 400", name, res.StatusCode, out)
		}
	}
	res, out = doJSON(t, w.srv, "GET", base+"/export?format=xlsx", w.outsider, nil)
	if res.StatusCode != 403 && res.StatusCode != 404 {
		t.Fatalf("outsider export: %d %v", res.StatusCode, out)
	}
}
