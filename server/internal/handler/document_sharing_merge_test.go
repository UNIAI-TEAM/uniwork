package handler

// SH-S1 T4 (UNI-1780) at the wire: a share naming the document's own
// workspace merges into the home row. The route answers 201 in the existing
// DocumentShareSDO shape - the home-row grant with no id and no created_at -
// writes no document_shares row, and refuses manage with 422 level_not_allowed
// (Q-S1).

import (
	"testing"
)

func TestDocumentShareHomeWorkspaceMergesOverHTTP(t *testing.T) {
	w := newDocsWorld(t)
	_, doc := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Riêng tư", "kind": "page", "visibility": "restricted"})
	member, _ := docsJoinWorkspace(t, w, "docs-merge-member@example.com")

	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "workspace", "principal_id": w.wsID, "level": "view"})
	if res.StatusCode != 201 {
		t.Fatalf("merge share: %d %v", res.StatusCode, out)
	}
	share, _ := out["share"].(map[string]any)
	if share == nil {
		t.Fatalf("merge share body = %v, want the share envelope", out)
	}
	if share["principal_type"] != "workspace" || share["principal_id"] != w.wsID ||
		share["level"] != "view" || share["active"] != true {
		t.Fatalf("merged share = %v", share)
	}
	// Nothing stands behind the grant: the row itself is the grant.
	if share["id"] != "" || share["created_at"] != "" {
		t.Fatalf("merged share carries a row id/created_at: %v", share)
	}

	// The member reads the document through membership now, and the overview
	// lists no grant row for the workspace.
	res, _ = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc, member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("member read after the merge: %d", res.StatusCode)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("overview: %d %v", res.StatusCode, out)
	}
	if shares, _ := out["shares"].([]any); len(shares) != 0 {
		t.Fatalf("the merge left share rows: %v", shares)
	}

	// Q-S1: the home row takes no manage.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "workspace", "principal_id": w.wsID, "level": "manage"})
	wantErr(t, res, out, 422, "level_not_allowed", "")
}
