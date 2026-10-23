package handler

import (
	"bytes"
	"context"
	"net/http"
	"testing"
)

// TestInvitationSwitchOverHTTP pins the wire shape of spec §4.3 and §4.4: the
// preview, the accept that carries resolve, the idempotent retry and the 410s.
func TestInvitationSwitchOverHTTP(t *testing.T) {
	srv := newTestServer(t)
	ownerToken, _ := signUp(t, srv, "sw-chu@example.com", "Chủ")
	memberToken, _ := signUp(t, srv, "sw-tv@example.com", "Thành viên")
	otherToken, _ := signUp(t, srv, "sw-khac@example.com", "Người mời")

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
	invite := func(token, wsID, email string) string {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/invitations", token,
			map[string]any{"emails": []string{email}, "role": "member"})
		if res.StatusCode != 200 {
			t.Fatalf("invite: %d %v", res.StatusCode, out)
		}
		res, out = doJSON(t, srv, "GET", "/api/v1/me/invitations", memberToken, nil)
		if res.StatusCode != 200 {
			t.Fatalf("pending invitations: %d %v", res.StatusCode, out)
		}
		for _, raw := range out["invitations"].([]any) {
			inv := raw.(map[string]any)
			if ws, _ := inv["workspace"].(map[string]any); ws["id"] == wsID {
				return inv["token"].(string)
			}
		}
		t.Fatalf("no invitation into %s: %v", wsID, out)
		return ""
	}

	acmeWS := createOrgWithWorkspace(ownerToken, "acme-sw")
	invite(ownerToken, acmeWS, "sw-tv@example.com")
	acceptInvitation(t, srv, memberToken)
	betaWS := createOrgWithWorkspace(otherToken, "beta-sw")
	token := invite(otherToken, betaWS, "sw-tv@example.com")

	// The preview names the invitation and what the current organization needs.
	res, out := doJSON(t, srv, "GET", "/api/v1/invitations/"+token, memberToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("preview: %d %v", res.StatusCode, out)
	}
	inv := out["invitation"].(map[string]any)
	if inv["status"] != "pending" || inv["org_role"] != "member" || inv["inviter_name"] != "Người mời" || inv["id"] == "" || inv["expires_at"] == "" ||
		inv["organization"].(map[string]any)["slug"] != "beta-sw" || inv["workspace"].(map[string]any)["slug"] != "beta-sw-doi" {
		t.Fatalf("invitation: %v", inv)
	}
	conflicts := out["conflicts"].([]any)
	if len(conflicts) != 1 {
		t.Fatalf("conflicts: %v", out)
	}
	c := conflicts[0].(map[string]any)
	acme := c["organization"].(map[string]any)
	if c["required_action"] != "leave" || c["role"] != "member" || acme["slug"] != "acme-sw" || c["transfer_candidates_count"] != float64(1) {
		t.Fatalf("conflict: %v", c)
	}
	if res, out := doJSON(t, srv, "GET", "/api/v1/invitations/khong-co", memberToken, nil); res.StatusCode != 404 {
		t.Fatalf("unknown token: %d %v", res.StatusCode, out)
	}
	if res, out := doJSON(t, srv, "GET", "/api/v1/invitations/"+token, ownerToken, nil); res.StatusCode != 403 || errorCode(out) != "invitation_email_mismatch" {
		t.Fatalf("another account: %d %v", res.StatusCode, out)
	}

	// A body that is not JSON is refused before anything is read.
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/invitations/"+token+"/accept", bytes.NewBufferString("{"))
	req.Header.Set("Authorization", "Bearer "+memberToken)
	if raw, err := http.DefaultClient.Do(req); err != nil || raw.StatusCode != 400 {
		t.Fatalf("malformed body: %v %v", err, raw)
	}

	// The switch: leave acme, join beta, in one request.
	body := map[string]any{"resolve": []map[string]any{{"organization_id": acme["id"], "action": "leave"}}}
	res, out = doJSON(t, srv, "POST", "/api/v1/invitations/"+token+"/accept", memberToken, body)
	if res.StatusCode != 200 || out["organization"].(map[string]any)["slug"] != "beta-sw" || out["workspace"].(map[string]any)["id"] != betaWS {
		t.Fatalf("switch: %d %v", res.StatusCode, out)
	}
	// A retry answers the same.
	res, again := doJSON(t, srv, "POST", "/api/v1/invitations/"+token+"/accept", memberToken, body)
	if res.StatusCode != 200 || again["workspace"].(map[string]any)["id"] != betaWS {
		t.Fatalf("retry: %d %v", res.StatusCode, again)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/invitations/"+token, memberToken, nil)
	if res.StatusCode != 200 || out["invitation"].(map[string]any)["status"] != "accepted" || len(out["conflicts"].([]any)) != 0 {
		t.Fatalf("preview after accept: %d %v", res.StatusCode, out)
	}

	// An invitation revoked while the person decided answers 410 with why.
	revoked := invite(ownerToken, acmeWS, "sw-tv@example.com")
	if _, err := testPool.Exec(context.Background(), `UPDATE invitations SET revoked_at = now() WHERE token = $1`, revoked); err != nil {
		t.Fatal(err)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/invitations/"+revoked+"/accept", memberToken, nil)
	if res.StatusCode != 410 || errorCode(out) != "invitation_revoked" {
		t.Fatalf("revoked: %d %v", res.StatusCode, out)
	}
}
