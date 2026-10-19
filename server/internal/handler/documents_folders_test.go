package handler

// Folder routes (UNI-1305): kind folder on POST .../documents, the
// containment and cycle answers, and the folder refusal on a version route.

import (
	"net/http"
	"testing"
)

func TestDocumentFolderRoutes(t *testing.T) {
	w := newDocsWorld(t)
	create := func(t *testing.T, body map[string]any) (int, map[string]any) {
		t.Helper()
		res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, body)
		return res.StatusCode, out
	}
	wantErr := func(t *testing.T, status int, out map[string]any, wantStatus int, wantCode string) {
		t.Helper()
		code, _ := errCodeClass(out)
		if status != wantStatus || code != wantCode {
			t.Fatalf("got %d %q, want %d %q (%v)", status, code, wantStatus, wantCode, out)
		}
	}

	status, out := create(t, map[string]any{"title": "Hợp đồng", "kind": "folder"})
	if status != http.StatusCreated {
		t.Fatalf("create folder: %d %v", status, out)
	}
	folder := out["document"].(map[string]any)
	folderID := folder["id"].(string)
	if folder["kind"] != "folder" || folder["content"] != nil {
		t.Fatalf("folder = %v", folder)
	}

	status, out = create(t, map[string]any{"title": "Con", "kind": "folder", "parent_id": folderID})
	if status != http.StatusCreated {
		t.Fatalf("nested folder: %d %v", status, out)
	}
	childID := out["document"].(map[string]any)["id"].(string)

	status, out = create(t, map[string]any{"title": "Trang", "kind": "page", "parent_id": childID})
	if status != http.StatusCreated {
		t.Fatalf("page in folder: %d %v", status, out)
	}
	pageID := out["document"].(map[string]any)["id"].(string)

	status, out = create(t, map[string]any{"title": "Sai chỗ", "kind": "folder", "parent_id": pageID})
	wantErr(t, status, out, http.StatusUnprocessableEntity, "document_parent_kind")

	status, out = create(t, map[string]any{"title": "Có nội dung", "kind": "folder",
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph"}}}})
	wantErr(t, status, out, http.StatusUnprocessableEntity, "folder_not_supported")

	status, out = create(t, map[string]any{"title": "Tệp", "kind": "file"})
	wantErr(t, status, out, http.StatusBadRequest, "invalid_request")

	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+folderID+"/move", w.token, map[string]any{
		"parent_id": childID, "revision": "1",
	})
	wantErr(t, res.StatusCode, out, http.StatusUnprocessableEntity, "document_cycle")

	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+folderID+"/versions", w.token, nil)
	wantErr(t, res.StatusCode, out, http.StatusUnprocessableEntity, "folder_not_supported")

	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?kind=folder", w.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list kind=folder: %d %v", res.StatusCode, out)
	}
	items, _ := out["documents"].([]any)
	if len(items) != 2 {
		t.Fatalf("kind=folder listed %d rows, want 2: %v", len(items), out)
	}

	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/tree", w.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("tree: %d %v", res.StatusCode, out)
	}
	nodes, _ := out["documents"].([]any)
	var found bool
	for _, n := range nodes {
		node := n.(map[string]any)
		if node["id"] == folderID && node["kind"] == "folder" {
			found = true
		}
	}
	if !found {
		t.Fatalf("tree has no folder node %s: %v", folderID, out)
	}

	// FD-03 (UNI-1463): folders_only serves the FOLDERS sidebar - the same
	// forest cut to kind=folder.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/tree?folders_only=true", w.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("folders_only tree: %d %v", res.StatusCode, out)
	}
	nodes, _ = out["documents"].([]any)
	if len(nodes) != 1 || nodes[0].(map[string]any)["id"] != folderID {
		t.Fatalf("folders_only roots = %v, want the one folder %s", nodes, folderID)
	}
	var countFolders func(list []any) int
	countFolders = func(list []any) int {
		count := 0
		for _, n := range list {
			node := n.(map[string]any)
			if node["kind"] != "folder" {
				t.Fatalf("folders_only tree carries a %v node: %v", node["kind"], out)
			}
			count++
			children, _ := node["children"].([]any)
			count += countFolders(children)
		}
		return count
	}
	if got := countFolders(nodes); got != 2 {
		t.Fatalf("folders_only tree has %d nodes, want the two folders: %v", got, out)
	}

	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/tree?folders_only=maybe", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != http.StatusBadRequest || code != "invalid_request" {
		t.Fatalf("folders_only=maybe: %d code=%q %v", res.StatusCode, code, out)
	}
}

// A folder has no public link: the create is refused by name and nothing is
// stored, so there is no token to read it with.
func TestDocumentFolderRefusesPublicLinks(t *testing.T) {
	w := newDocsWorld(t)
	res, out := doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.token, map[string]any{"public_links_enabled": true})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("enable links: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, map[string]any{"title": "Riêng", "kind": "folder"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create folder: %d %v", res.StatusCode, out)
	}
	folderID := out["document"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+folderID+"/links", w.token, map[string]any{"expires_in_days": 7})
	if code, _ := errCodeClass(out); res.StatusCode != http.StatusUnprocessableEntity || code != "folder_not_supported" {
		t.Fatalf("link on a folder: %d code=%q %v", res.StatusCode, code, out)
	}
}

// UNI-1974: a folder is never shared. Every route that would open one answers
// 422 folder_not_shareable, and the folder stays private.
func TestDocumentFolderIsNeverShared(t *testing.T) {
	w := newDocsWorld(t)
	base := "/api/v1/workspaces/" + w.wsID + "/documents"
	want := func(t *testing.T, label string, res *http.Response, out map[string]any) {
		t.Helper()
		if code, _ := errCodeClass(out); res.StatusCode != http.StatusUnprocessableEntity || code != "folder_not_shareable" {
			t.Fatalf("%s: %d code=%q %v", label, res.StatusCode, code, out)
		}
	}

	res, out := doJSON(t, w.srv, "POST", base, w.token, map[string]any{"title": "Mở sẵn", "kind": "folder", "visibility": "workspace"})
	want(t, "create a workspace folder", res, out)

	res, out = doJSON(t, w.srv, "POST", base, w.token, map[string]any{"title": "Riêng", "kind": "folder"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create folder: %d %v", res.StatusCode, out)
	}
	folder := out["document"].(map[string]any)
	folderID := folder["id"].(string)
	if folder["visibility"] != "restricted" {
		t.Fatalf("a folder is private at create, got %v", folder["visibility"])
	}

	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+folderID+"/shares", w.token, map[string]any{
		"principal_type": "workspace", "principal_id": w.wsID, "level": "view",
	})
	want(t, "share to the workspace", res, out)

	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+folderID+"/shares/batch", w.token, map[string]any{
		"principal_ids": []string{w.userID}, "level": "view",
	})
	want(t, "share batch", res, out)

	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+folderID, w.token, map[string]any{
		"revision": folder["revision"], "visibility": "workspace",
	})
	want(t, "patch visibility", res, out)

	// A page inside the folder is private: the folder passes nothing on.
	res, out = doJSON(t, w.srv, "POST", base, w.token, map[string]any{"title": "Trang", "kind": "page", "parent_id": folderID})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("page in folder: %d %v", res.StatusCode, out)
	}
	if v := out["document"].(map[string]any)["visibility"]; v != "restricted" {
		t.Fatalf("a page in a folder is private, got %v", v)
	}
}
