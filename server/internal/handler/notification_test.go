package handler

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/notification"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Owner assigns a task to a member; the member's inbox, badge, read/unread
// and archive all work through HTTP; the owner cannot touch the member's
// rows and learns nothing from trying (404, not 403).
func TestNotificationEndpoints(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	q := db.New(pool)
	ctx := context.Background()

	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "owner@example.com", "password": "password123", "display_name": "Owner"})
	if res.StatusCode != 200 {
		t.Fatalf("register owner: %d %v", res.StatusCode, out)
	}
	owner := out["access_token"].(string)
	verifyEmail(t, srv, owner)
	res, out = doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "member@example.com", "password": "password123", "display_name": "Member"})
	if res.StatusCode != 200 {
		t.Fatalf("register member: %d %v", res.StatusCode, out)
	}
	member := out["access_token"].(string)
	memberID := out["user"].(map[string]any)["id"].(string)
	verifyEmail(t, srv, member)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", owner, map[string]string{"name": "Unicom", "slug": "unicom"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", owner, map[string]string{"name": "Đội", "slug": "doi"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	if err := q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: orgID, UserID: memberID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: wsID, UserID: memberID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", owner, map[string]string{"title": "Việc của member"})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, out)
	}
	taskID := out["task"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "PATCH", "/api/v1/tasks/"+taskID, owner, map[string]any{"assignee_id": memberID})
	if res.StatusCode != 200 {
		t.Fatalf("assign: %d %v", res.StatusCode, out)
	}

	// The consumer runs on the outbox, exactly as in production.
	disp := outbox.New(pool, q, outbox.Options{})
	disp.Register(notification.NewConsumer(pool, q, d.Workspaces))
	if err := disp.Process(ctx, 100); err != nil {
		t.Fatal(err)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/me/notifications", member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	list := out["notifications"].([]any)
	if len(list) != 1 {
		t.Fatalf("member notifications = %v", list)
	}
	n := list[0].(map[string]any)
	if n["kind"] != "task_assigned" || n["title_key"] != "notifications.kind.task_assigned" || n["resource_deleted"] != false || n["read_at"] != nil {
		t.Fatalf("row = %v", n)
	}
	if n["params"].(map[string]any)["task"] != "Việc của member" {
		t.Fatalf("params = %v", n["params"])
	}
	nid := n["id"].(string)

	res, out = doJSON(t, srv, "GET", "/api/v1/me/notifications/unread-count", member, nil)
	if res.StatusCode != 200 || out["total"].(float64) != 1 || out["by_workspace"].(map[string]any)[wsID].(float64) != 1 {
		t.Fatalf("unread-count: %d %v", res.StatusCode, out)
	}
	if _, out := doJSON(t, srv, "GET", "/api/v1/me/notifications", owner, nil); len(out["notifications"].([]any)) != 0 {
		t.Fatalf("owner sees notifications: %v", out)
	}

	// Isolation: the owner cannot mark the member's row, and nothing changes.
	res, _ = doJSON(t, srv, "POST", "/api/v1/me/notifications/read", owner, map[string]any{"ids": []string{nid}})
	if res.StatusCode != 404 {
		t.Fatalf("foreign id: %d", res.StatusCode)
	}
	if _, out := doJSON(t, srv, "GET", "/api/v1/me/notifications/unread-count", member, nil); out["total"].(float64) != 1 {
		t.Fatalf("foreign mark changed the member's badge: %v", out)
	}

	res, _ = doJSON(t, srv, "POST", "/api/v1/me/notifications/read", member, map[string]any{"ids": []string{nid}})
	if res.StatusCode != 200 {
		t.Fatalf("read: %d", res.StatusCode)
	}
	if _, out := doJSON(t, srv, "GET", "/api/v1/me/notifications/unread-count", member, nil); out["total"].(float64) != 0 {
		t.Fatalf("after read: %v", out)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/me/notifications/unread", member, map[string]any{"ids": []string{nid}})
	if res.StatusCode != 200 {
		t.Fatalf("unread: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/me/notifications/read", member, map[string]any{"all": true, "workspace_id": wsID})
	if res.StatusCode != 200 {
		t.Fatalf("read all: %d", res.StatusCode)
	}
	if _, out := doJSON(t, srv, "GET", "/api/v1/me/notifications?unread=1", member, nil); len(out["notifications"].([]any)) != 0 {
		t.Fatalf("unread filter after read all: %v", out)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/me/notifications/archive", member, map[string]any{"ids": []string{nid}})
	if res.StatusCode != 200 {
		t.Fatalf("archive: %d", res.StatusCode)
	}
	if _, out := doJSON(t, srv, "GET", "/api/v1/me/notifications", member, nil); len(out["notifications"].([]any)) != 0 {
		t.Fatalf("archived row still listed: %v", out)
	}

	// Preferences: defaults, rejection of an unknown kind, persistence.
	res, out = doJSON(t, srv, "GET", "/api/v1/me/notification-preferences", member, nil)
	prefs := out["preferences"].([]any)
	if res.StatusCode != 200 || len(prefs) != len(notification.Kinds) {
		t.Fatalf("prefs: %d %v", res.StatusCode, out)
	}
	if p := prefs[0].(map[string]any); p["kind"] != "task_assigned" || p["push"] != true || p["email"] != true {
		t.Fatalf("default row = %v", p)
	}
	res, _ = doJSON(t, srv, "PUT", "/api/v1/me/notification-preferences", member, map[string]any{
		"preferences": []map[string]any{{"kind": "bogus", "in_app": true}}})
	if res.StatusCode != 400 {
		t.Fatalf("bogus kind: %d", res.StatusCode)
	}
	res, out = doJSON(t, srv, "PUT", "/api/v1/me/notification-preferences", member, map[string]any{
		"preferences": []map[string]any{{"kind": "task_assigned", "in_app": true, "push": false, "email": false}}})
	if res.StatusCode != 200 || out["preferences"].([]any)[0].(map[string]any)["push"] != false {
		t.Fatalf("put prefs: %d %v", res.StatusCode, out)
	}

	// Push is off on this server: config says so and subscribing is a 404.
	res, out = doJSON(t, srv, "GET", "/api/v1/notifications/push/config", member, nil)
	if res.StatusCode != 200 || out["enabled"] != false {
		t.Fatalf("push config: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/me/push-subscriptions", member, map[string]any{
		"endpoint": "https://push.example/x", "keys": map[string]string{"p256dh": "p", "auth": "a"}})
	if res.StatusCode != 404 {
		t.Fatalf("subscribe with push off: %d", res.StatusCode)
	}

	// Timezone rides on PATCH /me and is validated as an IANA name.
	res, _ = doJSON(t, srv, "PATCH", "/api/v1/me", member, map[string]string{"timezone": "Mars/Olympus"})
	if res.StatusCode != 400 {
		t.Fatalf("bad timezone: %d", res.StatusCode)
	}
	res, out = doJSON(t, srv, "PATCH", "/api/v1/me", member, map[string]string{"timezone": "Asia/Tokyo"})
	if res.StatusCode != 200 || out["user"].(map[string]any)["timezone"] != "Asia/Tokyo" {
		t.Fatalf("set timezone: %d %v", res.StatusCode, out)
	}
}
