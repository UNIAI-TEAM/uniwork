package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/graph/projector"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestGraphRoutes(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	token, wsID := registerOrgWorkspace(t, srv, "graph-http@example.com", "Đồ thị", "graph-http")

	path := func(id string) string { return "/api/v1/workspaces/" + wsID + "/graph/nodes/TASK/" + id + "/neighbors" }
	// Flag off: the route answers 404 feature_disabled.
	res, body := doJSON(t, srv, http.MethodGet, path("x"), token, nil)
	if apiErr, _ := body["error"].(map[string]any); res.StatusCode != http.StatusNotFound || apiErr["code"] != "feature_disabled" {
		t.Fatalf("flag off = %d %v", res.StatusCode, body)
	}
	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "graph_ui", ScopeType: featureflags.ScopeGlobal, ScopeID: "",
		Enabled: true, Note: "graph handler tests", CreatedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}

	ws, err := q.GetWorkspaceByID(context.Background(), wsID)
	if err != nil {
		t.Fatal(err)
	}
	_, me := doJSON(t, srv, http.MethodGet, "/api/v1/me", token, nil)
	user, _ := me["user"].(map[string]any)
	userID, _ := user["id"].(string)
	task, err := d.Tasks.Create(context.Background(), service.Human(userID), wsID, service.CreateTaskInput{Title: "Qua HTTP"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := projector.RebuildOrg(context.Background(), pool, q, ws.OrganizationID, projector.RebuildOptions{}); err != nil {
		t.Fatal(err)
	}
	res, body = doJSON(t, srv, http.MethodGet, path(task.ID), token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("neighbors = %d %v", res.StatusCode, body)
	}
	node, _ := body["node"].(map[string]any)
	if node["id"] != task.ID || node["type"] != "TASK" {
		t.Fatalf("root = %v", body["node"])
	}
	if res, _ := doJSON(t, srv, http.MethodGet, path("01NOTATASK00000000000000000"), token, nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown node = %d", res.StatusCode)
	}
	if res, _ := doJSON(t, srv, http.MethodGet, path(task.ID)+"?direction=sideways", token, nil); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad direction = %d", res.StatusCode)
	}
	hist := "/api/v1/workspaces/" + wsID + "/graph/nodes/TASK/" + task.ID + "/history"
	if res, body := doJSON(t, srv, http.MethodGet, hist, token, nil); res.StatusCode != http.StatusOK || body["items"] == nil {
		t.Fatalf("history = %d %v", res.StatusCode, body)
	}
}
