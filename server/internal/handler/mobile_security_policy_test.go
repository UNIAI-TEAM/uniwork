package handler

import (
	"net/http"
	"testing"
)

// Audit "Security & privacy", privacy-defaults-off: every member's phone reads
// the organization's requirements; only an owner or admin changes them, one
// field at a time, and the body must name at least one.
func TestOrgMobileSecurityPolicyRoute(t *testing.T) {
	srv, owner, member := pushPreviewWorld(t)
	path := "/api/v1/orgs/previews/mobile-security-policy"

	res, out := doJSON(t, srv, "GET", path, member, nil)
	if res.StatusCode != http.StatusOK || out["require_app_lock"] != false || out["block_screen_capture"] != false || out["can_manage"] != false {
		t.Fatalf("member reads the default: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", path, member, map[string]any{"require_app_lock": true})
	wantError(t, "member put", res, out, http.StatusForbidden, "forbidden")
	res, out = doJSON(t, srv, "PUT", path, owner, map[string]any{})
	wantError(t, "no field", res, out, http.StatusBadRequest, "invalid_request")

	res, out = doJSON(t, srv, "PUT", path, owner, map[string]any{"require_app_lock": true})
	if res.StatusCode != http.StatusOK || out["require_app_lock"] != true || out["block_screen_capture"] != false || out["can_manage"] != true {
		t.Fatalf("owner requires the lock: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", path, owner, map[string]any{"block_screen_capture": true})
	if res.StatusCode != http.StatusOK || out["require_app_lock"] != true || out["block_screen_capture"] != true {
		t.Fatalf("owner blocks capture, the lock stays: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", path, member, nil)
	if res.StatusCode != http.StatusOK || out["require_app_lock"] != true || out["block_screen_capture"] != true {
		t.Fatalf("member reads both: %d %v", res.StatusCode, out)
	}
}
