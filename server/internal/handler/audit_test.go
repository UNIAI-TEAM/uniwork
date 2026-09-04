package handler

import (
	"net/http/httptest"
	"testing"
	"time"
)

// auditWorld is a signed-in organization owner with a workspace and one task
// edit behind them — the smallest world in which the audit endpoints have
// something true to say.
type auditWorld struct {
	srv    *httptest.Server
	token  string
	orgID  string
	wsID   string
	taskID string
}

func newAuditWorld(t *testing.T) auditWorld {
	t.Helper()
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "audit@example.com", "password": "password123", "display_name": "Audit",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Unicom", "slug": "unicom"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token,
		map[string]string{"name": "Đội Alpha", "slug": "doi-alpha"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token,
		map[string]string{"title": "Việc kiểm toán"})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, out)
	}
	taskID := out["task"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "PATCH", "/api/v1/tasks/"+taskID, token, map[string]string{"status": "in_progress"})
	if res.StatusCode != 200 {
		t.Fatalf("update task: %d %v", res.StatusCode, out)
	}
	return auditWorld{srv: srv, token: token, orgID: orgID, wsID: wsID, taskID: taskID}
}

func TestAuditEndpointsExposeWhatHappened(t *testing.T) {
	w := newAuditWorld(t)

	res, out := doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit?action=task.updated", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list audit: %d %v", res.StatusCode, out)
	}
	events := out["events"].([]any)
	if len(events) != 1 {
		t.Fatalf("expected one task.updated row, got %d", len(events))
	}
	event := events[0].(map[string]any)
	if event["actor_kind"] != "human" {
		t.Fatalf("actor_kind = %v, want human", event["actor_kind"])
	}
	changes := event["changes"].(map[string]any)
	if _, ok := changes["status"]; !ok {
		t.Fatalf("changes should name the field that moved: %v", changes)
	}
	if event["correlation_id"] == "" {
		t.Fatal("every row must carry a correlation id")
	}

	// One row by id, through the same organization gate.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/"+event["id"].(string), w.token, nil)
	if res.StatusCode != 200 || out["event"].(map[string]any)["action"] != "task.updated" {
		t.Fatalf("get audit event: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/01J8X4NOTHINGATALL000000", w.token, nil)
	if res.StatusCode != 404 {
		t.Fatalf("unknown event id: %d", res.StatusCode)
	}

	// The task's own history, through the workspace gate rather than the org one.
	res, out = doJSON(t, w.srv, "GET",
		"/api/v1/workspaces/"+w.wsID+"/resources/task/"+w.taskID+"/history", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("resource history: %d %v", res.StatusCode, out)
	}
	if len(out["events"].([]any)) < 2 {
		t.Fatalf("history should hold the create and the update: %v", out["events"])
	}
}

func TestAuditRetentionAndExportEndpoints(t *testing.T) {
	w := newAuditWorld(t)

	res, out := doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/retention", w.token, nil)
	if res.StatusCode != 200 || out["retain_days"].(float64) != 90 {
		t.Fatalf("default retention: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/audit/retention", w.token,
		map[string]any{"retain_days": 180})
	if res.StatusCode != 200 || out["retain_days"].(float64) != 180 {
		t.Fatalf("set retention: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/audit/retention", w.token,
		map[string]any{"retain_days": 5})
	if res.StatusCode != 400 {
		t.Fatalf("a five-day window should be rejected, got %d", res.StatusCode)
	}

	from := time.Now().Add(-24 * time.Hour).UTC().Format(time.RFC3339)
	to := time.Now().UTC().Format(time.RFC3339)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token,
		map[string]string{"format": "csv", "from": from, "to": to})
	if res.StatusCode != 202 {
		t.Fatalf("request export: %d %v", res.StatusCode, out)
	}
	exportID := out["export"].(map[string]any)["id"].(string)
	if out["export"].(map[string]any)["status"] != "pending" {
		t.Fatalf("a queued export should say so: %v", out["export"])
	}

	// A second export is refused while the first is in flight.
	res, _ = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token,
		map[string]string{"format": "csv", "from": from, "to": to})
	if res.StatusCode != 409 {
		t.Fatalf("second export: %d, want 409", res.StatusCode)
	}
	// A range the server cannot parse is a 400, not a 500.
	res, _ = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token,
		map[string]string{"format": "csv", "from": "hôm qua", "to": to})
	if res.StatusCode != 400 {
		t.Fatalf("unparseable range: %d, want 400", res.StatusCode)
	}

	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports/"+exportID, w.token, nil)
	if res.StatusCode != 200 || out["export"].(map[string]any)["id"] != exportID {
		t.Fatalf("get export: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token, nil)
	if res.StatusCode != 200 || len(out["exports"].([]any)) != 1 {
		t.Fatalf("list exports: %d %v", res.StatusCode, out)
	}
}

// Someone outside the organization must not be able to tell an organization
// that exists from one that does not.
func TestAuditEndpointsRefuseAnOutsider(t *testing.T) {
	w := newAuditWorld(t)
	res, out := doJSON(t, w.srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "outsider@example.com", "password": "password123", "display_name": "Outsider",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register outsider: %d %v", res.StatusCode, out)
	}
	outsider := out["access_token"].(string)

	for _, path := range []string{
		"/api/v1/orgs/" + w.orgID + "/audit",
		"/api/v1/orgs/" + w.orgID + "/audit/retention",
		"/api/v1/orgs/" + w.orgID + "/audit/exports",
	} {
		res, _ := doJSON(t, w.srv, "GET", path, outsider, nil)
		if res.StatusCode != 403 {
			t.Fatalf("%s returned %d for an outsider, want 403", path, res.StatusCode)
		}
	}
	res, _ = doJSON(t, w.srv, "GET",
		"/api/v1/workspaces/"+w.wsID+"/resources/task/"+w.taskID+"/history", outsider, nil)
	if res.StatusCode != 403 {
		t.Fatalf("resource history for an outsider: %d, want 403", res.StatusCode)
	}
	// And without a token at all.
	res, _ = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit", "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("anonymous audit read: %d, want 401", res.StatusCode)
	}
}

// The header is echoed so a support conversation can start from the browser.
func TestCorrelationHeaderIsEchoed(t *testing.T) {
	srv := newTestServer(t)
	res, _ := doJSON(t, srv, "GET", "/api/v1/orgs", "", nil)
	if res.Header.Get("X-Correlation-ID") == "" {
		t.Fatal("every response must carry the correlation id back")
	}
}
