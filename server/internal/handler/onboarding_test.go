package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func doJSON(t *testing.T, srv *httptest.Server, method, path, token string, body any) (*http.Response, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, srv.URL+path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	raw, _ := readAll(res)
	_ = json.Unmarshal(raw, &out)
	return res, out
}

func readAll(res *http.Response) ([]byte, error) {
	defer res.Body.Close()
	var buf bytes.Buffer
	_, err := buf.ReadFrom(res.Body)
	return buf.Bytes(), err
}

func TestOnboardingEndToEnd(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "a@example.com", "password": "password123", "display_name": "A"})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	user := out["user"].(map[string]any)
	if v, ok := user["onboarded_at"]; !ok || v != nil {
		t.Fatalf("register user must expose onboarded_at=null, got %v", user)
	}

	res, _ = doJSON(t, srv, "PATCH", "/api/v1/me/onboarding", token, map[string]any{
		"questionnaire": map[string]any{"version": 1, "role": "manager", "use_case": []string{"meetings"}}})
	if res.StatusCode != 200 {
		t.Fatalf("patch: %d", res.StatusCode)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Unicom", "slug": "unicom"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Đội Alpha", "slug": "doi-alpha"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	ws := out["workspace"].(map[string]any)
	if ws["organization_slug"] != "unicom" {
		t.Fatalf("workspace dto missing org: %v", ws)
	}
	wsID := ws["id"].(string)
	res, _ = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Khác", "slug": "doi-alpha"})
	if res.StatusCode != 409 {
		t.Fatalf("dup slug: %d", res.StatusCode)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/me", token, nil)
	if res.StatusCode != 200 || out["user"].(map[string]any)["onboarded_at"] != nil {
		t.Fatalf("me before complete: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/me/onboarding/complete", token, map[string]string{"completion_path": "full", "workspace_id": wsID})
	if res.StatusCode != 200 || out["user"].(map[string]any)["onboarded_at"] == nil {
		t.Fatalf("complete: %d %v", res.StatusCode, out)
	}

	res, _ = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/welcome-task", token, nil)
	if res.StatusCode != 201 {
		t.Fatalf("welcome task: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/welcome-task", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("welcome task again: %d", res.StatusCode)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/invitations", token, map[string]any{
		"emails": []string{"b@example.com", "a@example.com"}, "role": "member"})
	if res.StatusCode != 200 || len(out["invitations"].([]any)) != 1 || len(out["skipped"].([]any)) != 1 {
		t.Fatalf("bulk invite: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "GET", "/api/v1/orgs/unicom/workspaces/doi-alpha", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get by slugs: %d", res.StatusCode)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/orgs", token, nil)
	if res.StatusCode != 200 || len(out["organizations"].([]any)) != 1 {
		t.Fatalf("list orgs: %d %v", res.StatusCode, out)
	}
}
