package handler

import (
	"testing"
)

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
