package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestStubReasonMatrixMatchesCatalogue(t *testing.T) {
	cases := []struct {
		method, pattern, want string
	}{
		{http.MethodGet, "/api/v1/tasks/{taskID}/active-task", "agent_runtime_missing"},
		{http.MethodGet, "/api/v1/tasks/{taskID}/usage", "agent_runtime_missing"},
		{http.MethodPost, "/api/v1/tasks/{taskID}/cancel", "agent_runtime_missing"},
		{http.MethodPost, "/api/v1/tasks/{taskID}/rerun", "agent_runtime_missing"},
		{http.MethodPost, "/api/v1/tasks/{taskID}/terminate", "agent_runtime_missing"},
		{http.MethodGet, "/api/v1/tasks/{taskID}/pull-requests", "vcs_provider_missing"},
		{http.MethodGet, "/api/v1/workspaces/{workspaceID}/vcs/connections", "vcs_provider_missing"},
		{http.MethodPost, "/api/v1/workspaces/{workspaceID}/vcs/connections", "vcs_provider_missing"},
		{http.MethodGet, "/api/v1/workspaces/{workspaceID}/squads", "squad_directory_missing"},
		{http.MethodPost, "/api/v1/workspaces/{workspaceID}/squads", "squad_directory_missing"},
		{http.MethodGet, "/api/v1/workspaces/{workspaceID}/workdir", "local_daemon_missing"},
	}
	for _, tc := range cases {
		got, _ := stubReason(tc.method, tc.pattern)
		if got != tc.want {
			t.Fatalf("stubReason(%s, %s) = %q, want %q", tc.method, tc.pattern, got, tc.want)
		}
	}
}

func TestAgentIntegrationStubHTTPReasonCodes(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)
	const taskID = "01J8X4TASKN1P2Q3R4S5T6U7"
	cases := []struct {
		method, path, wantReason string
	}{
		{http.MethodGet, "/api/v1/tasks/" + taskID + "/active-task", "agent_runtime_missing"},
		{http.MethodGet, "/api/v1/tasks/" + taskID + "/usage", "agent_runtime_missing"},
		{http.MethodPost, "/api/v1/tasks/" + taskID + "/cancel", "agent_runtime_missing"},
		{http.MethodPost, "/api/v1/tasks/" + taskID + "/rerun", "agent_runtime_missing"},
		{http.MethodPost, "/api/v1/tasks/" + taskID + "/terminate", "agent_runtime_missing"},
		{http.MethodGet, "/api/v1/tasks/" + taskID + "/pull-requests", "vcs_provider_missing"},
		{http.MethodGet, "/api/v1/workspaces/" + wsID + "/vcs/connections", "vcs_provider_missing"},
		{http.MethodGet, "/api/v1/workspaces/" + wsID + "/squads", "squad_directory_missing"},
		{http.MethodPost, "/api/v1/workspaces/" + wsID + "/squads", "squad_directory_missing"},
		{http.MethodGet, "/api/v1/workspaces/" + wsID + "/workdir", "local_daemon_missing"},
	}
	for _, tc := range cases {
		var bodyPayload any
		if tc.method == http.MethodPost {
			bodyPayload = map[string]any{}
		}
		res, body := doJSON(t, srv, tc.method, tc.path, token, bodyPayload)
		if res.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("%s %s status = %d, want 422; body=%v", tc.method, tc.path, res.StatusCode, body)
		}
		errObj, _ := body["error"].(map[string]any)
		if errObj["code"] != "capability_unavailable" {
			raw, _ := json.Marshal(body)
			t.Fatalf("%s %s body = %s, want capability_unavailable", tc.method, tc.path, raw)
		}
		fields, _ := errObj["fields"].(map[string]any)
		if fields["reason_code"] != tc.wantReason {
			raw, _ := json.Marshal(body)
			t.Fatalf("%s %s reason_code = %v, want %s; body=%s",
				tc.method, tc.path, fields["reason_code"], tc.wantReason, raw)
		}
	}
}

func TestAgentIntegrationStubPOSTDoesNotInsertBusinessRows(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	if _, err := q.UpsertFlagOverride(t.Context(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "tasks_work_management_parity",
		ScopeType: featureflags.ScopeGlobal, ScopeID: "", Enabled: true,
		Note: "agent-integration stubs", CreatedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "stub-sidefx@example.com", "password": "password123", "display_name": "StubSide",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{
		"name": "Stub Org", "slug": "stub-sidefx-org",
	})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{
		"name": "Stub WS", "slug": "stub-sidefx-ws",
	})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)

	ctx := context.Background()
	auditBefore := countRows(t, pool, ctx, `SELECT count(*) FROM audit_events`)
	tasksBefore := countRows(t, pool, ctx, `SELECT count(*) FROM tasks`)
	outboxBefore := countRows(t, pool, ctx, `SELECT count(*) FROM outbox_events`)

	const taskID = "01J8X4TASKN1P2Q3R4S5T6U7"
	posts := []string{
		"/api/v1/tasks/" + taskID + "/cancel",
		"/api/v1/tasks/" + taskID + "/terminate",
		"/api/v1/tasks/" + taskID + "/rerun",
		"/api/v1/workspaces/" + wsID + "/squads",
		"/api/v1/workspaces/" + wsID + "/vcs/connections",
	}
	for _, path := range posts {
		res, body := doJSON(t, srv, http.MethodPost, path, token, map[string]any{"name": "x"})
		if res.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("POST %s status = %d, want 422; body=%v", path, res.StatusCode, body)
		}
		errObj, _ := body["error"].(map[string]any)
		if errObj["code"] != "capability_unavailable" {
			t.Fatalf("POST %s code = %v, want capability_unavailable", path, errObj["code"])
		}
	}

	if got := countRows(t, pool, ctx, `SELECT count(*) FROM audit_events`); got != auditBefore {
		t.Fatalf("audit_events grew: before=%d after=%d", auditBefore, got)
	}
	if got := countRows(t, pool, ctx, `SELECT count(*) FROM tasks`); got != tasksBefore {
		t.Fatalf("tasks grew: before=%d after=%d", tasksBefore, got)
	}
	if got := countRows(t, pool, ctx, `SELECT count(*) FROM outbox_events`); got != outboxBefore {
		t.Fatalf("outbox_events grew: before=%d after=%d", outboxBefore, got)
	}
}

func countRows(t *testing.T, pool *pgxpool.Pool, ctx context.Context, sql string) int64 {
	t.Helper()
	var n int64
	if err := pool.QueryRow(ctx, sql).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
