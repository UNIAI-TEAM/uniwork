package handler

// Handler tests for GET and POST /orgs/{org}/members/{userID}/document-ownership
// (DOC-06b, UNI-2092; addendum §2.2, §4.2). Real router, real DB. The SDOs
// are the ones packages/core/api/endpoints/organization-document-ownership.ts
// parses: counts only on GET, never a title.

import (
	"testing"
)

func TestMemberDocumentOwnershipRoutes(t *testing.T) {
	w := newDocsWorld(t)
	docsCreatePageBody(t, w, w.token, map[string]any{"title": "Bí mật", "kind": "page", "visibility": "restricted"})
	docsCreatePageBody(t, w, w.token, map[string]any{"title": "Chung", "kind": "page"})
	member, memberID := docsJoinWorkspace(t, w, "mdo-member@example.com")
	path := "/api/v1/orgs/docs-org/members/" + w.userID + "/document-ownership"

	res, out := doJSON(t, w.srv, "GET", path, "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("unauthenticated: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", path, w.outsider, nil)
	wantErr(t, res, out, 404, "not_found", "missing")
	res, out = doJSON(t, w.srv, "GET", path, member, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "POST", path, member, map[string]any{"to_user_id": memberID})
	wantErr(t, res, out, 403, "forbidden", "permission")

	// GET: the exact MemberDocumentOwnershipSDO, counts by workspace.
	res, out = doJSON(t, w.srv, "GET", path, w.token, nil)
	if res.StatusCode != 200 || len(out) != 3 || out["user_id"] != w.userID || out["total"] != float64(2) {
		t.Fatalf("ownership: %d %v", res.StatusCode, out)
	}
	wss, _ := out["workspaces"].([]any)
	if len(wss) != 1 {
		t.Fatalf("workspaces = %v", out["workspaces"])
	}
	ws := wss[0].(map[string]any)
	if len(ws) != 3 || ws["workspace_id"] != w.wsID || ws["workspace_name"] != "Docs WS" || ws["count"] != float64(2) {
		t.Fatalf("workspace row = %v", ws)
	}

	// POST refusals: recipient, cursor.
	res, out = doJSON(t, w.srv, "POST", path, w.token, map[string]any{"to_user_id": w.userID})
	wantErr(t, res, out, 422, "owner_target_not_member", "")
	res, out = doJSON(t, w.srv, "POST", path, w.token, map[string]any{"to_user_id": memberID, "cursor": "nope"})
	wantErr(t, res, out, 400, "invalid_request", "")
	res, out = doJSON(t, w.srv, "POST", path, w.token, map[string]any{"to_user_id": memberID, "bulk_id": "nope"})
	wantErr(t, res, out, 400, "invalid_request", "")

	// POST: the exact MemberDocumentsTransferSDO; the restricted document is
	// the caller's own, so it moves too.
	res, out = doJSON(t, w.srv, "POST", path, w.token, map[string]any{"to_user_id": memberID})
	if res.StatusCode != 200 || len(out) != 5 || out["transferred"] != float64(2) || out["has_more"] != false || out["cursor"] != "" {
		t.Fatalf("transfer: %d %v", res.StatusCode, out)
	}
	bulkID, _ := out["bulk_id"].(string)
	if len(bulkID) != 26 {
		t.Fatalf("bulk_id = %v", out["bulk_id"])
	}
	skipped, _ := out["skipped"].(map[string]any)
	if len(skipped) != 2 || skipped["recipient_not_member"] != float64(0) || skipped["self_restricted"] != float64(0) {
		t.Fatalf("skipped = %v", out["skipped"])
	}

	// A later call of the same run echoes the bulk id; nothing is left.
	res, out = doJSON(t, w.srv, "POST", path, w.token, map[string]any{"to_user_id": memberID, "bulk_id": bulkID})
	if res.StatusCode != 200 || out["bulk_id"] != bulkID || out["transferred"] != float64(0) || out["has_more"] != false {
		t.Fatalf("second call: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", path, w.token, nil)
	if res.StatusCode != 200 || out["total"] != float64(0) {
		t.Fatalf("after transfer: %d %v", res.StatusCode, out)
	}
	if wss, ok := out["workspaces"].([]any); !ok || len(wss) != 0 {
		t.Fatalf("workspaces after transfer = %v, want []", out["workspaces"])
	}
}
