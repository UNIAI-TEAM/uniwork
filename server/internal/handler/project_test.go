package handler

import (
	"testing"
)

func TestProjectsHTTPRoundTripAndCapabilityAvailable(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, body := doJSON(t, srv, "GET", "/api/v1/config", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("config: %d %v", res.StatusCode, body)
	}
	caps, _ := body["work_management_capabilities"].(map[string]any)
	projCap, _ := caps["tasks.projects"].(map[string]any)
	if projCap["status"] != "available" {
		t.Fatalf("tasks.projects capability = %v, want available", projCap)
	}
	if _, ok := projCap["reason_code"]; ok {
		t.Fatalf("tasks.projects reason_code = %v, want omitted", projCap["reason_code"])
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
		"revision": 1, "title": "Launch v2", "status": "in_progress",
	})
	if res.StatusCode != 200 {
		t.Fatalf("put project: %d %v", res.StatusCode, body)
	}
	if body["project"].(map[string]any)["title"] != "Launch v2" {
		t.Fatalf("updated = %v", body)
	}
	if body["project"].(map[string]any)["revision"].(float64) != 2 {
		t.Fatalf("revision after put = %v", body["project"])
	}

	res, body = doJSON(t, srv, "PUT", "/api/v1/workspaces/"+wsID+"/projects/"+projectID, token, map[string]any{
		"revision": 1, "title": "stale",
	})
	if res.StatusCode != 422 {
		t.Fatalf("stale put status = %d %v", res.StatusCode, body)
	}
	errObj, _ := body["error"].(map[string]any)
	if errObj["code"] != "revision_conflict" {
		t.Fatalf("stale put code = %v", body)
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
