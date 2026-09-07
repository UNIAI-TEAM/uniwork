package handler

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestSuiteCatalogRoutes404WhenFlagOff(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "catalog-flag@example.com", "password": "password123", "display_name": "Cat",
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
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/task-statuses", nil},
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/task-labels", nil},
		{http.MethodGet, "/api/v1/workspaces/" + fakeWs + "/task-properties", nil},
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
