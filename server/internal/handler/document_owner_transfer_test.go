package handler

// Handler tests for PUT /documents/{documentID}/owner (DOC-06, UNI-2084;
// addendum §4.2) and the two admin-summary fields S-DOC06 adds (§2.5). Real
// router, real DB, real DocumentService. The SDO is the one
// packages/core/api/endpoints/documents-owner.ts parses: four string keys and
// nothing else - in particular never the document's content.

import (
	"strconv"
	"testing"
)

func TestDocumentOwnerTransferRoute(t *testing.T) {
	w := newDocsWorld(t)
	_, doc := docsCreatePageBody(t, w, w.token, map[string]any{
		"title": "Hợp đồng", "kind": "page", "visibility": "restricted",
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "nội dung mật"}}}}},
	})
	admin, adminID := docsJoinWorkspaceAs(t, w, "ot-admin@example.com", "admin")
	member, memberID := docsJoinWorkspace(t, w, "ot-member@example.com")
	path := "/api/v1/documents/" + doc + "/owner"

	// Gates: no session, a member who cannot see the document, an unknown
	// recipient, a bad level, an admin taking the document for themselves.
	res, out := doJSON(t, w.srv, "PUT", path, "", map[string]any{"user_id": memberID})
	if res.StatusCode != 401 {
		t.Fatalf("unauthenticated: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "PUT", path, member, map[string]any{"user_id": memberID})
	wantErr(t, res, out, 404, "not_found", "missing")
	res, out = doJSON(t, w.srv, "PUT", path, w.token, map[string]any{"user_id": "01J8X4NOSUCHUSER0N1P2Q3R4S5"})
	wantErr(t, res, out, 422, "owner_target_not_member", "")
	res, out = doJSON(t, w.srv, "PUT", path, w.token, map[string]any{"user_id": memberID, "previous_owner_level": "manage"})
	wantErr(t, res, out, 400, "invalid_request", "")
	res, out = doJSON(t, w.srv, "PUT", path, admin, map[string]any{"user_id": adminID})
	wantErr(t, res, out, 403, "break_glass_required", "permission")

	// Same owner: 200, the owner named, the previous-owner fields empty.
	res, out = doJSON(t, w.srv, "PUT", path, w.token, map[string]any{"user_id": w.userID})
	if res.StatusCode != 200 || out["acl_owner_id"] != w.userID || out["previous_owner_id"] != "" || out["previous_owner_share_id"] != "" {
		t.Fatalf("same owner: %d %v", res.StatusCode, out)
	}

	// The admin (AdminScope only) hands it to the member: the exact SDO.
	res, out = doJSON(t, w.srv, "PUT", path, admin, map[string]any{"user_id": memberID, "previous_owner_level": "view"})
	if res.StatusCode != 200 {
		t.Fatalf("transfer: %d %v", res.StatusCode, out)
	}
	if len(out) != 4 || out["document_id"] != doc || out["acl_owner_id"] != memberID || out["previous_owner_id"] != w.userID {
		t.Fatalf("transfer answer = %v, want exactly the four DocumentOwnerSDO keys", out)
	}
	if id, _ := out["previous_owner_share_id"].(string); id == "" {
		t.Fatalf("previous_owner_share_id empty: %v", out)
	}

	// The new owner manages; the previous one reads at view through the share.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc, member, nil)
	if res.StatusCode != 200 || out["document"].(map[string]any)["my_level"] != "manage" {
		t.Fatalf("new owner GET: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc, w.token, nil)
	// The previous owner is the organization owner, an implicit workspace
	// admin: AdminScope plus the view share.
	if res.StatusCode != 200 || out["document"].(map[string]any)["my_level"] != "view" {
		t.Fatalf("previous owner GET: %d %v", res.StatusCode, out)
	}

	// The new owner manages, so they can hand it on again with none.
	res, out = doJSON(t, w.srv, "PUT", path, member, map[string]any{"user_id": w.userID, "previous_owner_level": "none"})
	if res.StatusCode != 200 || out["acl_owner_id"] != w.userID || out["previous_owner_id"] != memberID || out["previous_owner_share_id"] != "" {
		t.Fatalf("transfer back: %d %v", res.StatusCode, out)
	}
}

// TestDocumentAdminSummaryOwnerKindAndRevision is §2.5: the admin summary
// carries the document's revision (a decimal string, the base the share
// dialog saves visibility against) and owner_kind when a Work Product owns
// it - absent otherwise.
func TestDocumentAdminSummaryOwnerKindAndRevision(t *testing.T) {
	w := newDocsWorld(t)
	_, doc := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Kế hoạch", "kind": "page", "visibility": "restricted"})
	var revision int64
	if err := w.pool.QueryRow(t.Context(), `SELECT revision FROM documents WHERE id = $1`, doc).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	res, out := doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/admin-summary", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("admin summary: %d %v", res.StatusCode, out)
	}
	d := out["document"].(map[string]any)
	if d["revision"] != strconv.FormatInt(revision, 10) {
		t.Fatalf("revision = %v, want %q", d["revision"], strconv.FormatInt(revision, 10))
	}
	if _, has := d["owner_kind"]; has {
		t.Fatalf("owner_kind on an unowned document: %v", d)
	}
}
