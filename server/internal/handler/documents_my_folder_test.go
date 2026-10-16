package handler

import (
	"context"
	"testing"
)

func TestEnsureMyFolderRoute(t *testing.T) {
	w := newDocsWorld(t)
	path := "/api/v1/workspaces/" + w.wsID + "/documents/my-folder"

	// First call creates and returns 200 DocumentSDO; second call returns the same document id with 200.
	res1, out1 := doJSON(t, w.srv, "POST", path, w.token, nil)
	if res1.StatusCode != 200 {
		t.Fatalf("first POST my-folder = %d %v", res1.StatusCode, out1)
	}
	doc1, _ := out1["document"].(map[string]any)
	if doc1["kind"] != "folder" || doc1["title"] != "My Folder" || doc1["visibility"] != "restricted" {
		t.Fatalf("unexpected document SDO: %v", doc1)
	}
	res2, out2 := doJSON(t, w.srv, "POST", path, w.token, nil)
	if res2.StatusCode != 200 {
		t.Fatalf("second POST my-folder = %d %v", res2.StatusCode, out2)
	}
	doc2, _ := out2["document"].(map[string]any)
	if doc2["id"] != doc1["id"] {
		t.Fatalf("second POST id = %v, want %v", doc2["id"], doc1["id"])
	}

	// Outsider -> 404; deactivated member -> 403 member_deactivated.
	resOut, bodyOut := doJSON(t, w.srv, "POST", path, w.outsider, nil)
	if resOut.StatusCode != 404 {
		t.Fatalf("outsider POST my-folder = %d %v, want 404", resOut.StatusCode, bodyOut)
	}

	deactTok, deactID := docsJoinWorkspace(t, w, "deact-mf-http@example.com")
	resDeact1, _ := doJSON(t, w.srv, "POST", path, deactTok, nil)
	if resDeact1.StatusCode != 200 {
		t.Fatalf("active member POST my-folder = %d", resDeact1.StatusCode)
	}
	if _, err := testPool.Exec(context.Background(), `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, w.orgID, deactID); err != nil {
		t.Fatal(err)
	}
	resDeact2, bodyDeact2 := doJSON(t, w.srv, "POST", path, deactTok, nil)
	if code, _ := errCodeClass(bodyDeact2); resDeact2.StatusCode != 403 || code != "member_deactivated" {
		t.Fatalf("deactivated POST my-folder = %d %v, want 403 member_deactivated", resDeact2.StatusCode, bodyDeact2)
	}

	// §3 over HTTP: PATCH or archive on My Folder -> 409 my_folder_locked (error_class: conflict).
	mfID, _ := doc1["id"].(string)
	resPatch, bodyPatch := doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+mfID, w.token, map[string]any{
		"title": "Renamed", "revision": "1",
	})
	if code, class := errCodeClass(bodyPatch); resPatch.StatusCode != 409 || code != "my_folder_locked" || class != "conflict" {
		t.Fatalf("PATCH my-folder = %d code=%q class=%q, want 409 my_folder_locked/conflict", resPatch.StatusCode, code, class)
	}
}
