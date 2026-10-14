package handler

import (
	"context"
	"testing"
)

// TestOneOrganizationPerAccountOverHTTP pins the wire shape of ADR 0032: the
// two 409s carry their details in error.fields, and a member of a suspended
// organization can still reach the leave route while an outsider gets 404.
func TestOneOrganizationPerAccountOverHTTP(t *testing.T) {
	srv := newTestServer(t)
	ownerToken, _ := signUp(t, srv, "mot-chu@example.com", "Chủ")
	memberToken, _ := signUp(t, srv, "mot-tv@example.com", "Thành viên")
	otherToken, _ := signUp(t, srv, "mot-khac@example.com", "Khác")

	createOrgWithWorkspace := func(token, slug string) string {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": slug, "slug": slug})
		if res.StatusCode != 201 {
			t.Fatalf("create org %s: %d %v", slug, res.StatusCode, out)
		}
		orgID := out["organization"].(map[string]any)["id"].(string)
		res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Đội", "slug": slug + "-doi"})
		if res.StatusCode != 201 {
			t.Fatalf("create ws: %d %v", res.StatusCode, out)
		}
		return out["workspace"].(map[string]any)["id"].(string)
	}
	invite := func(token, wsID, email string) {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/invitations", token,
			map[string]any{"emails": []string{email}, "role": "member"})
		if res.StatusCode != 200 {
			t.Fatalf("invite: %d %v", res.StatusCode, out)
		}
	}

	acmeWS := createOrgWithWorkspace(ownerToken, "acme-mot")
	invite(ownerToken, acmeWS, "mot-tv@example.com")
	acceptInvitation(t, srv, memberToken)

	// Founding a second organization is refused, naming the current one.
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", memberToken, map[string]string{"name": "Hai", "slug": "hai-mot"})
	if res.StatusCode != 409 || errorCode(out) != "already_in_organization" {
		t.Fatalf("second organization: %d %v", res.StatusCode, out)
	}
	fields, _ := out["error"].(map[string]any)["fields"].(map[string]any)
	if org, _ := fields["organization"].(map[string]any); org["slug"] != "acme-mot" || org["name"] != "acme-mot" || org["id"] == "" {
		t.Fatalf("already_in_organization details: %v", out)
	}

	// Accepting another organization's invitation is refused with conflicts.
	betaWS := createOrgWithWorkspace(otherToken, "beta-mot")
	invite(otherToken, betaWS, "mot-tv@example.com")
	res, out = doJSON(t, srv, "GET", "/api/v1/me/invitations", memberToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("pending invitations: %d %v", res.StatusCode, out)
	}
	inviteToken := out["invitations"].([]any)[0].(map[string]any)["token"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/invitations/"+inviteToken+"/accept", memberToken, nil)
	if res.StatusCode != 409 || errorCode(out) != "organization_switch_required" {
		t.Fatalf("accept while in another organization: %d %v", res.StatusCode, out)
	}
	fields, _ = out["error"].(map[string]any)["fields"].(map[string]any)
	conflicts, _ := fields["conflicts"].([]any)
	if len(conflicts) != 1 {
		t.Fatalf("conflicts: %v", out)
	}
	c := conflicts[0].(map[string]any)
	if c["required_action"] != "leave" || c["role"] != "member" ||
		c["organization"].(map[string]any)["slug"] != "acme-mot" || c["transfer_candidates_count"] != float64(1) {
		t.Fatalf("conflict: %v", c)
	}

	// A suspended organization still lets its member leave (ADR 0032 D9); an
	// outsider still learns nothing about the slug.
	if _, err := testPool.Exec(context.Background(), `UPDATE organizations SET status = 'suspended' WHERE slug = 'acme-mot'`); err != nil {
		t.Fatal(err)
	}
	if res, out := doJSON(t, srv, "POST", "/api/v1/orgs/acme-mot/leave", otherToken, nil); res.StatusCode != 404 {
		t.Fatalf("outsider leaving: %d %v", res.StatusCode, out)
	}
	if res, out := doJSON(t, srv, "POST", "/api/v1/orgs/acme-mot/leave", ownerToken, nil); res.StatusCode != 409 || errorCode(out) != "last_owner" {
		t.Fatalf("owner leaving a suspended organization: %d %v", res.StatusCode, out)
	}
	if res, out := doJSON(t, srv, "POST", "/api/v1/orgs/acme-mot/leave", memberToken, nil); res.StatusCode != 200 {
		t.Fatalf("member leaving a suspended organization: %d %v", res.StatusCode, out)
	}
	if res, out := doJSON(t, srv, "POST", "/api/v1/invitations/"+inviteToken+"/accept", memberToken, nil); res.StatusCode != 200 {
		t.Fatalf("accept after leaving: %d %v", res.StatusCode, out)
	}
}
