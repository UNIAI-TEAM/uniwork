package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/mail"
)

// orgInviteServer is the test server with the organization invitation's mail
// wired, which POST /orgs/{org}/invitations needs.
func orgInviteServer(t *testing.T) *httptest.Server {
	t.Helper()
	d, _ := newTestDeps(t, nil, discardOutbox{})
	d.OrgMembers.SetMail(mail.Renderer{AppURL: "http://localhost:3000"}, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	return srv
}

func workspaceIDs(t *testing.T, raw any) []string {
	t.Helper()
	list, ok := raw.([]any)
	if !ok {
		t.Fatalf("workspaces is not an array: %#v", raw)
	}
	out := make([]string, 0, len(list))
	for _, w := range list {
		out = append(out, w.(map[string]any)["id"].(string))
	}
	return out
}

// TestOrganizationInvitationWorkspacesOverHTTP pins the wire shape of
// UNI-1582: the admin picks workspaces when inviting to the organization,
// every list and the preview name them, and accepting lands the person in the
// first of them. UNI-1472's "invited, accepted, asked to create an
// organization" cannot happen while a workspace was granted.
func TestOrganizationInvitationWorkspacesOverHTTP(t *testing.T) {
	srv := orgInviteServer(t)
	ownerToken, _ := signUp(t, srv, "iw-chu@example.com", "Chủ")
	inviteeToken, _ := signUp(t, srv, "iw-moi@example.com", "Người mới")
	strangerToken, _ := signUp(t, srv, "iw-la@example.com", "Người lạ")

	createOrg := func(token, slug string) string {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": slug, "slug": slug})
		if res.StatusCode != 201 {
			t.Fatalf("create org %s: %d %v", slug, res.StatusCode, out)
		}
		return out["organization"].(map[string]any)["id"].(string)
	}
	createWS := func(token, orgID, slug string) string {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Đội " + slug, "slug": slug})
		if res.StatusCode != 201 {
			t.Fatalf("create ws %s: %d %v", slug, res.StatusCode, out)
		}
		return out["workspace"].(map[string]any)["id"].(string)
	}
	acme := createOrg(ownerToken, "iw-acme")
	sales := createWS(ownerToken, acme, "iw-sales")
	board := createWS(ownerToken, acme, "iw-board")
	theirs := createWS(strangerToken, createOrg(strangerToken, "iw-other"), "iw-theirs")

	// Another organization's workspace is refused, and nothing is sent.
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs/iw-acme/invitations", ownerToken, map[string]any{
		"emails": []string{"iw-moi@example.com"}, "org_role": "member", "workspace_ids": []string{sales, theirs},
	})
	if res.StatusCode != 400 || errorCodeOf(out) != "workspace_not_in_organization" {
		t.Fatalf("foreign workspace: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/me/invitations", inviteeToken, nil)
	if res.StatusCode != 200 || len(out["invitations"].([]any)) != 0 {
		t.Fatalf("a refused invite reached the invitee: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/iw-acme/invitations", ownerToken, map[string]any{
		"emails": []string{"iw-moi@example.com"}, "org_role": "member", "workspace_ids": []string{sales},
	})
	if res.StatusCode != 200 {
		t.Fatalf("invite: %d %v", res.StatusCode, out)
	}
	sent := out["invitations"].([]any)[0].(map[string]any)
	if got := workspaceIDs(t, sent["workspaces"]); len(got) != 1 || got[0] != sales {
		t.Fatalf("invite answer workspaces: %v", got)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/iw-acme/invitations", ownerToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("pending list: %d %v", res.StatusCode, out)
	}
	if got := workspaceIDs(t, out["invitations"].([]any)[0].(map[string]any)["workspaces"]); len(got) != 1 || got[0] != sales {
		t.Fatalf("admin's pending list workspaces: %v", got)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/me/invitations", inviteeToken, nil)
	if res.StatusCode != 200 || len(out["invitations"].([]any)) != 1 {
		t.Fatalf("my invitations: %d %v", res.StatusCode, out)
	}
	mine := out["invitations"].([]any)[0].(map[string]any)
	if _, has := mine["workspace"]; has {
		t.Fatalf("an organization invitation names a single workspace: %v", mine)
	}
	listed := mine["workspaces"].([]any)
	if len(listed) != 1 || listed[0].(map[string]any)["name"] != "Đội iw-sales" {
		t.Fatalf("my invitation workspaces: %v", listed)
	}
	token := mine["token"].(string)

	res, out = doJSON(t, srv, "GET", "/api/v1/invitations/"+token, inviteeToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("preview: %d %v", res.StatusCode, out)
	}
	if got := workspaceIDs(t, out["invitation"].(map[string]any)["workspaces"]); len(got) != 1 || got[0] != sales {
		t.Fatalf("preview workspaces: %v", got)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/invitations/"+token+"/accept", inviteeToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("accept: %d %v", res.StatusCode, out)
	}
	if ws, _ := out["workspace"].(map[string]any); ws == nil || ws["id"] != sales {
		t.Fatalf("accept lands in %v, want the granted workspace", out["workspace"])
	}
	// The organization does not open its other workspaces to a member.
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces", inviteeToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("workspaces: %d %v", res.StatusCode, out)
	}
	if got := workspaceIDs(t, out["workspaces"]); len(got) != 1 || got[0] != sales {
		t.Fatalf("the member sees %v, want only the granted workspace (not %s)", got, board)
	}
}

// An invitation with no workspace leaves a member with nowhere to land, and
// the accept says so by leaving `workspace` out: the client shows "no
// workspace yet" instead of the create flow (UNI-1472).
func TestOrganizationInvitationWithoutWorkspaceOverHTTP(t *testing.T) {
	srv := orgInviteServer(t)
	ownerToken, _ := signUp(t, srv, "iw0-chu@example.com", "Chủ")
	inviteeToken, _ := signUp(t, srv, "iw0-moi@example.com", "Người mới")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", ownerToken, map[string]string{"name": "Không", "slug": "iw0-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	if res, out := doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", ownerToken, map[string]string{"name": "Đội", "slug": "iw0-doi"}); res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/iw0-org/invitations", ownerToken, map[string]any{
		"emails": []string{"iw0-moi@example.com"}, "org_role": "member",
	})
	if res.StatusCode != 200 {
		t.Fatalf("invite: %d %v", res.StatusCode, out)
	}
	if got := workspaceIDs(t, out["invitations"].([]any)[0].(map[string]any)["workspaces"]); len(got) != 0 {
		t.Fatalf("no workspace was chosen, the answer lists %v", got)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/me/invitations", inviteeToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("my invitations: %d %v", res.StatusCode, out)
	}
	token := out["invitations"].([]any)[0].(map[string]any)["token"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/invitations/"+token+"/accept", inviteeToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("accept: %d %v", res.StatusCode, out)
	}
	if _, has := out["workspace"]; has {
		t.Fatalf("a member with no workspace was given one to land in: %v", out)
	}
	if org, _ := out["organization"].(map[string]any); org == nil || org["id"] != orgID {
		t.Fatalf("accept names %v, want the organization", out["organization"])
	}
}
