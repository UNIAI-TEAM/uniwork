package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func doJSONHeaders(t *testing.T, srv *httptest.Server, method, path, token string, headers map[string]string, body any) (*http.Response, map[string]any) {
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
	for k, v := range headers {
		req.Header.Set(k, v)
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

func suiteMutationWorld(t *testing.T) (*httptest.Server, string, string, *db.Queries) {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "suite-mut@example.com", "password": "password123", "display_name": "Suite Mut",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{
		"name": "Suite Org", "slug": "suite-org",
	})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{
		"name": "Suite WS", "slug": "suite-ws",
	})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	return srv, token, wsID, q
}

func TestPutTaskSuiteStaleIfMatchConflict(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "If-Match", "priority": "medium",
	})
	if res.StatusCode != 200 {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	taskID := out["task"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "PATCH", "/api/v1/tasks/"+taskID, token, map[string]any{"status": "in_progress"})
	if res.StatusCode != 200 {
		t.Fatalf("patch: %d %v", res.StatusCode, out)
	}

	res, out = doJSONHeaders(t, srv, "PUT", "/api/v1/tasks/"+taskID, token, map[string]string{
		"If-Match": "1",
	}, map[string]any{"title": "stale"})
	if res.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("put stale: status=%d body=%v", res.StatusCode, out)
	}
	errObj, _ := out["error"].(map[string]any)
	if errObj["code"] != "revision_conflict" {
		t.Fatalf("code=%v want revision_conflict body=%v", errObj["code"], out)
	}
}

func TestBatchUpdateHTTPUpdatesThree(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	ids := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
			"title": "B", "priority": "low",
		})
		if res.StatusCode != 200 {
			t.Fatalf("create: %d %v", res.StatusCode, out)
		}
		ids = append(ids, out["task"].(map[string]any)["id"].(string))
	}

	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks/batch-update", token, map[string]any{
		"task_ids": ids,
		"updates":  map[string]any{"status": "done"},
	})
	if res.StatusCode != 200 {
		t.Fatalf("batch-update: %d %v", res.StatusCode, out)
	}
	if int(out["updated"].(float64)) != 3 {
		t.Fatalf("updated=%v want 3", out["updated"])
	}
}

func TestIdempotentCreateHTTPReplays(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)
	key := util.NewID()

	res1, out1 := doJSONHeaders(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]string{
		"Idempotency-Key": key,
	}, map[string]any{"title": "Idem HTTP", "priority": "medium"})
	if res1.StatusCode != 200 {
		t.Fatalf("first create: %d %v", res1.StatusCode, out1)
	}
	id1 := out1["task"].(map[string]any)["id"].(string)

	res2, out2 := doJSONHeaders(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]string{
		"Idempotency-Key": key,
	}, map[string]any{"title": "Idem HTTP ignored", "priority": "high"})
	if res2.StatusCode != 200 {
		t.Fatalf("replay create: %d %v", res2.StatusCode, out2)
	}
	id2 := out2["task"].(map[string]any)["id"].(string)
	if id1 != id2 {
		t.Fatalf("replay id mismatch: %s vs %s", id1, id2)
	}
}

func TestIdempotencyInFlightMapsStableHTTP(t *testing.T) {
	srv, token, wsID, q := suiteMutationWorld(t)
	key := util.NewID()

	// Claim the key without completing — simulates an in-flight create.
	ws, err := q.GetWorkspaceByID(t.Context(), wsID)
	if err != nil {
		t.Fatal(err)
	}
	userID := ""
	res, out := doJSON(t, srv, "GET", "/api/v1/me", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("me: %d %v", res.StatusCode, out)
	}
	userID = out["user"].(map[string]any)["id"].(string)

	if _, err := q.InsertIdempotencyKey(t.Context(), db.InsertIdempotencyKeyParams{
		ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: wsID,
		Scope: "tasks.create", Key: key, ActorID: userID,
	}); err != nil {
		t.Fatal(err)
	}

	res, out = doJSONHeaders(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]string{
		"Idempotency-Key": key,
	}, map[string]any{"title": "In flight", "priority": "medium"})
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("in-flight status=%d want 409 body=%v", res.StatusCode, out)
	}
	errObj, _ := out["error"].(map[string]any)
	if errObj["code"] != "idempotency_in_flight" {
		t.Fatalf("code=%v want idempotency_in_flight body=%v", errObj["code"], out)
	}
}
