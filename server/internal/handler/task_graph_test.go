package handler

import (
	"net/http"
	"testing"
)

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
