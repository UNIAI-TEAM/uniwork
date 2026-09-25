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
		"query":    map[string]any{},
		"group_by": "status",
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
	if body["next_cursor"] != nil {
		t.Fatalf("groups.next_cursor = %v, want null", body["next_cursor"])
	}
	byKey := map[string]float64{}
	for _, raw := range body["groups"].([]any) {
		g := raw.(map[string]any)
		byKey[g["key"].(string)] = g["count"].(float64)
	}
	if byKey["status:todo"] != 3 || byKey["status:in_progress"] != 2 || byKey["status:done"] != 1 {
		t.Fatalf("group counts = %+v", byKey)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/table/rows", token, map[string]any{
		"query":     map[string]any{},
		"group_by":  "status",
		"group_key": "status:todo",
	})
	if res.StatusCode != 200 {
		t.Fatalf("rows: %d %v", res.StatusCode, body)
	}
	if body["total"].(float64) != 3 {
		t.Fatalf("rows.total = %v, want 3", body["total"])
	}
	if _, has := body["branch_total"]; has {
		t.Fatalf("rows body still carries branch_total: %v", body)
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
		if _, ok := row["labels"].([]any); !ok {
			t.Fatalf("row missing labels array: %+v", row)
		}
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/table/facets", token, map[string]any{
		"query":  map[string]any{},
		"facets": []string{"status", "priority"},
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

func TestTableRowsInvalidCursorHTTP(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/table/rows", token, map[string]any{
		"cursor": "%%",
	})
	if res.StatusCode != 400 {
		t.Fatalf("status = %d, want 400: %v", res.StatusCode, body)
	}
	if code := body["error"].(map[string]any)["code"]; code != "invalid_cursor" {
		t.Fatalf("code = %v, want invalid_cursor", code)
	}
}

func TestTableRowsCursorQueryMismatchHTTP(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)
	for _, title := range []string{"a", "b", "c"} {
		res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{"title": title})
		if res.StatusCode != 200 {
			t.Fatalf("create %s: %d %v", title, res.StatusCode, out)
		}
	}

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/table/rows", token, map[string]any{
		"query": map[string]any{"sort": map[string]any{"field": "title"}},
		"limit": 2,
	})
	if res.StatusCode != 200 {
		t.Fatalf("first page: %d %v", res.StatusCode, body)
	}
	cursor, _ := body["next_cursor"].(string)
	if cursor == "" {
		t.Fatalf("expected next_cursor, got %v", body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/table/rows", token, map[string]any{
		"query":  map[string]any{"sort": map[string]any{"field": "created_at"}},
		"cursor": cursor,
		"limit":  2,
	})
	if res.StatusCode != 409 {
		t.Fatalf("status = %d, want 409: %v", res.StatusCode, body)
	}
	if code := body["error"].(map[string]any)["code"]; code != "cursor_query_mismatch" {
		t.Fatalf("code = %v, want cursor_query_mismatch", code)
	}
}

func TestTableGroupsUnsupportedTextPropertyHTTP(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/task-properties", token, map[string]any{
		"name": "Note", "type": "text",
	})
	if res.StatusCode != 201 {
		t.Fatalf("create property: %d %v", res.StatusCode, out)
	}
	propID := out["property"].(map[string]any)["id"].(string)

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/table/groups", token, map[string]any{
		"query":    map[string]any{},
		"group_by": "property:" + propID,
	})
	if res.StatusCode != 422 {
		t.Fatalf("status = %d, want 422: %v", res.StatusCode, body)
	}
	if code := body["error"].(map[string]any)["code"]; code != "unsupported_group" {
		t.Fatalf("code = %v, want unsupported_group", code)
	}
}

func TestTableRowsLabelFilterHTTP(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	createTask := func(title string) string {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
			"title": title,
		})
		if res.StatusCode != 200 {
			t.Fatalf("create %s: %d %v", title, res.StatusCode, out)
		}
		return out["task"].(map[string]any)["id"].(string)
	}
	taggedID := createTask("tagged")
	createTask("plain")

	res, labelOut := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/task-labels", token, map[string]any{
		"name": "L", "color": "#112233",
	})
	if res.StatusCode != 201 {
		t.Fatalf("create label: %d %v", res.StatusCode, labelOut)
	}
	labelID := labelOut["label"].(map[string]any)["id"].(string)
	res, body := doJSON(t, srv, "POST", "/api/v1/tasks/"+taggedID+"/labels", token, map[string]any{
		"label_id": labelID,
	})
	if res.StatusCode != 200 {
		t.Fatalf("attach label: %d %v", res.StatusCode, body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/table/rows", token, map[string]any{
		"query": map[string]any{
			"filter": map[string]any{"label_ids": []string{labelID}},
		},
		"limit": 50,
	})
	if res.StatusCode != 200 {
		t.Fatalf("rows: %d %v", res.StatusCode, body)
	}
	if body["total"].(float64) != 1 {
		t.Fatalf("total = %v, want 1", body["total"])
	}
	rows := body["rows"].([]any)
	if len(rows) != 1 {
		t.Fatalf("rows len = %d, want 1", len(rows))
	}
	gotID := rows[0].(map[string]any)["task"].(map[string]any)["id"].(string)
	if gotID != taggedID {
		t.Fatalf("row id = %s, want %s", gotID, taggedID)
	}
}
