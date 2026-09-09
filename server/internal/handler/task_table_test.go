package handler

import (
	"testing"
)

func TestTableGroupsRowsFacetsHTTPFixtureCounts(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	create := func(title, status string) {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
			"title": title,
		})
		if res.StatusCode != 200 {
			t.Fatalf("create %s: %d %v", title, res.StatusCode, out)
		}
		if status == "todo" {
			return
		}
		id := out["task"].(map[string]any)["id"].(string)
		rev := out["task"].(map[string]any)["revision"].(float64)
		res, out = doJSON(t, srv, "PUT", "/api/v1/tasks/"+id, token, map[string]any{
			"revision": int64(rev), "status": status,
		})
		if res.StatusCode != 200 {
			t.Fatalf("set status %s: %d %v", title, res.StatusCode, out)
		}
	}
	create("T1", "todo")
	create("T2", "todo")
	create("T3", "todo")
	create("P1", "in_progress")
	create("P2", "in_progress")
	create("D1", "done")

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/table/groups", token, map[string]any{
		"group_by": "status",
		"columns":  []string{"title", "status"},
	})
	if res.StatusCode != 200 {
		t.Fatalf("groups: %d %v", res.StatusCode, body)
	}
	if body["total"].(float64) != 6 {
		t.Fatalf("groups.total = %v, want 6", body["total"])
	}
	if body["query_fingerprint"] == nil || body["query_fingerprint"] == "" {
		t.Fatal("missing query_fingerprint")
	}
	byKey := map[string]float64{}
	for _, raw := range body["groups"].([]any) {
		g := raw.(map[string]any)
		byKey[g["key"].(string)] = g["count"].(float64)
	}
	if byKey["todo"] != 3 || byKey["in_progress"] != 2 || byKey["done"] != 1 {
		t.Fatalf("group counts = %+v", byKey)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/table/rows", token, map[string]any{
		"group_by":  "status",
		"group_key": "todo",
		"columns":   []string{"title", "status"},
	})
	if res.StatusCode != 200 {
		t.Fatalf("rows: %d %v", res.StatusCode, body)
	}
	if body["total"].(float64) != 3 {
		t.Fatalf("rows.total = %v, want 3", body["total"])
	}
	rows := body["rows"].([]any)
	if len(rows) != 3 {
		t.Fatalf("rows len = %d, want 3", len(rows))
	}
	for _, raw := range rows {
		row := raw.(map[string]any)
		task := row["task"].(map[string]any)
		if task["status"] != "todo" {
			t.Fatalf("row status = %v, want todo", task["status"])
		}
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/table/facets", token, map[string]any{
		"facets":  []string{"status", "priority"},
		"columns": []string{"title"},
	})
	if res.StatusCode != 200 {
		t.Fatalf("facets: %d %v", res.StatusCode, body)
	}
	if body["total"].(float64) != 6 {
		t.Fatalf("facets.total = %v, want 6", body["total"])
	}
	var statusCounts map[string]float64
	for _, raw := range body["facets"].([]any) {
		f := raw.(map[string]any)
		if f["kind"] != "status" {
			continue
		}
		statusCounts = map[string]float64{}
		for _, v := range f["values"].([]any) {
			vv := v.(map[string]any)
			statusCounts[vv["key"].(string)] = vv["count"].(float64)
		}
	}
	if statusCounts["todo"] != 3 || statusCounts["in_progress"] != 2 || statusCounts["done"] != 1 {
		t.Fatalf("status facet = %+v", statusCounts)
	}
}
