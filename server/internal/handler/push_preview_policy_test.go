package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func pushPreviewWorld(t *testing.T) (srv *httptest.Server, owner, member string) {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	srv = httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	owner, _ = registerOrgWorkspace(t, srv, "previews-owner@example.com", "Owner", "previews")
	var memberID string
	member, memberID = signUp(t, srv, "previews-member@example.com", "Member")
	if _, err := pool.Exec(context.Background(), `INSERT INTO organization_members (organization_id, user_id, role) SELECT id, $1, 'member' FROM organizations WHERE slug = 'previews'`, memberID); err != nil {
		t.Fatal(err)
	}
	return srv, owner, member
}

// Audit "Security & privacy", push-preview-plaintext: every member reads the
// organization's choice, only an owner or admin changes it, and the body must
// say which.
func TestOrgPushPreviewPolicyRoute(t *testing.T) {
	srv, owner, member := pushPreviewWorld(t)
	path := "/api/v1/orgs/previews/push-preview-policy"

	res, out := doJSON(t, srv, "GET", path, member, nil)
	if res.StatusCode != http.StatusOK || out["hidden"] != false || out["can_manage"] != false || out["hidden_at"] != nil {
		t.Fatalf("member reads the default: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", path, member, map[string]any{"hidden": true})
	wantError(t, "member put", res, out, http.StatusForbidden, "forbidden")
	res, out = doJSON(t, srv, "PUT", path, owner, map[string]any{})
	wantError(t, "missing hidden", res, out, http.StatusBadRequest, "invalid_request")

	res, out = doJSON(t, srv, "PUT", path, owner, map[string]any{"hidden": true})
	if res.StatusCode != http.StatusOK || out["hidden"] != true || out["can_manage"] != true || out["hidden_at"] == nil {
		t.Fatalf("owner hides: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", path, member, nil)
	if res.StatusCode != http.StatusOK || out["hidden"] != true {
		t.Fatalf("member reads hidden: %d %v", res.StatusCode, out)
	}
}

// The person's own choice rides on /me, so the phone's Settings reads it with
// the profile it already loads.
func TestMePushPreviewsRoute(t *testing.T) {
	srv, _, member := pushPreviewWorld(t)
	user := func(out map[string]any) map[string]any {
		u, _ := out["user"].(map[string]any)
		return u
	}

	res, out := doJSON(t, srv, "GET", "/api/v1/me", member, nil)
	if res.StatusCode != http.StatusOK || user(out)["push_previews"] != true {
		t.Fatalf("shown by default: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", "/api/v1/me/push-previews", member, map[string]any{})
	wantError(t, "missing show", res, out, http.StatusBadRequest, "invalid_request")
	res, out = doJSON(t, srv, "PUT", "/api/v1/me/push-previews", member, map[string]any{"show": false})
	if res.StatusCode != http.StatusOK || user(out)["push_previews"] != false {
		t.Fatalf("hide: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/me", member, nil)
	if res.StatusCode != http.StatusOK || user(out)["push_previews"] != false {
		t.Fatalf("hidden on /me: %d %v", res.StatusCode, out)
	}
}
