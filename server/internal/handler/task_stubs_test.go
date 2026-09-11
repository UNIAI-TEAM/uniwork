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
