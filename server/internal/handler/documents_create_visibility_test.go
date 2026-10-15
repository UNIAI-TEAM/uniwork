package handler

import (
	"encoding/json"
	"testing"
)

// SH-S1 T3 (UNI-1780) / S-DOC02: the two file create routes accept the
// optional visibility field - a multipart form field on the upload route and
// a JSON field on the blank route. The field names the home row the new
// document opens with; anything but workspace|restricted is a 400
// invalid_request (no fields).

// createFileDocWithFields posts one file document through the multipart route
// with the given form fields and decodes the answer.
func createFileDocWithFields(t *testing.T, w *docsWorld, fields map[string]string) (int, map[string]any) {
	t.Helper()
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files", w.token,
		fields, "bao-cao.txt", []byte("quarterly report body, utf-8 text\n"), nil)
	var out map[string]any
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("decode %s: %v", raw, err)
		}
	}
	return res.StatusCode, out
}

func TestCreateDocumentFileVisibilityField(t *testing.T) {
	w := newDocsWorld(t)

	t.Run("workspace opens the home row", func(t *testing.T) {
		status, out := createFileDocWithFields(t, w, map[string]string{"title": "Chia sẻ", "visibility": "workspace"})
		if status != 201 {
			t.Fatalf("create = %d %v", status, out)
		}
		if v := out["document"].(map[string]any)["visibility"]; v != "workspace" {
			t.Fatalf("visibility = %v, want workspace", v)
		}
	})

	t.Run("a value outside the allowlist is refused", func(t *testing.T) {
		status, out := createFileDocWithFields(t, w, map[string]string{"title": "Sai", "visibility": "public"})
		if code, _ := errCodeClass(out); status != 400 || code != "invalid_request" {
			t.Fatalf("bad visibility = %d %v", status, out)
		}
		if fields, ok := out["error"].(map[string]any)["fields"]; ok && fields != nil {
			t.Fatalf("refusal carries fields: %v", out)
		}
	})
}

func TestCreateBlankDocumentFileVisibilityField(t *testing.T) {
	w := newOfficeWorld(t, true)
	path := "/api/v1/workspaces/" + w.wsID + "/documents/files/blank"

	res, out := doJSON(t, w.srv, "POST", path, w.token,
		map[string]string{"format": "docx", "title": "Chia sẻ", "visibility": "workspace"})
	if res.StatusCode != 201 {
		t.Fatalf("blank workspace = %d %v", res.StatusCode, out)
	}
	if v := out["document"].(map[string]any)["visibility"]; v != "workspace" {
		t.Fatalf("visibility = %v, want workspace", v)
	}

	res, out = doJSON(t, w.srv, "POST", path, w.token,
		map[string]string{"format": "docx", "title": "Riêng", "visibility": "restricted"})
	if res.StatusCode != 201 {
		t.Fatalf("blank restricted = %d %v", res.StatusCode, out)
	}
	if v := out["document"].(map[string]any)["visibility"]; v != "restricted" {
		t.Fatalf("visibility = %v, want restricted", v)
	}

	res, out = doJSON(t, w.srv, "POST", path, w.token,
		map[string]string{"format": "docx", "title": "Sai", "visibility": "public"})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("bad visibility = %d %v", res.StatusCode, out)
	}
}
