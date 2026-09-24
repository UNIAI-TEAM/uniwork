package handler

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestCatalogStatusesHTTPSevenBuiltInsAndImmutable(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, body := doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/task-statuses", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, body)
	}
	statuses, _ := body["statuses"].([]any)
	if len(statuses) != 7 {
		t.Fatalf("len statuses = %d, want 7", len(statuses))
	}
	first := statuses[0].(map[string]any)
	id := first["id"].(string)
	if first["is_system"] != true {
		t.Fatalf("first is_system = %v", first["is_system"])
	}

	res, body = doJSON(t, srv, "PATCH", "/api/v1/workspaces/"+wsID+"/task-statuses/"+id, token, map[string]any{
		"name": "Nope",
	})
	if res.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("patch built-in status = %d, want 422; body=%v", res.StatusCode, body)
	}
	errObj, _ := body["error"].(map[string]any)
	if errObj["code"] != "system_status_immutable" {
		raw, _ := json.Marshal(body)
		t.Fatalf("body = %s, want system_status_immutable", raw)
	}

	res, body = doJSON(t, srv, "DELETE", "/api/v1/workspaces/"+wsID+"/task-statuses/"+id, token, nil)
	if res.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("delete built-in status = %d, want 422; body=%v", res.StatusCode, body)
	}
	errObj, _ = body["error"].(map[string]any)
	if errObj["code"] != "system_status_immutable" {
		raw, _ := json.Marshal(body)
		t.Fatalf("delete body = %s", raw)
	}
}

func TestCatalogLabelsPropertiesHTTPRoundTrip(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/task-statuses", token, map[string]any{
		"name": "Waiting QA", "category": "in_review", "color": "#22c55e",
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create status: %d %v", res.StatusCode, body)
	}
	statusID, _ := body["status"].(map[string]any)["id"].(string)
	if statusID == "" {
		t.Fatalf("status = %v", body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/task-labels", token, map[string]any{
		"name": "Bug", "color": "#ef4444",
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create label: %d %v", res.StatusCode, body)
	}
	labelID, _ := body["label"].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/task-labels/"+labelID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get label: %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/task-labels", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list labels: %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, "PUT", "/api/v1/workspaces/"+wsID+"/task-labels/"+labelID, token, map[string]any{
		"name": "Bugfix", "color": "#dc2626",
	})
	if res.StatusCode != 200 {
		t.Fatalf("put label: %d %v", res.StatusCode, body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/task-properties", token, map[string]any{
		"name": "Story Points", "type": "number",
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create property: %d %v", res.StatusCode, body)
	}
	propID, _ := body["property"].(map[string]any)["id"].(string)
	res, body = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/task-properties", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list properties: %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, "PATCH", "/api/v1/workspaces/"+wsID+"/task-properties/"+propID, token, map[string]any{
		"description": "estimate",
	})
	if res.StatusCode != 200 {
		t.Fatalf("patch property: %d %v", res.StatusCode, body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "Catalog attach HTTP",
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/labels", token, map[string]any{
		"label_id": labelID,
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("attach label: %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/labels", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list task labels: %d %v", res.StatusCode, body)
	}
	labels, _ := body["labels"].([]any)
	if len(labels) < 1 {
		t.Fatalf("task labels empty: %v", body)
	}

	res, body = doJSON(t, srv, "PUT", "/api/v1/tasks/"+taskID+"/properties/"+propID, token, map[string]any{
		"value": 5,
	})
	if res.StatusCode != 200 {
		t.Fatalf("put property value: %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, "DELETE", "/api/v1/tasks/"+taskID+"/properties/"+propID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("delete property value: %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, "DELETE", "/api/v1/tasks/"+taskID+"/labels/"+labelID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("detach label: %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, "DELETE", "/api/v1/workspaces/"+wsID+"/task-labels/"+labelID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("delete label: %d %v", res.StatusCode, body)
	}
}
