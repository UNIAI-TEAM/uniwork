package handler

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestSuiteTasksRoutes404WhenFlagOff(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "suite-flag@example.com", "password": "password123", "display_name": "Suite",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	const fakeWs = "01J8X4WS0N1P2Q3R4S5T6U7V8"
	paths := []struct {
		method, path string
		body         any
	}{
		{http.MethodPost, "/api/v1/workspaces/" + fakeWs + "/tasks/query", map[string]any{"status": "todo", "limit": 10}},
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/tasks/grouped?group_by=status", nil},
	}
	for _, p := range paths {
		res, body := doJSON(t, srv, p.method, p.path, token, p.body)
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("%s %s status = %d, want 404; body=%v", p.method, p.path, res.StatusCode, body)
		}
		errObj, _ := body["error"].(map[string]any)
		if errObj["code"] != "feature_disabled" {
			raw, _ := json.Marshal(body)
			t.Fatalf("%s %s body = %s, want feature_disabled", p.method, p.path, raw)
		}
	}
}

func TestQueryAndGroupedTasksHTTP(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "Query me", "priority": "medium", "status": "todo",
	})
	if res.StatusCode != 200 {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	taskID := out["task"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/query", token, map[string]any{
		"status": "todo", "limit": 10, "offset": 0,
	})
	if res.StatusCode != 200 {
		t.Fatalf("query: %d %v", res.StatusCode, out)
	}
	tasks, _ := out["tasks"].([]any)
	if len(tasks) < 1 {
		t.Fatalf("query tasks empty: %v", out)
	}
	found := false
	for _, raw := range tasks {
		row, _ := raw.(map[string]any)
		if row["id"] == taskID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("created task missing from query: %v", out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/tasks/grouped?status=todo&limit=20", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("grouped: %d %v", res.StatusCode, out)
	}
	groups, _ := out["groups"].([]any)
	if len(groups) < 1 {
		t.Fatalf("grouped empty: %v", out)
	}
}
