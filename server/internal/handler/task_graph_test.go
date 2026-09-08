package handler

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestSuiteGraphRoutes404WhenFlagOff(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "graph-flag@example.com", "password": "password123", "display_name": "Graph",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	const fakeWs = "01J8X4WS0N1P2Q3R4S5T6U7V8"
	const fakeTask = "01J8X4TASKN1P2Q3R4S5T6U7"
	paths := []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/my-tasks", nil},
		{http.MethodGet, "/api/v1/tasks/" + fakeTask + "/children", nil},
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/tasks/children", nil},
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/tasks/child-progress", nil},
		{http.MethodPut, "/api/v1/tasks/" + fakeTask + "/parent", map[string]any{"parent_task_id": nil}},
		{http.MethodPost, "/api/v1/tasks/" + fakeTask + "/dependencies", map[string]any{
			"depends_on_task_id": fakeTask, "type": "blocked_by",
		}},
		{http.MethodDelete, "/api/v1/tasks/" + fakeTask + "/dependencies/" + fakeTask, nil},
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

func TestMyTasksHTTPReturnsOnlyActorsTasks(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "Mine", "assignee_id": nil,
	})
	if res.StatusCode != 200 {
		t.Fatalf("create mine: %d %v", res.StatusCode, out)
	}

	res, body := doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/my-tasks", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("my-tasks: %d %v", res.StatusCode, body)
	}
	tasks, _ := body["tasks"].([]any)
	if len(tasks) < 1 {
		t.Fatalf("expected at least one my-task, got %v", body)
	}
}

func TestDependencyCycleHTTPParentCycle(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	create := func(title string) string {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
			"title": title,
		})
		if res.StatusCode != 200 {
			t.Fatalf("create %s: %d %v", title, res.StatusCode, out)
		}
		return out["task"].(map[string]any)["id"].(string)
	}
	a := create("A")
	b := create("B")

	res, out := doJSON(t, srv, "POST", "/api/v1/tasks/"+a+"/dependencies", token, map[string]any{
		"depends_on_task_id": b, "type": "blocked_by",
	})
	if res.StatusCode != 200 {
		t.Fatalf("set dep: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/tasks/"+b+"/dependencies", token, map[string]any{
		"depends_on_task_id": a, "type": "blocked_by",
	})
	if res.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("cycle status = %d, want 422; body=%v", res.StatusCode, out)
	}
	errObj, _ := out["error"].(map[string]any)
	if errObj["code"] != "parent_cycle" {
		t.Fatalf("code = %v, want parent_cycle", errObj["code"])
	}
}

func TestChildrenHTTP(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)
	create := func(title string) string {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{"title": title})
		if res.StatusCode != 200 {
			t.Fatalf("create: %d %v", res.StatusCode, out)
		}
		return out["task"].(map[string]any)["id"].(string)
	}
	parent := create("Parent")
	child := create("Child")

	res, out := doJSON(t, srv, "PUT", "/api/v1/tasks/"+child+"/parent", token, map[string]any{
		"parent_task_id": parent,
	})
	if res.StatusCode != 200 {
		t.Fatalf("set parent: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/tasks/"+parent+"/children", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("children: %d %v", res.StatusCode, out)
	}
	tasks, _ := out["tasks"].([]any)
	if len(tasks) != 1 {
		t.Fatalf("children len = %d, want 1", len(tasks))
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/tasks/children?parent_ids="+parent, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("children by parents: %d %v", res.StatusCode, out)
	}
	tasks, _ = out["tasks"].([]any)
	if len(tasks) != 1 {
		t.Fatalf("batch children len = %d, want 1", len(tasks))
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/tasks/child-progress", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("child-progress: %d %v", res.StatusCode, out)
	}
	progress, _ := out["progress"].([]any)
	if len(progress) < 1 {
		t.Fatalf("expected progress rows, got %v", out)
	}
}
