package handler

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
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

	_, out = doJSON(t, srv, "GET", base+"/trash?kind=project&q=bin", token, nil)
	if items := trashItems(t, out); len(items) != 1 || items[0].(map[string]any)["id"] != projectID {
		t.Fatalf("kind=project: %v", out)
	}

	// Repeated kind and trashed_by are each OR-ed, and narrow each other.
	me := items[0].(map[string]any)["trashed_by"].(string)
	_, out = doJSON(t, srv, "GET", base+"/trash?kind=document&kind=task&trashed_by=01J8X4NOBODY0000000000000&trashed_by="+me, token, nil)
	if items := trashItems(t, out); len(items) != 1 || items[0].(map[string]any)["id"] != taskID {
		t.Fatalf("kind=document&kind=task&trashed_by=other&trashed_by=me: %v", out)
	}
	_, out = doJSON(t, srv, "GET", base+"/trash?kind=project&kind=task&trashed_by="+me, token, nil)
	if items := trashItems(t, out); len(items) != 2 {
		t.Fatalf("kind=project&kind=task: %v", out)
	}
	_, out = doJSON(t, srv, "GET", base+"/trash?kind=task&kind=project&trashed_by=01J8X4NOBODY0000000000000", token, nil)
	if items := trashItems(t, out); len(items) != 0 {
		t.Fatalf("trashed_by=other: %v", out)
	}
}

func TestTrashRouteRejectsAnUnknownKind(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)
	base := "/api/v1/workspaces/" + wsID + "/trash"

	var tooMany strings.Builder
	for i := range 101 {
		fmt.Fprintf(&tooMany, "&trashed_by=user-%d", i)
	}
	for _, query := range []string{"?kind=label", "?kind=task&kind=label", "?kind=", "?trashed_by=", "?trashed_by=a&trashed_by=", "?kind=task" + tooMany.String()} {
		res, out := doJSON(t, srv, "GET", base+query, token, nil)
		if e, _ := out["error"].(map[string]any); res.StatusCode != 400 || e["code"] != "invalid_filter" {
			t.Fatalf("%s: %d %v, want 400 invalid_filter", query, res.StatusCode, out)
		}
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
