package handler

import (
	"context"
	"net/http"
	"testing"
)

// UNI-2052 w3 over HTTP: the batch read and the cancel.

func TestFolderUploadBatchGetAndCancel(t *testing.T) {
	z := newZipWorld(t)
	base := "/api/v1/workspaces/" + z.wsID + "/documents/folder-uploads"
	res, planned := doJSONHeaders(t, z.srv, "POST", base, z.token, map[string]string{"Idempotency-Key": "batch-1"}, folderUploadBody())
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("plan: %d %v", res.StatusCode, planned)
	}
	id, _ := planned["id"].(string)
	path := base + "/" + id

	// The creator reads it with a target per pending file.
	res, got := doJSON(t, z.srv, "GET", path, z.token, nil)
	if res.StatusCode != http.StatusOK || got["id"] != id || got["status"] != "open" {
		t.Fatalf("get: %d %v", res.StatusCode, got)
	}
	filesOut, _ := got["files"].([]any)
	if len(filesOut) != 2 {
		t.Fatalf("files = %v", got["files"])
	}
	for _, raw := range filesOut {
		f := raw.(map[string]any)
		if target, _ := f["target"].(map[string]any); f["status"] != "pending" || target == nil || target["url"] == "" {
			t.Fatalf("file = %v", f)
		}
	}
	// Another person, and an id that names no batch, get the same 404.
	for name, tok := range map[string]string{"outsider": z.outsider} {
		if res, _ := doJSON(t, z.srv, "GET", path, tok, nil); res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusForbidden {
			t.Fatalf("%s get: %d", name, res.StatusCode)
		}
		if res, _ := doJSON(t, z.srv, "DELETE", path, tok, nil); res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusForbidden {
			t.Fatalf("%s delete: %d", name, res.StatusCode)
		}
	}
	if res, _ := doJSON(t, z.srv, "GET", base+"/nope", z.token, nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown id: %d", res.StatusCode)
	}

	// DELETE answers the canceled batch, again the same, and GET after it is
	// the canceled batch without targets.
	res, canceled := doJSON(t, z.srv, "DELETE", path, z.token, nil)
	if res.StatusCode != http.StatusOK || canceled["status"] != "canceled" {
		t.Fatalf("delete: %d %v", res.StatusCode, canceled)
	}
	res, again := doJSON(t, z.srv, "DELETE", path, z.token, nil)
	if res.StatusCode != http.StatusOK || again["status"] != "canceled" {
		t.Fatalf("second delete: %d %v", res.StatusCode, again)
	}
	res, after := doJSON(t, z.srv, "GET", path, z.token, nil)
	if res.StatusCode != http.StatusOK || after["status"] != "canceled" {
		t.Fatalf("get after delete: %d %v", res.StatusCode, after)
	}
	counts, _ := after["counts"].(map[string]any)
	if counts["pending"] != float64(2) {
		t.Fatalf("counts = %v", counts)
	}
	for _, raw := range after["files"].([]any) {
		if raw.(map[string]any)["target"] != nil {
			t.Fatalf("canceled batch carries a target: %v", raw)
		}
	}
}

func TestFolderUploadBatchExpiredIs410(t *testing.T) {
	z := newZipWorld(t)
	base := "/api/v1/workspaces/" + z.wsID + "/documents/folder-uploads"
	_, planned := doJSONHeaders(t, z.srv, "POST", base, z.token, map[string]string{"Idempotency-Key": "batch-2"}, folderUploadBody())
	id, _ := planned["id"].(string)
	if _, err := testPool.Exec(context.Background(), `UPDATE document_folder_uploads SET expires_at = now() - interval '1 hour' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"GET", "DELETE"} {
		res, out := doJSON(t, z.srv, method, base+"/"+id, z.token, nil)
		if code, _ := errCodeClass(out); res.StatusCode != http.StatusGone || code != "folder_upload_expired" {
			t.Fatalf("%s expired: %d %v", method, res.StatusCode, out)
		}
	}
}

func TestFolderUploadFilesModeOverHTTP(t *testing.T) {
	z := newZipWorld(t)
	base := "/api/v1/workspaces/" + z.wsID + "/documents/folder-uploads"
	body := map[string]any{
		"parent_id": nil, "share_with_workspace": false,
		"files": []map[string]any{
			{"file_key": "f-1", "path": "", "filename": "a.md", "size_bytes": 4},
			{"file_key": "f-2", "path": "", "filename": "a.md", "size_bytes": 8},
		},
	}
	res, out := doJSONHeaders(t, z.srv, "POST", base, z.token, map[string]string{"Idempotency-Key": "files-1"}, body)
	if res.StatusCode != http.StatusCreated || out["mode"] != "files" || out["root_folder_id"] != nil || out["root_title"] != nil {
		t.Fatalf("plan: %d %v", res.StatusCode, out)
	}
	if folders, ok := out["folders"].([]any); !ok || len(folders) != 0 {
		t.Fatalf("folders = %v", out["folders"])
	}
	if files, _ := out["files"].([]any); len(files) != 2 {
		t.Fatalf("files = %v", out["files"])
	}
	// The folder mode answers its mode and its root.
	res, folder := doJSONHeaders(t, z.srv, "POST", base, z.token, map[string]string{"Idempotency-Key": "folder-1"}, folderUploadBody())
	if res.StatusCode != http.StatusCreated || folder["mode"] != "folder" || folder["root_folder_id"] == nil || folder["root_title"] != "Hồ sơ 2026" {
		t.Fatalf("folder plan: %d %v", res.StatusCode, folder)
	}
	// Folders without a root name are a 400 on the path.
	bad := map[string]any{"folders": []string{"x"}, "files": []map[string]any{{"file_key": "k", "path": "", "filename": "a.md", "size_bytes": 1}}}
	res, refused := doJSONHeaders(t, z.srv, "POST", base, z.token, map[string]string{"Idempotency-Key": "bad-1"}, bad)
	errObj, _ := refused["error"].(map[string]any)
	if fields, _ := errObj["fields"].(map[string]any); res.StatusCode != http.StatusBadRequest || fields["path"] == nil {
		t.Fatalf("mixed: %d %v", res.StatusCode, refused)
	}
}
