package handler

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/notification"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The owner gives the member a task due today; the member's home shows it with
// its identifier, the assignment notification in the inbox and the unread
// count. Someone outside the workspace gets nothing, and the layout endpoint
// only takes an object.
func TestHomeEndpoints(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	q := db.New(pool)
	ctx := context.Background()

	register := func(email, name string) (string, string) {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
			"email": email, "password": "password123", "display_name": name})
		if res.StatusCode != 200 {
			t.Fatalf("register %s: %d %v", email, res.StatusCode, out)
		}
		token := out["access_token"].(string)
		verifyEmail(t, srv, token)
		return token, out["user"].(map[string]any)["id"].(string)
	}
	owner, _ := register("home-owner@example.com", "Owner")
	member, memberID := register("home-member@example.com", "Member")
	outsider, _ := register("home-outsider@example.com", "Outsider")

	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", owner, map[string]string{"name": "Unicom", "slug": "unicom"})
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

	// users.timezone defaults to Ho Chi Minh City, so that is the member's today.
	loc, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		t.Fatal(err)
	}
	today := time.Now().In(loc).Format("2006-01-02")
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", owner, map[string]string{"title": "Việc hôm nay"})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, out)
	}
	taskID := out["task"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "PATCH", "/api/v1/tasks/"+taskID, owner, map[string]any{"assignee_id": memberID, "due_date": today})
	if res.StatusCode != 200 {
		t.Fatalf("assign: %d %v", res.StatusCode, out)
	}
	disp := outbox.New(pool, q, outbox.Options{})
	disp.Register(notification.NewConsumer(pool, q, d.Workspaces))
	if err := disp.Process(ctx, 100); err != nil {
		t.Fatal(err)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/home", member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("home: %d %v", res.StatusCode, out)
	}
	if out["today"] != today || out["timezone"] != "Asia/Ho_Chi_Minh" {
		t.Fatalf("today = %v %v, want %s", out["today"], out["timezone"], today)
	}
	counts := out["counts"].(map[string]any)
	if counts["open"].(float64) != 1 || counts["due_today"].(float64) != 1 || counts["overdue"].(float64) != 0 || counts["unread"].(float64) != 1 {
		t.Fatalf("counts = %v", counts)
	}
	work := out["my_work"].([]any)
	if len(work) != 1 || work[0].(map[string]any)["id"] != taskID || work[0].(map[string]any)["identifier"] == "" {
		t.Fatalf("my_work = %v", work)
	}
	inbox := out["inbox"].([]any)
	if len(inbox) != 1 || inbox[0].(map[string]any)["kind"] != "task_assigned" {
		t.Fatalf("inbox = %v", inbox)
	}
	if meetings := out["upcoming_meetings"].([]any); len(meetings) != 0 {
		t.Fatalf("upcoming_meetings = %v", meetings)
	}
	if partial := out["partial"].([]any); len(partial) != 0 {
		t.Fatalf("partial = %v", partial)
	}

	// The owner's home does not show the member's task.
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/home", owner, nil)
	if res.StatusCode != 200 || len(out["my_work"].([]any)) != 0 {
		t.Fatalf("owner home: %d %v", res.StatusCode, out)
	}

	for _, path := range []string{"/home", "/home/preferences"} {
		res, _ = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+path, outsider, nil)
		if res.StatusCode != 403 && res.StatusCode != 404 {
			t.Fatalf("outsider %s: %d", path, res.StatusCode)
		}
	}

	res, out = doJSON(t, srv, "PUT", "/api/v1/workspaces/"+wsID+"/home/preferences", member, map[string]any{"prefs": []string{"x"}})
	if res.StatusCode != 400 {
		t.Fatalf("array prefs: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", "/api/v1/workspaces/"+wsID+"/home/preferences", member, map[string]any{"prefs": map[string]string{"layout": "compact"}})
	if res.StatusCode != 200 || out["updated_at"] == "" {
		t.Fatalf("put prefs: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/home/preferences", member, nil)
	if res.StatusCode != 200 || out["prefs"].(map[string]any)["layout"] != "compact" {
		t.Fatalf("get prefs: %d %v", res.StatusCode, out)
	}
}
