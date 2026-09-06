package handler

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Every /api/v1/admin route is invisible (404) to a user without a platform
// role, read-only (403 on writes) for support, and demands a reason on writes.
func TestAdminRoutesGuardedByPlatformRole(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	w := buildAuditWorld(t, srv)
	q := db.New(pool)

	res, _ := doJSON(t, srv, "GET", "/api/v1/admin/me", w.token, nil)
	if res.StatusCode != 404 {
		t.Fatalf("no platform role: %d, want 404", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "GET", "/api/v1/admin/organizations", "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("anonymous: %d, want 401", res.StatusCode)
	}

	// support: reads yes, writes no
	grant := func(email, role string) {
		if _, err := d.Admin.SetPlatformRole(context.Background(), service.CLIActor, email, role, "test fixture grant"); err != nil {
			t.Fatal(err)
		}
	}
	grant("audit@example.com", "support")
	res, out := doJSON(t, srv, "GET", "/api/v1/admin/me", w.token, nil)
	if res.StatusCode != 200 || out["platform_role"] != "support" {
		t.Fatalf("support me: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/admin/organizations", w.token, nil)
	if res.StatusCode != 200 || len(out["organizations"].([]any)) != 1 {
		t.Fatalf("support list: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/admin/organizations/"+w.orgID+"/suspend", w.token, map[string]string{"reason": "support cannot do this"})
	if res.StatusCode != 403 || out["error"].(map[string]any)["code"] != "platform_role_insufficient" {
		t.Fatalf("support write: %d %v", res.StatusCode, out)
	}

	// admin: reason too short → 400, then the real thing
	grant("audit@example.com", "admin")
	res, out = doJSON(t, srv, "POST", "/api/v1/admin/organizations/"+w.orgID+"/suspend", w.token, map[string]string{"reason": "short"})
	if res.StatusCode != 400 {
		t.Fatalf("short reason: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/admin/organizations/"+w.orgID+"/suspend", w.token, map[string]string{"reason": "Khách hàng chưa thanh toán"})
	if res.StatusCode != 200 || out["organization"].(map[string]any)["status"] != "suspended" {
		t.Fatalf("suspend: %d %v", res.StatusCode, out)
	}
	// The owner's workspace routes are closed while suspended…
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+w.wsID+"/tasks", w.token, nil)
	if res.StatusCode != 403 || out["error"].(map[string]any)["code"] != "organization_suspended" {
		t.Fatalf("member during suspension: %d %v", res.StatusCode, out)
	}
	// …but the admin console still sees the detail with the reason and the action log.
	res, out = doJSON(t, srv, "GET", "/api/v1/admin/organizations/"+w.orgID, w.token, nil)
	if res.StatusCode != 200 || out["suspended_reason"] != "Khách hàng chưa thanh toán" || len(out["actions"].([]any)) != 1 {
		t.Fatalf("detail: %d %v", res.StatusCode, out)
	}
	action := out["actions"].([]any)[0].(map[string]any)
	if action["action"] != "organization.suspended" || action["trace_id"] == "" {
		t.Fatalf("action row: %v", action)
	}
	// Trace lookup finds the audit row and the admin action under one id.
	res, out = doJSON(t, srv, "GET", "/api/v1/admin/trace/"+action["trace_id"].(string), w.token, nil)
	if res.StatusCode != 200 || len(out["audit"].([]any)) < 1 || len(out["actions"].([]any)) != 1 {
		t.Fatalf("trace: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/admin/organizations/"+w.orgID+"/unsuspend", w.token, map[string]string{"reason": "Đã thanh toán đủ hóa đơn"})
	if res.StatusCode != 200 || out["organization"].(map[string]any)["status"] != "active" {
		t.Fatalf("unsuspend: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "GET", "/api/v1/workspaces/"+w.wsID+"/tasks", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("member after unsuspend: %d", res.StatusCode)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/admin/system", w.token, nil)
	if res.StatusCode != 200 || out["migration_embedded"] == "" || out["readiness"].(map[string]any)["ready"] != true {
		t.Fatalf("system: %d %v", res.StatusCode, out)
	}
	if n, _ := q.ListPlatformRoleUsers(context.Background()); len(n) != 1 || n[0].PlatformRoleGrantedBy.String != service.CLIActor {
		t.Fatalf("platform role rows: %+v", n)
	}
}
