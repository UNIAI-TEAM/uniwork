package handler

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// auditWorld is a signed-in organization owner with a workspace and one task
// edit behind them — the smallest world in which the audit endpoints have
// something true to say.
type auditWorld struct {
	srv    *httptest.Server
	token  string
	orgID  string
	wsID   string
	taskID string
}

func newAuditWorld(t *testing.T) auditWorld {
	t.Helper()
	return buildAuditWorld(t, newTestServer(t))
}

// buildAuditWorld registers an owner with an organization, a workspace and
// one updated task on an existing server, for tests that need the Deps too.
func buildAuditWorld(t *testing.T, srv *httptest.Server) auditWorld {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "audit@example.com", "password": "password123", "display_name": "Audit",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Unicom", "slug": "unicom"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token,
		map[string]string{"name": "Đội Alpha", "slug": "doi-alpha"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token,
		map[string]string{"title": "Việc kiểm toán"})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, out)
	}
	taskID := out["task"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "PATCH", "/api/v1/tasks/"+taskID, token, map[string]string{"status": "in_progress"})
	if res.StatusCode != 200 {
		t.Fatalf("update task: %d %v", res.StatusCode, out)
	}
	return auditWorld{srv: srv, token: token, orgID: orgID, wsID: wsID, taskID: taskID}
}

func TestAuditEndpointsExposeWhatHappened(t *testing.T) {
	w := newAuditWorld(t)

	res, out := doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit?action=task.updated", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list audit: %d %v", res.StatusCode, out)
	}
	events := out["events"].([]any)
	if len(events) != 1 {
		t.Fatalf("expected one task.updated row, got %d", len(events))
	}
	event := events[0].(map[string]any)
	if event["actor_kind"] != "human" {
		t.Fatalf("actor_kind = %v, want human", event["actor_kind"])
	}
	changes := event["changes"].(map[string]any)
	if _, ok := changes["status"]; !ok {
		t.Fatalf("changes should name the field that moved: %v", changes)
	}
	if event["correlation_id"] == "" {
		t.Fatal("every row must carry a correlation id")
	}

	// One row by id, through the same organization gate.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/"+event["id"].(string), w.token, nil)
	if res.StatusCode != 200 || out["event"].(map[string]any)["action"] != "task.updated" {
		t.Fatalf("get audit event: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/01J8X4NOTHINGATALL000000", w.token, nil)
	if res.StatusCode != 404 {
		t.Fatalf("unknown event id: %d", res.StatusCode)
	}

	// The task's own history, through the workspace gate rather than the org one.
	res, out = doJSON(t, w.srv, "GET",
		"/api/v1/workspaces/"+w.wsID+"/resources/task/"+w.taskID+"/history", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("resource history: %d %v", res.StatusCode, out)
	}
	if len(out["events"].([]any)) < 2 {
		t.Fatalf("history should hold the create and the update: %v", out["events"])
	}
}

func TestAuditRetentionAndExportEndpoints(t *testing.T) {
	w := newAuditWorld(t)

	res, out := doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/retention", w.token, nil)
	if res.StatusCode != 200 || out["retain_days"].(float64) != 90 {
		t.Fatalf("default retention: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/audit/retention", w.token,
		map[string]any{"retain_days": 180})
	if res.StatusCode != 200 || out["retain_days"].(float64) != 180 {
		t.Fatalf("set retention: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/audit/retention", w.token,
		map[string]any{"retain_days": 5})
	if res.StatusCode != 400 {
		t.Fatalf("a five-day window should be rejected, got %d", res.StatusCode)
	}

	from := time.Now().Add(-24 * time.Hour).UTC().Format(time.RFC3339)
	to := time.Now().UTC().Format(time.RFC3339)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token,
		map[string]string{"format": "csv", "from": from, "to": to})
	if res.StatusCode != 202 {
		t.Fatalf("request export: %d %v", res.StatusCode, out)
	}
	exportID := out["export"].(map[string]any)["id"].(string)
	if out["export"].(map[string]any)["status"] != "pending" {
		t.Fatalf("a queued export should say so: %v", out["export"])
	}

	// A second export is refused while the first is in flight.
	res, _ = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token,
		map[string]string{"format": "csv", "from": from, "to": to})
	if res.StatusCode != 409 {
		t.Fatalf("second export: %d, want 409", res.StatusCode)
	}
	// A range the server cannot parse is a 400, not a 500.
	res, _ = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token,
		map[string]string{"format": "csv", "from": "hôm qua", "to": to})
	if res.StatusCode != 400 {
		t.Fatalf("unparseable range: %d, want 400", res.StatusCode)
	}

	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports/"+exportID, w.token, nil)
	if res.StatusCode != 200 || out["export"].(map[string]any)["id"] != exportID {
		t.Fatalf("get export: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token, nil)
	if res.StatusCode != 200 || len(out["exports"].([]any)) != 1 {
		t.Fatalf("list exports: %d %v", res.StatusCode, out)
	}
}

// Someone outside the organization must not be able to tell an organization
// that exists from one that does not.
func TestAuditEndpointsRefuseAnOutsider(t *testing.T) {
	w := newAuditWorld(t)
	res, out := doJSON(t, w.srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "outsider@example.com", "password": "password123", "display_name": "Outsider",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register outsider: %d %v", res.StatusCode, out)
	}
	outsider := out["access_token"].(string)

	for _, path := range []string{
		"/api/v1/orgs/" + w.orgID + "/audit",
		"/api/v1/orgs/" + w.orgID + "/audit/retention",
		"/api/v1/orgs/" + w.orgID + "/audit/exports",
	} {
		res, _ := doJSON(t, w.srv, "GET", path, outsider, nil)
		if res.StatusCode != 403 {
			t.Fatalf("%s returned %d for an outsider, want 403", path, res.StatusCode)
		}
	}
	res, _ = doJSON(t, w.srv, "GET",
		"/api/v1/workspaces/"+w.wsID+"/resources/task/"+w.taskID+"/history", outsider, nil)
	if res.StatusCode != 403 {
		t.Fatalf("resource history for an outsider: %d, want 403", res.StatusCode)
	}
	// And without a token at all.
	res, _ = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit", "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("anonymous audit read: %d, want 401", res.StatusCode)
	}
}

// The header is echoed so a support conversation can start from the browser.
func TestCorrelationHeaderIsEchoed(t *testing.T) {
	srv := newTestServer(t)
	res, _ := doJSON(t, srv, "GET", "/api/v1/orgs", "", nil)
	if res.Header.Get("X-Correlation-ID") == "" {
		t.Fatal("every response must carry the correlation id back")
	}
}

// runAuditExportWorker finishes a queued export exactly the way the outbox
// dispatcher does: the same consumer, on the database and storage the server
// under test is using.
func runAuditExportWorker(t *testing.T, exportID, orgID string) {
	t.Helper()
	payload, err := json.Marshal(map[string]string{"export_id": exportID, "organization_id": orgID})
	if err != nil {
		t.Fatal(err)
	}
	store := storage.NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("local storage could not be created for the export")
	}
	consumer := service.NewAuditExportConsumer(db.New(testPool), store)
	if err := consumer.Handle(context.Background(), db.OutboxEvent{
		ID: "ev-export-" + exportID, Topic: "audit.export_requested", Payload: string(payload),
	}); err != nil {
		t.Fatalf("audit export consumer: %v", err)
	}
}

// A finished export offers a link for 24 hours and then withdraws it. The
// handler compares the completion stamp against the window instead of trusting
// the stored URL, so a URL pasted into a chat yesterday is not a standing
// grant. T10 keeps this business window when the file moves to FileService.
func TestAuditExportDownloadLinkStopsAfter24Hours(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	srv := newTestServer(t)
	w := buildAuditWorld(t, srv)

	from := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	to := time.Now().UTC().Format(time.RFC3339)
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token,
		map[string]string{"format": "csv", "from": from, "to": to})
	if res.StatusCode != 202 {
		t.Fatalf("request export: %d %v", res.StatusCode, out)
	}
	exportID := out["export"].(map[string]any)["id"].(string)
	runAuditExportWorker(t, exportID, w.orgID)

	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports/"+exportID, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get export: %d %v", res.StatusCode, out)
	}
	fresh := out["export"].(map[string]any)
	if fresh["status"] != "done" || fresh["download_url"] == nil || fresh["expires_at"] == nil {
		t.Fatalf("a finished export must offer a link and its expiry: %v", fresh)
	}
	if fresh["row_count"].(float64) == 0 {
		t.Fatalf("the export carried no rows from a world with tasks in it: %v", fresh)
	}

	// A day later, with nothing else touched, the link is gone.
	if _, err := testPool.Exec(context.Background(), `UPDATE audit_exports
		SET completed_at = now() - interval '25 hours',
		    expires_at = now() - interval '1 hour'
		WHERE id = $1`, exportID); err != nil {
		t.Fatal(err)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports/"+exportID, w.token, nil)
	lapsed := out["export"].(map[string]any)
	if res.StatusCode != 200 {
		t.Fatalf("lapsed export read: %d %v", res.StatusCode, lapsed)
	}
	if lapsed["download_url"] != nil {
		t.Fatalf("a lapsed export still hands out a link: %v", lapsed["download_url"])
	}
	// The job keeps its record: evidence outlives the link.
	if lapsed["status"] != "done" || lapsed["row_count"] == float64(0) {
		t.Fatalf("the lapsed job lost its record: %v", lapsed)
	}
}

// The export is organization data behind an id an outsider could be handed by
// mistake, so an owner of another organization gets a 403 for the job, the list
// and the queue endpoint without the server saying whether the id exists.
func TestAuditExportsAreRefusedAcrossOrganizations(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	srv := newTestServer(t)
	w := buildAuditWorld(t, srv)

	from := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	to := time.Now().UTC().Format(time.RFC3339)
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token,
		map[string]string{"format": "csv", "from": from, "to": to})
	if res.StatusCode != 202 {
		t.Fatalf("request export: %d %v", res.StatusCode, out)
	}
	exportID := out["export"].(map[string]any)["id"].(string)

	// A real second organization with its own owner and token.
	res, out = doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "audit-owner-b@example.com", "password": "password123", "display_name": "Owner B",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register owner B: %d %v", res.StatusCode, out)
	}
	tokenB := out["access_token"].(string)
	verifyEmail(t, srv, tokenB)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", tokenB,
		map[string]string{"name": "Other Org", "slug": "other-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org B: %d %v", res.StatusCode, out)
	}

	res, _ = doJSON(t, srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports/"+exportID, tokenB, nil)
	if res.StatusCode != 403 {
		t.Fatalf("another organization's owner read the job: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports", tokenB, nil)
	if res.StatusCode != 403 {
		t.Fatalf("another organization's owner listed the exports: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", tokenB,
		map[string]string{"format": "csv", "from": from, "to": to})
	if res.StatusCode != 403 {
		t.Fatalf("another organization's owner queued an export: %d", res.StatusCode)
	}
}

// LEGACY (Bước 0, pinned on purpose): the export API hands the browser a direct
// storage URL - GET /uploads/*, a static route that carries no authorization and
// re-checks neither the reader's audit permission nor the export's expiry. T10
// must replace it with a resolve endpoint that does both, so that PR is expected
// to rewrite this assertion; the lane report carries the finding.
func TestLegacyExportDownloadIsADirectStorageURL(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	// A relative URL keeps this assertion independent of the local base URL.
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	srv := newTestServer(t)
	w := buildAuditWorld(t, srv)

	from := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	to := time.Now().UTC().Format(time.RFC3339)
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token,
		map[string]string{"format": "csv", "from": from, "to": to})
	if res.StatusCode != 202 {
		t.Fatalf("request export: %d %v", res.StatusCode, out)
	}
	exportID := out["export"].(map[string]any)["id"].(string)
	runAuditExportWorker(t, exportID, w.orgID)

	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports/"+exportID, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get export: %d %v", res.StatusCode, out)
	}
	url, _ := out["export"].(map[string]any)["download_url"].(string)
	want := "/uploads/audit-exports/" + w.orgID + "/" + exportID + ".csv"
	if url != want {
		t.Fatalf("download_url = %q, want the direct storage URL %q", url, want)
	}
}
