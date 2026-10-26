package handler

import "testing"

func trashItems(t *testing.T, body map[string]any) []any {
	t.Helper()
	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("items missing in %v", body)
	}
	return items
}

func TestTaskTrashRoutes(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)
	base := "/api/v1/workspaces/" + wsID

	res, out := doJSON(t, srv, "POST", base+"/tasks", token, map[string]any{"title": "Bin me"})
	if res.StatusCode != 200 {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	taskID := out["task"].(map[string]any)["id"].(string)

	// Delete moves to the trash and names the batch.
	res, out = doJSON(t, srv, "DELETE", "/api/v1/tasks/"+taskID, token, nil)
	if res.StatusCode != 200 || out["trash_batch_id"] == "" || len(out["ids"].([]any)) != 1 {
		t.Fatalf("trash: %d %v", res.StatusCode, out)
	}
	// "trash" must not be read as a {taskID}-style segment.
	res, out = doJSON(t, srv, "GET", base+"/tasks/trash", token, nil)
	items := trashItems(t, out)
	if res.StatusCode != 200 || len(items) != 1 || items[0].(map[string]any)["id"] != taskID ||
		items[0].(map[string]any)["batch_size"].(float64) != 1 || out["next_cursor"] != "" {
		t.Fatalf("list trash: %d %v", res.StatusCode, out)
	}
	if res, _ = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID, token, nil); res.StatusCode != 404 {
		t.Fatalf("get trashed = %d, want 404", res.StatusCode)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/restore", token, nil)
	if res.StatusCode != 200 || len(out["ids"].([]any)) != 1 {
		t.Fatalf("restore: %d %v", res.StatusCode, out)
	}
	if res, _ = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID, token, nil); res.StatusCode != 200 {
		t.Fatalf("get restored = %d", res.StatusCode)
	}
	// A live task cannot be purged.
	if res, _ = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/purge", token, nil); res.StatusCode != 404 {
		t.Fatalf("purge live = %d, want 404", res.StatusCode)
	}

	doJSON(t, srv, "DELETE", "/api/v1/tasks/"+taskID, token, nil)
	if res, out = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/purge", token, nil); res.StatusCode != 200 {
		t.Fatalf("purge: %d %v", res.StatusCode, out)
	}
	if res, _ = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID, token, nil); res.StatusCode != 404 {
		t.Fatalf("get purged = %d, want 404", res.StatusCode)
	}
	_, out = doJSON(t, srv, "GET", base+"/tasks/trash", token, nil)
	if len(trashItems(t, out)) != 0 {
		t.Fatalf("trash after purge = %v", out)
	}

	// Batch delete answers the count and the batch.
	_, out = doJSON(t, srv, "POST", base+"/tasks", token, map[string]any{"title": "Batch A"})
	a := out["task"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", base+"/tasks/batch-delete", token, map[string]any{"task_ids": []string{a}})
	if res.StatusCode != 200 || out["deleted"].(float64) != 1 || out["trash_batch_id"] == "" {
		t.Fatalf("batch-delete: %d %v", res.StatusCode, out)
	}
	if res, _ = doJSON(t, srv, "GET", base+"/tasks/trash?cursor=garbage", token, nil); res.StatusCode != 400 {
		t.Fatalf("bad cursor = %d, want 400", res.StatusCode)
	}
}

func TestProjectTrashRoutes(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)
	base := "/api/v1/workspaces/" + wsID + "/projects"

	res, out := doJSON(t, srv, "POST", base, token, map[string]any{"title": "Trash me"})
	if res.StatusCode != 201 {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	pid := out["project"].(map[string]any)["id"].(string)

	if res, out = doJSON(t, srv, "DELETE", base+"/"+pid, token, nil); res.StatusCode != 200 {
		t.Fatalf("trash: %d %v", res.StatusCode, out)
	}
	// "trash" must not be read as a {projectID}.
	res, out = doJSON(t, srv, "GET", base+"/trash", token, nil)
	items := trashItems(t, out)
	if res.StatusCode != 200 || len(items) != 1 || items[0].(map[string]any)["id"] != pid || out["next_cursor"] != "" {
		t.Fatalf("list trash: %d %v", res.StatusCode, out)
	}
	if res, _ = doJSON(t, srv, "GET", base+"/"+pid, token, nil); res.StatusCode != 404 {
		t.Fatalf("get trashed = %d, want 404", res.StatusCode)
	}

	// Another project took the title meanwhile: restore answers 409.
	if res, out = doJSON(t, srv, "POST", base, token, map[string]any{"title": "Trash me"}); res.StatusCode != 201 {
		t.Fatalf("recreate: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/"+pid+"/restore", token, nil)
	if e, _ := out["error"].(map[string]any); res.StatusCode != 409 || e["code"] != "duplicate_project_title" {
		t.Fatalf("restore dup: %d %v", res.StatusCode, out)
	}

	if res, out = doJSON(t, srv, "POST", base+"/"+pid+"/purge", token, nil); res.StatusCode != 200 {
		t.Fatalf("purge: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, srv, "GET", base+"/trash", token, nil)
	if len(trashItems(t, out)) != 0 {
		t.Fatalf("trash after purge = %v", out)
	}

	_, out = doJSON(t, srv, "POST", base, token, map[string]any{"title": "Back again"})
	p2 := out["project"].(map[string]any)["id"].(string)
	doJSON(t, srv, "DELETE", base+"/"+p2, token, nil)
	if res, out = doJSON(t, srv, "POST", base+"/"+p2+"/restore", token, nil); res.StatusCode != 200 {
		t.Fatalf("restore: %d %v", res.StatusCode, out)
	}
	if res, _ = doJSON(t, srv, "GET", base+"/"+p2, token, nil); res.StatusCode != 200 {
		t.Fatalf("get restored = %d", res.StatusCode)
	}
}
