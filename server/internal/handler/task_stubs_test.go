package handler

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestWorkManagementStubsReturnCapabilityUnavailable(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	const taskID = "01J8X4TASKN1P2Q3R4S5T6U7"
	paths := []struct {
		method, path string
	}{
		{http.MethodGet, "/api/v1/tasks/" + taskID + "/active-task"},
		{http.MethodGet, "/api/v1/tasks/" + taskID + "/pull-requests"},
		{http.MethodPost, "/api/v1/tasks/" + taskID + "/cancel"},
		{http.MethodGet, "/api/v1/workspaces/" + wsID + "/vcs/connections"},
		{http.MethodGet, "/api/v1/workspaces/" + wsID + "/tasks/search"},
	}
	for _, p := range paths {
		res, body := doJSON(t, srv, p.method, p.path, token, nil)
		if res.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("%s %s status = %d, want 422; body=%v", p.method, p.path, res.StatusCode, body)
		}
		errObj, _ := body["error"].(map[string]any)
		if errObj["code"] != "capability_unavailable" {
			raw, _ := json.Marshal(body)
			t.Fatalf("%s %s body = %s, want capability_unavailable", p.method, p.path, raw)
		}
	}
}

func TestSuiteStubRoutes404WhenFlagOff(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "stub-flag@example.com", "password": "password123", "display_name": "StubFlag",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	const taskID = "01J8X4TASKN1P2Q3R4S5T6U7"
	res, body := doJSON(t, srv, http.MethodGet, "/api/v1/tasks/"+taskID+"/active-task", token, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%v", res.StatusCode, body)
	}
	errObj, _ := body["error"].(map[string]any)
	if errObj["code"] != "feature_disabled" {
		raw, _ := json.Marshal(body)
		t.Fatalf("body = %s, want feature_disabled", raw)
	}
}
