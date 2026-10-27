package handler

import "testing"

// UNI-2225: the template routes over the real router.

func templatePath(documentID string) string {
	return "/api/v1/documents/" + documentID + "/template"
}

func newTemplateFile(t *testing.T, w *docsWorld, visibility string) string {
	t.Helper()
	status, out := createFileDocWithFields(t, w, map[string]string{"title": "Mẫu", "visibility": visibility})
	if status != 201 {
		t.Fatalf("create file = %d %v", status, out)
	}
	return out["document"].(map[string]any)["id"].(string)
}

func TestDocumentTemplateMarkAndUnmark(t *testing.T) {
	w := newDocsWorld(t)
	id := newTemplateFile(t, w, "workspace")

	res, out := doJSON(t, w.srv, "POST", templatePath(id), w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("mark = %d %v", res.StatusCode, out)
	}
	doc := out["document"].(map[string]any)
	if at, _ := doc["template_marked_at"].(string); at == "" {
		t.Fatalf("template_marked_at missing: %v", doc)
	}
	if by, _ := doc["template_marked_by"].(string); by != w.userID {
		t.Fatalf("template_marked_by = %v, want %s", doc["template_marked_by"], w.userID)
	}

	res, out = doJSON(t, w.srv, "DELETE", templatePath(id), w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("unmark = %d %v", res.StatusCode, out)
	}
	if _, ok := out["document"].(map[string]any)["template_marked_at"]; ok {
		t.Fatalf("template_marked_at still present: %v", out)
	}
}

func TestDocumentTemplateRestrictedNeedsWidening(t *testing.T) {
	w := newDocsWorld(t)
	id := newTemplateFile(t, w, "restricted")

	res, out := doJSON(t, w.srv, "POST", templatePath(id), w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "template_widens_visibility" {
		t.Fatalf("restricted mark = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", templatePath(id), w.token, map[string]any{"widen_to_workspace": true})
	if res.StatusCode != 200 {
		t.Fatalf("widened mark = %d %v", res.StatusCode, out)
	}
	if out["document"].(map[string]any)["visibility"] != "workspace" {
		t.Fatalf("visibility not widened: %v", out)
	}
}

func TestDocumentTemplateMalformedBody(t *testing.T) {
	w := newDocsWorld(t)
	id := newTemplateFile(t, w, "workspace")
	res, out := doJSON(t, w.srv, "POST", templatePath(id), w.token, "not an object")
	if res.StatusCode != 400 {
		t.Fatalf("malformed body = %d %v", res.StatusCode, out)
	}
}

func TestDocumentTemplateList(t *testing.T) {
	w := newDocsWorld(t)
	id := newTemplateFile(t, w, "workspace")
	newTemplateFile(t, w, "workspace") // never marked: must not be listed
	if res, out := doJSON(t, w.srv, "POST", templatePath(id), w.token, nil); res.StatusCode != 200 {
		t.Fatalf("mark = %d %v", res.StatusCode, out)
	}

	base := "/api/v1/workspaces/" + w.wsID + "/documents/templates"
	res, out := doJSON(t, w.srv, "GET", base, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list = %d %v", res.StatusCode, out)
	}
	items, _ := out["documents"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["id"] != id {
		t.Fatalf("list = %v", out)
	}
	if at, _ := items[0].(map[string]any)["template_marked_at"].(string); at == "" {
		t.Fatalf("row lacks template_marked_at: %v", items[0])
	}

	res, out = doJSON(t, w.srv, "GET", base+"?type=nope", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_type" {
		t.Fatalf("bad type = %d %v", res.StatusCode, out)
	}
}

func TestDocumentTemplateUploadFlag(t *testing.T) {
	w := newDocsWorld(t)
	status, out := createFileDocWithFields(t, w, map[string]string{"title": "Mẫu tải lên", "template": "true"})
	if status != 201 {
		t.Fatalf("template upload = %d %v", status, out)
	}
	if at, _ := out["document"].(map[string]any)["template_marked_at"].(string); at == "" {
		t.Fatalf("upload not marked: %v", out)
	}
}

func TestDocumentTemplateUploadFlagValidation(t *testing.T) {
	w := newDocsWorld(t)
	for name, fields := range map[string]map[string]string{
		"unknown value":         {"title": "Mẫu", "template": "maybe"},
		"template and private":  {"title": "Mẫu", "template": "true", "visibility": "restricted"},
		"false is a plain file": {"title": "Tệp", "template": "FALSE"},
	} {
		status, out := createFileDocWithFields(t, w, fields)
		want := 400
		if name == "false is a plain file" {
			want = 201
		}
		if status != want {
			t.Fatalf("%s = %d %v, want %d", name, status, out, want)
		}
	}
	status, out := createFileDocWithFields(t, w, map[string]string{"title": "Mẫu", "template": "true", "visibility": "workspace"})
	if status != 201 {
		t.Fatalf("template with visibility=workspace = %d %v", status, out)
	}
}

func TestDocumentTemplateRequiresSession(t *testing.T) {
	w := newDocsWorld(t)
	id := newTemplateFile(t, w, "workspace")
	for _, m := range []string{"POST", "DELETE"} {
		if res, _ := doJSON(t, w.srv, m, templatePath(id), "", nil); res.StatusCode != 401 {
			t.Fatalf("%s without session = %d", m, res.StatusCode)
		}
	}
	res, _ := doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/templates", "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("list without session = %d", res.StatusCode)
	}
}
