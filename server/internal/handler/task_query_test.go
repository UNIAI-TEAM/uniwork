package handler

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestSuiteTasksRoutes404WhenFlagOff(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "suite-flag@example.com", "password": "password123", "display_name": "Suite",
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
		{http.MethodPost, "/api/v1/workspaces/" + fakeWs + "/tasks/query", map[string]any{"status": "todo", "limit": 10}},
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/tasks/grouped?group_by=status", nil},
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
