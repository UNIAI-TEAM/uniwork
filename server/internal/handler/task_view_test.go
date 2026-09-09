package handler

import (
	"testing"
)

func TestViewsAndPreferencesHTTPRoundTrip(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/task-views", token, map[string]any{
		"name": "Board filter", "scope_type": "workspace",
		"query": map[string]any{"status": []string{"todo"}},
	})
	if res.StatusCode != 201 {
		t.Fatalf("create view: %d %v", res.StatusCode, body)
	}
	view, _ := body["view"].(map[string]any)
	viewID, _ := view["id"].(string)
	if viewID == "" || view["revision"].(float64) != 1 {
		t.Fatalf("view = %v", view)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/task-views?scope_type=workspace", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, body)
	}
	views, _ := body["views"].([]any)
	if len(views) != 1 {
		t.Fatalf("list len = %d", len(views))
	}

	res, body = doJSON(t, srv, "PUT", "/api/v1/workspaces/"+wsID+"/task-view-preferences", token, map[string]any{
		"scope_type": "workspace",
		"prefs":      map[string]any{"order": []string{"view:" + viewID}},
	})
	if res.StatusCode != 200 {
		t.Fatalf("put pref: %d %v", res.StatusCode, body)
	}
	if body["scope_id"] != wsID {
		t.Fatalf("pref scope_id = %v want %s", body["scope_id"], wsID)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/task-view-preferences?scope_type=workspace", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get pref: %d %v", res.StatusCode, body)
	}
	prefs, _ := body["prefs"].(map[string]any)
	order, _ := prefs["order"].([]any)
	if len(order) != 1 {
		t.Fatalf("prefs = %v", prefs)
	}
}
