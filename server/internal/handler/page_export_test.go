package handler

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
)

// POST /documents/{documentID}/export (UNI-2004) over HTTP: the page_export
// flag closes it, the body names docx or pdf, only a page exports, and a
// non-reader cannot tell the page exists. The service tests hold the job,
// the engine input and the access log; the stub engine here binds no export,
// so the owner's own call ends at the engine's capability gate.
func TestPageExportRoute(t *testing.T) {
	w := newOfficeWorld(t, true)
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, map[string]any{"title": "Biên bản họp", "kind": "page"})
	if res.StatusCode != 201 {
		t.Fatalf("create page: %d %v", res.StatusCode, out)
	}
	pageID := out["document"].(map[string]any)["id"].(string)
	path := func(id string) string { return "/api/v1/documents/" + id + "/export" }
	docx := map[string]string{"format": "docx"}

	res, out = doJSON(t, w.srv, "POST", path(pageID), w.token, docx)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "feature_disabled" {
		t.Fatalf("flag off = %d %v", res.StatusCode, out)
	}
	setFlagOverride(t, "page_export", featureflags.ScopeOrganization, w.orgID, true)
	t.Cleanup(func() { clearFlagOverride(t, "page_export", featureflags.ScopeOrganization, w.orgID) })

	res, out = doJSON(t, w.srv, "POST", path(pageID), w.token, map[string]string{"format": "md"})
	if res.StatusCode != 400 {
		t.Fatalf("format md = %d %v", res.StatusCode, out)
	}
	fileID := w.createMarkdownFile(t, "# Ghi chu\n")
	res, out = doJSON(t, w.srv, "POST", path(fileID), w.token, docx)
	if code, _ := errCodeClass(out); res.StatusCode != 422 || code != "page_export_not_page" {
		t.Fatalf("file document = %d %v", res.StatusCode, out)
	}
	// An unknown id names no organization for the flag, so it closes there;
	// the page itself answers not_found to a member outside its workspace.
	res, out = doJSON(t, w.srv, "POST", path("01J8X4DOC0N1P2Q3R4S5T6U8"), w.token, docx)
	if res.StatusCode != 404 {
		t.Fatalf("unknown id = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", path(pageID), w.outsiderToken(t), docx)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("outsider = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", path(pageID), w.token, docx)
	if code, _ := errCodeClass(out); res.StatusCode != 501 || code != "unsupported_operation" {
		t.Fatalf("owner on an engine without export = %d %v", res.StatusCode, out)
	}
}

// GET /documents/{documentID}/export (follow-6): the formats the menu may
// offer, behind the same flag and read gate; the stub engine binds no export,
// so it offers none.
func TestPageExportFormatsRoute(t *testing.T) {
	w := newOfficeWorld(t, true)
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, map[string]any{"title": "Biên bản họp", "kind": "page"})
	if res.StatusCode != 201 {
		t.Fatalf("create page: %d %v", res.StatusCode, out)
	}
	path := "/api/v1/documents/" + out["document"].(map[string]any)["id"].(string) + "/export"
	res, out = doJSON(t, w.srv, "GET", path, w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "feature_disabled" {
		t.Fatalf("flag off = %d %v", res.StatusCode, out)
	}
	setFlagOverride(t, "page_export", featureflags.ScopeOrganization, w.orgID, true)
	t.Cleanup(func() { clearFlagOverride(t, "page_export", featureflags.ScopeOrganization, w.orgID) })
	res, out = doJSON(t, w.srv, "GET", path, w.outsiderToken(t), nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("outsider = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", path, w.token, nil)
	if formats, ok := out["formats"].([]any); res.StatusCode != 200 || !ok || len(formats) != 0 {
		t.Fatalf("owner on an engine without export = %d %v", res.StatusCode, out)
	}
}
