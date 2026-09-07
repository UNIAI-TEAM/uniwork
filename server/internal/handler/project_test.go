package handler

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestSuiteProjectsRoutes404WhenFlagOff(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "projects-flag@example.com", "password": "password123", "display_name": "Projects",
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
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/projects", nil},
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/projects/search?q=x", nil},
		{http.MethodPost, "/api/v1/workspaces/" + fakeWs + "/projects", map[string]any{"title": "x"}},
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

func TestProjectsHTTPRoundTripAndCapabilityNotReady(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, body := doJSON(t, srv, "GET", "/api/v1/config", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("config: %d %v", res.StatusCode, body)
	}
	caps, _ := body["work_management_capabilities"].(map[string]any)
	projCap, _ := caps["tasks.projects"].(map[string]any)
	if projCap["status"] != "unavailable" || projCap["reason_code"] != "surface_not_ready" {
		t.Fatalf("tasks.projects capability = %v, want unavailable/surface_not_ready", projCap)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/projects", token, map[string]any{
		"title": "Launch", "status": "planned",
		"resources": []map[string]any{{
			"resource_type": "github_repo",
			"resource_ref":  map[string]any{"url": "https://github.com/acme/launch.git"},
			"label":         "repo",
		}},
	})
	if res.StatusCode != 201 {
		t.Fatalf("create: %d %v", res.StatusCode, body)
	}
	project, _ := body["project"].(map[string]any)
	projectID, _ := project["id"].(string)
	if projectID == "" || project["revision"].(float64) != 1 {
		t.Fatalf("project = %v", project)
	}
	if project["resource_count"].(float64) != 1 {
		t.Fatalf("resource_count = %v", project["resource_count"])
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/projects", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, body)
	}
	projects, _ := body["projects"].([]any)
	if len(projects) != 1 {
		t.Fatalf("list len = %d", len(projects))
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/projects/search?q=Launch", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("search: %d %v", res.StatusCode, body)
	}
	if len(body["projects"].([]any)) != 1 {
		t.Fatalf("search = %v", body)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/projects/"+projectID+"/resources", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list resources: %d %v", res.StatusCode, body)
	}
	resources, _ := body["resources"].([]any)
	if len(resources) != 1 {
		t.Fatalf("resources = %v", body)
	}
	resourceID := resources[0].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "PUT", "/api/v1/workspaces/"+wsID+"/projects/"+projectID, token, map[string]any{
		"title": "Launch v2", "status": "in_progress",
	})
	if res.StatusCode != 200 {
		t.Fatalf("put project: %d %v", res.StatusCode, body)
	}
	if body["project"].(map[string]any)["title"] != "Launch v2" {
		t.Fatalf("updated = %v", body)
	}

	res, body = doJSON(t, srv, "PUT", "/api/v1/workspaces/"+wsID+"/projects/"+projectID+"/resources/"+resourceID, token, map[string]any{
		"label": "primary",
	})
	if res.StatusCode != 200 {
		t.Fatalf("put resource: %d %v", res.StatusCode, body)
	}

	res, body = doJSON(t, srv, "DELETE", "/api/v1/workspaces/"+wsID+"/projects/"+projectID+"/resources/"+resourceID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("delete resource: %d %v", res.StatusCode, body)
	}

	res, body = doJSON(t, srv, "DELETE", "/api/v1/workspaces/"+wsID+"/projects/"+projectID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("delete project: %d %v", res.StatusCode, body)
	}
}
