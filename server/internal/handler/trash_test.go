package handler

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

// TestTrashRouteUnwiredAnswers501: without the task service there is no trash
// service, and the route fails closed instead of panicking.
func TestTrashRouteUnwiredAnswers501(t *testing.T) {
	w := httptest.NewRecorder()
	(&handlers{}).listTrash(w, httptest.NewRequest("GET", "/api/v1/workspaces/w/trash", nil))
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("unwired trash = %d, want 501", w.Code)
	}
}

func TestTrashRouteAnswersTheSharedPage(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)
	base := "/api/v1/workspaces/" + wsID

	_, out := doJSON(t, srv, "POST", base+"/tasks", token, map[string]any{"title": "Bin me"})
	taskID := out["task"].(map[string]any)["id"].(string)
	if res, out := doJSON(t, srv, "DELETE", "/api/v1/tasks/"+taskID, token, nil); res.StatusCode != 200 {
		t.Fatalf("trash task: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, srv, "POST", base+"/projects", token, map[string]any{"title": "Bin me too"})
	projectID := out["project"].(map[string]any)["id"].(string)
	if res, out := doJSON(t, srv, "DELETE", base+"/projects/"+projectID, token, nil); res.StatusCode != 200 {
		t.Fatalf("trash project: %d %v", res.StatusCode, out)
	}

	res, out := doJSON(t, srv, "GET", base+"/trash", token, nil)
	items := trashItems(t, out)
	if res.StatusCode != 200 || len(items) != 2 || out["next_cursor"] != "" {
		t.Fatalf("shared trash: %d %v", res.StatusCode, out)
	}
	fields := []string{"kind", "id", "title", "identifier", "sub_kind", "parent_id", "count", "location_title", "location_path",
		"trashed_by", "trashed_at", "purge_after", "can_manage"}
	kinds := []string{}
	for _, raw := range items {
		it := raw.(map[string]any)
		for _, f := range fields {
			if _, ok := it[f]; !ok {
				t.Fatalf("row %v has no %s", it, f)
			}
		}
		if _, ok := it["location_path"].([]any); !ok {
			t.Fatalf("location_path = %v, want an array", it["location_path"])
		}
		kinds = append(kinds, it["kind"].(string))
	}
	slices.Sort(kinds)
	if !slices.Equal(kinds, []string{"project", "task"}) {
		t.Fatalf("kinds = %v", kinds)
	}

	_, out = doJSON(t, srv, "GET", base+"/trash?kind=project&q=bin&trashed_by=", token, nil)
	if items := trashItems(t, out); len(items) != 1 || items[0].(map[string]any)["id"] != projectID {
		t.Fatalf("kind=project: %v", out)
	}
}

func TestTrashRouteRejectsAnUnknownKind(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)
	base := "/api/v1/workspaces/" + wsID + "/trash"

	res, out := doJSON(t, srv, "GET", base+"?kind=label", token, nil)
	if e, _ := out["error"].(map[string]any); res.StatusCode != 400 || e["code"] != "invalid_filter" {
		t.Fatalf("kind=label: %d %v, want 400 invalid_filter", res.StatusCode, out)
	}
	if res, _ := doJSON(t, srv, "GET", base+"?cursor=garbage", token, nil); res.StatusCode != 400 {
		t.Fatalf("bad cursor = %d, want 400", res.StatusCode)
	}

	outsider := registerAndToken(t, srv, "trash-outsider@example.com")
	verifyEmail(t, srv, outsider)
	if res, _ := doJSON(t, srv, "GET", base, outsider, nil); res.StatusCode != 404 {
		t.Fatalf("outsider = %d, want 404", res.StatusCode)
	}
}
