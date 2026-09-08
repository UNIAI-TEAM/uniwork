package handler

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestSuiteViewsRoutes404WhenFlagOff(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "views-flag@example.com", "password": "password123", "display_name": "Views",
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
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/task-views", nil},
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/task-view-preferences", nil},
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/pins", nil},
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
