package handler

import "testing"

// TestCloseOrganizationOverHTTP pins POST /orgs/{org}/close (spec §4.5): an
// outsider learns nothing about the slug, the refusals carry their codes, and
// a closed organization frees its owner to found another.
func TestCloseOrganizationOverHTTP(t *testing.T) {
	srv := newTestServer(t)
	ownerToken, _ := signUp(t, srv, "dong-chu@example.com", "Chủ")
	memberToken, _ := signUp(t, srv, "dong-tv@example.com", "Thành viên")
	otherToken, _ := signUp(t, srv, "dong-khac@example.com", "Khác")

	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", ownerToken, map[string]string{"name": "Đóng cửa", "slug": "dong-cua"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", ownerToken, map[string]string{"name": "Đội", "slug": "dong-cua-doi"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/invitations", ownerToken,
		map[string]any{"emails": []string{"dong-tv@example.com"}, "role": "member"})
	if res.StatusCode != 200 {
		t.Fatalf("invite: %d %v", res.StatusCode, out)
	}
	acceptInvitation(t, srv, memberToken)

	closeAs := func(token, typed string) (int, map[string]any) {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/orgs/dong-cua/close", token, map[string]string{"confirm_slug": typed})
		return res.StatusCode, out
	}
	if status, out := closeAs(otherToken, "dong-cua"); status != 404 {
		t.Fatalf("outsider closing: %d %v", status, out)
	}
	if status, out := closeAs(memberToken, "dong-cua"); status != 403 {
		t.Fatalf("member closing: %d %v", status, out)
	}
	if status, out := closeAs(ownerToken, "dong"); status != 400 || errorCode(out) != "close_confirm_mismatch" {
		t.Fatalf("mistyped slug: %d %v", status, out)
	}
	if status, out := closeAs(ownerToken, "dong-cua"); status != 409 || errorCode(out) != "organization_has_members" {
		t.Fatalf("closing with a member left: %d %v", status, out)
	}

	if res, out := doJSON(t, srv, "POST", "/api/v1/orgs/dong-cua/leave", memberToken, nil); res.StatusCode != 200 {
		t.Fatalf("member leaving: %d %v", res.StatusCode, out)
	}
	if status, out := closeAs(ownerToken, "dong-cua"); status != 200 || out["status"] != "ok" {
		t.Fatalf("close: %d %v", status, out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/orgs", ownerToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list orgs: %d %v", res.StatusCode, out)
	}
	if orgs, _ := out["organizations"].([]any); len(orgs) != 0 {
		t.Fatalf("closed organization still listed: %v", out)
	}
	if status, out := closeAs(ownerToken, "dong-cua"); status != 403 || errorCode(out) != "member_deactivated" {
		t.Fatalf("closing twice: %d %v", status, out)
	}
	if res, out := doJSON(t, srv, "POST", "/api/v1/orgs", ownerToken, map[string]string{"name": "Mới", "slug": "dong-moi"}); res.StatusCode != 201 {
		t.Fatalf("founding a new organization after close: %d %v", res.StatusCode, out)
	}
}
