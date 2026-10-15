package handler

// Handler tests for the DOC-05 break-glass surface (UNI-1628): the three
// routes, the admin_scope / break_glass_expires_at / break_glass[] mapping and
// the locked list row. Real router, real DB, real DocumentService.

import (
	"strings"
	"testing"
)

func TestDocumentBreakGlassRoutes(t *testing.T) {
	w := newDocsWorld(t)
	_, doc := docsCreatePageBody(t, w, w.token, map[string]any{
		"title": "Hợp đồng", "kind": "page", "visibility": "restricted",
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "nội dung mật"}}}}},
	})
	admin, adminID := docsJoinWorkspaceAs(t, w, "bg-admin@example.com", "admin")
	member, _ := docsJoinWorkspace(t, w, "bg-member@example.com")
	reader, readerID := docsJoinWorkspace(t, w, "bg-reader@example.com")
	bg := "/api/v1/documents/" + doc + "/break-glass"
	const reason = "Kiểm tra hợp đồng theo yêu cầu của kiểm toán"

	// Before any grant the admin administers but cannot read: 403
	// document_restricted carrying can_break_glass; a member is not found.
	res, out := doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc, admin, nil)
	wantErr(t, res, out, 403, "document_restricted", "permission")
	if fields, _ := out["error"].(map[string]any)["fields"].(map[string]any); fields["can_break_glass"] != true {
		t.Fatalf("document_restricted fields = %v, want can_break_glass", out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc, member, nil)
	wantErr(t, res, out, 404, "not_found", "missing")

	// The list shows the locked row to the admin: admin_scope, no level.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", admin, nil)
	if res.StatusCode != 200 {
		t.Fatalf("admin list: %d %v", res.StatusCode, out)
	}
	row := docRow(t, out, doc)
	if row["admin_scope"] != true || row["my_level"] != nil || row["via"] != nil {
		t.Fatalf("locked list row = %v, want admin_scope and no my_level/via", row)
	}

	// Gates and reason bounds.
	res, out = doJSON(t, w.srv, "POST", bg, "", map[string]any{"reason": reason})
	if res.StatusCode != 401 {
		t.Fatalf("unauthenticated grant: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", bg, member, map[string]any{"reason": reason})
	wantErr(t, res, out, 404, "not_found", "missing")
	if res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": readerID, "level": "view"}); res.StatusCode != 201 {
		t.Fatalf("share to reader: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", bg, reader, map[string]any{"reason": reason})
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "POST", bg, w.token, map[string]any{"reason": reason})
	wantErr(t, res, out, 403, "forbidden", "permission")
	for name, body := range map[string]map[string]any{
		"short": {"reason": "  ngắn  "}, "empty": {"reason": ""}, "missing": {}, "long": {"reason": strings.Repeat("a", 501)},
	} {
		res, out = doJSON(t, w.srv, "POST", bg, admin, body)
		if res.StatusCode != 422 {
			t.Fatalf("%s reason: %d %v", name, res.StatusCode, out)
		}
		code, _ := errCodeClass(out)
		fields, _ := out["error"].(map[string]any)["fields"].(map[string]any)
		if code != "break_glass_reason_invalid" || fields["min"] != float64(10) || fields["max"] != float64(500) || fields["length"] == nil {
			t.Fatalf("%s reason error = %v", name, out)
		}
	}

	// 201 for a new grant, 200 with the same body for the live one.
	res, out = doJSON(t, w.srv, "POST", bg, admin, map[string]any{"reason": reason})
	if res.StatusCode != 201 {
		t.Fatalf("grant: %d %v", res.StatusCode, out)
	}
	grant := out["grant"].(map[string]any)
	grantID := grant["id"].(string)
	if grant["document_id"] != doc || grant["actor_id"] != adminID || grant["level"] != "view" || grant["reason"] != reason ||
		grant["actor_name"] == "" || grant["granted_at"] == "" || grant["expires_at"] == "" {
		t.Fatalf("grant = %v", grant)
	}
	res, out = doJSON(t, w.srv, "POST", bg, admin, map[string]any{"reason": "một lý do khác nhưng đủ dài"})
	if res.StatusCode != 200 || out["grant"].(map[string]any)["id"] != grantID {
		t.Fatalf("second grant: %d %v, want 200 and the same grant", res.StatusCode, out)
	}

	// The read runs at view through break_glass and says when it ends.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc, admin, nil)
	if res.StatusCode != 200 {
		t.Fatalf("GET inside the grant: %d %v", res.StatusCode, out)
	}
	d := out["document"].(map[string]any)
	if d["my_level"] != "view" || d["via"] != "break_glass" || d["admin_scope"] != true || d["break_glass_expires_at"] != grant["expires_at"] || d["content"] == nil {
		t.Fatalf("document inside the grant = %v", d)
	}
	// A reader's document carries neither field.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc, reader, nil)
	d = out["document"].(map[string]any)
	if res.StatusCode != 200 || d["admin_scope"] != nil || d["break_glass_expires_at"] != nil {
		t.Fatalf("reader document = %d %v", res.StatusCode, d)
	}
	// The list row reads at view through the grant.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", admin, nil)
	row = docRow(t, out, doc)
	if res.StatusCode != 200 || row["my_level"] != "view" || row["via"] != "break_glass" || row["admin_scope"] != true {
		t.Fatalf("granted list row = %d %v", res.StatusCode, row)
	}

	// The access overview: the ACL owner sees the live grant, the admin sees
	// admin_scope, a reader sees neither.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", w.token, nil)
	list, _ := out["break_glass"].([]any)
	if res.StatusCode != 200 || len(list) != 1 || list[0].(map[string]any)["id"] != grantID || out["admin_scope"] != nil {
		t.Fatalf("owner overview = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", admin, nil)
	if res.StatusCode != 200 || out["admin_scope"] != true || out["my_level"] != "view" || out["via"] != "break_glass" {
		t.Fatalf("admin overview = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", reader, nil)
	if res.StatusCode != 200 || out["break_glass"] != nil || out["admin_scope"] != nil {
		t.Fatalf("reader overview = %d %v", res.StatusCode, out)
	}

	// Admin summary: metadata only, the caller's own grant; a reader is
	// forbidden, a member not found.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/admin-summary", admin, nil)
	if res.StatusCode != 200 {
		t.Fatalf("admin summary: %d %v", res.StatusCode, out)
	}
	sd := out["document"].(map[string]any)
	if sd["id"] != doc || sd["title"] != "Hợp đồng" || sd["visibility"] != "restricted" || sd["content"] != nil || sd["content_text"] != nil ||
		out["admin_scope"] != true || out["my_level"] != "view" || out["via"] != "break_glass" ||
		out["acl_owner"] == nil || out["my_grant"].(map[string]any)["id"] != grantID {
		t.Fatalf("admin summary = %v", out)
	}
	if _, has := out["content"]; has {
		t.Fatalf("admin summary carries content: %v", out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/admin-summary", reader, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/admin-summary", member, nil)
	wantErr(t, res, out, 404, "not_found", "missing")
	// The ACL owner reads it too, with no grant of their own.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/admin-summary", w.token, nil)
	if res.StatusCode != 200 || out["my_grant"] != nil || out["admin_scope"] != false || out["my_level"] != "manage" {
		t.Fatalf("owner admin summary = %d %v", res.StatusCode, out)
	}

	// Revoke: a reader who is not the holder is forbidden, an unknown grant
	// not found; the holder ends it (200), and ending it again is 200 too.
	res, out = doJSON(t, w.srv, "DELETE", bg+"/"+grantID, reader, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "DELETE", bg+"/01J8X4NOSUCHGRANT0N1P2Q3R4", admin, nil)
	wantErr(t, res, out, 404, "not_found", "missing")
	res, out = doJSON(t, w.srv, "DELETE", bg+"/"+grantID, admin, nil)
	if res.StatusCode != 200 || out["status"] != "ok" {
		t.Fatalf("holder revoke: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc, admin, nil)
	wantErr(t, res, out, 403, "document_restricted", "permission")
	res, out = doJSON(t, w.srv, "DELETE", bg+"/"+grantID, admin, nil)
	if res.StatusCode != 200 {
		t.Fatalf("second revoke: %d %v, want 200", res.StatusCode, out)
	}
	// The ACL owner ends a fresh grant of someone else's.
	res, out = doJSON(t, w.srv, "POST", bg, admin, map[string]any{"reason": reason})
	if res.StatusCode != 201 {
		t.Fatalf("regrant: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "DELETE", bg+"/"+out["grant"].(map[string]any)["id"].(string), w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("owner revoke: %d %v", res.StatusCode, out)
	}
}

// docRow finds one document row in a list answer.
func docRow(t *testing.T, out map[string]any, id string) map[string]any {
	t.Helper()
	rows, _ := out["documents"].([]any)
	for _, r := range rows {
		if m, _ := r.(map[string]any); m["id"] == id {
			return m
		}
	}
	t.Fatalf("document %s not in the list: %v", id, out)
	return nil
}
