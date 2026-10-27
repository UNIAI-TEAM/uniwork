package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// auditQueryCountingDBTX wraps a db.DBTX and counts executions of
// ListResourceAuditEvents so TestDriveResourceHistoryGate can prove that
// denied Drive resource history requests never run the resource audit SELECT.
type auditQueryCountingDBTX struct {
	inner           db.DBTX
	resourceSelects atomic.Int64
}

func (c *auditQueryCountingDBTX) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return c.inner.Exec(ctx, sql, args...)
}

func (c *auditQueryCountingDBTX) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if strings.Contains(sql, "ListResourceAuditEvents") {
		c.resourceSelects.Add(1)
	}
	return c.inner.Query(ctx, sql, args...)
}

func (c *auditQueryCountingDBTX) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return c.inner.QueryRow(ctx, sql, args...)
}

type driveHTTPTestEnv struct {
	deps    Deps
	pool    *pgxpool.Pool
	q       *db.Queries
	srv     *httptest.Server
	box     *secretbox.Box
	orgID   string
	wsID    string
	ownerID string
	ownerTk string
	peerID  string
	peerTk  string
	thirdID string
	thirdTk string

	mu            sync.Mutex
	googleError   map[string]int
	googleParents map[string][]string
	googleFolders map[string]string
	auditCounter  *auditQueryCountingDBTX
}

func newDriveHTTPTestEnv(t *testing.T) *driveHTTPTestEnv {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	box := testDriveSecretBox(t)
	auditCounter := &auditQueryCountingDBTX{inner: pool}
	q := db.New(pool)
	d.Audit = service.NewAuditService(pool, db.New(auditCounter), d.Organizations, d.Workspaces)
	sp := featureflag.NewStaticProvider()
	sp.Set("drive_connector", featureflag.Rule{Default: true})
	d.FeatureFlags = featureflag.NewService(sp)

	d.Cfg.FrontendOrigin = "http://localhost:3000"
	d.Cfg.DriveFakeProvider = true
	d.Cfg.GoogleDrivePickerAPIKey = "picker-api-key-test"
	d.Cfg.GoogleDriveAppID = "9876543210"
	d.DesktopAuth = service.NewDesktopAuthService(pool, q, d.Minter, d.Cfg)

	d.DriveConnections = service.NewDriveConnectionService(pool, q, d.Workspaces, box)
	d.DriveConnections.ConfigureOAuth(d.Cfg)
	d.DriveConnections.SetFlags(d.FeatureFlags)

	env := &driveHTTPTestEnv{
		deps:          d,
		pool:          pool,
		q:             q,
		box:           box,
		googleError:   make(map[string]int),
		googleParents: make(map[string][]string),
		googleFolders: make(map[string]string),
		auditCounter:  auditCounter,
	}

	googleFake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		extID := strings.TrimPrefix(r.URL.Path, "/drive/v3/files/")
		env.mu.Lock()
		status := env.googleError[extID]
		parents := env.googleParents[extID]
		folderName, isFolder := env.googleFolders[extID]
		env.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if status != 0 {
			w.WriteHeader(status)
			reason := "notFound"
			if status == http.StatusForbidden {
				reason = "insufficientFilePermissions"
			} else if status >= 500 {
				reason = "backendError"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"code":    status,
					"message": "simulated error",
					"errors":  []map[string]any{{"reason": reason}},
				},
			})
			return
		}
		if isFolder {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":       extID,
				"name":     folderName,
				"mimeType": "application/vnd.google-apps.folder",
				"trashed":  false,
			})
			return
		}
		body := map[string]any{
			"id":           extID,
			"name":         "Spec Document " + extID,
			"mimeType":     "application/vnd.google-apps.document",
			"webViewLink":  "https://docs.google.com/document/d/" + extID + "/edit",
			"shared":       true,
			"trashed":      false,
			"modifiedTime": "2026-10-26T10:00:00Z",
			"owners":       []map[string]any{{"displayName": "Owner " + extID}},
			"permissions":  []map[string]any{{"id": "p1"}, {"id": "p2"}},
		}
		if len(parents) > 0 {
			body["parents"] = parents
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(googleFake.Close)

	d.DriveFiles = service.NewDriveFileService(pool, q, d.Workspaces, d.DriveConnections,
		service.NewDriveAPIClientForTest(googleFake.URL+"/drive/v3", googleFake.Client().Transport))
	d.DriveFiles.SetFlags(d.FeatureFlags)
	d.Tasks.SetDriveFiles(d.DriveFiles)
	d.Audit.SetDriveFiles(d.DriveFiles)

	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	env.srv = srv

	regUser := func(prefix, name string) (string, string) {
		tag := strings.ToLower(util.NewID()[:8])
		res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
			"email": prefix + "-" + tag + "@example.com", "password": "password123", "display_name": name,
		})
		if res.StatusCode != http.StatusOK {
			t.Fatalf("register %s: %d %v", prefix, res.StatusCode, out)
		}
		tok := out["access_token"].(string)
		uid := out["user"].(map[string]any)["id"].(string)
		verifyEmail(t, srv, tok)
		return uid, tok
	}

	env.ownerID, env.ownerTk = regUser("drive-owner", "Owner")
	env.peerID, env.peerTk = regUser("drive-peer", "Peer")
	env.thirdID, env.thirdTk = regUser("drive-third", "Third")

	tag := strings.ToLower(util.NewID()[:8])
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", env.ownerTk, map[string]string{
		"name": "Drive HTTP Org", "slug": "drive-http-org-" + tag,
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	env.orgID = out["organization"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+env.orgID+"/workspaces", env.ownerTk, map[string]string{
		"name": "Drive HTTP WS", "slug": "drive-http-ws-" + tag,
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	env.wsID = out["workspace"].(map[string]any)["id"].(string)

	ctx := context.Background()
	for _, u := range []string{env.peerID, env.thirdID} {
		if _, err := pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`, env.orgID, u); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role, organization_id) VALUES ($1, $2, 'member', $3)`, env.wsID, u, env.orgID); err != nil {
			t.Fatal(err)
		}
	}

	return env
}

func (e *driveHTTPTestEnv) seedConnection(t *testing.T, userID, sub, email string) string {
	t.Helper()
	refRaw, err := e.box.Seal([]byte("secret-refresh-token-" + sub))
	if err != nil {
		t.Fatal(err)
	}
	accRaw, err := e.box.Seal([]byte("access-token-" + sub))
	if err != nil {
		t.Fatal(err)
	}
	connID := util.NewID()
	_, err = e.pool.Exec(context.Background(), `INSERT INTO drive_connections
		(id, organization_id, user_id, provider, google_sub, google_email, refresh_token_enc, access_token_enc, access_expires_at, credential_version, scopes)
		VALUES ($1, $2, $3, 'google', $4, $5, $6, $7, now() + interval '1 hour', 1, 'openid email https://www.googleapis.com/auth/drive.file')`,
		connID, e.orgID, userID, sub, email, base64.StdEncoding.EncodeToString(refRaw), base64.StdEncoding.EncodeToString(accRaw))
	if err != nil {
		t.Fatalf("seed drive connection: %v", err)
	}
	return connID
}

// TestDrivePickerTokenChecksOwnerDesktopAndNeverExposesRefreshToken verifies
// POST /api/v1/workspaces/{workspaceID}/drive-connections/{driveConnectionID}/picker-token:
//   - Owner of the active connection gets 200 with access_token, expires_at,
//     developer_key, app_id, and the response body never contains refresh_token.
//   - Another workspace member calling with the owner's connection id gets 404.
//   - A desktop (non-web) bearer token is refused with 403 forbidden (spec §17.5).
func TestDrivePickerTokenChecksOwnerDesktopAndNeverExposesRefreshToken(t *testing.T) {
	e := newDriveHTTPTestEnv(t)
	ownerConn := e.seedConnection(t, e.ownerID, "sub-owner-picker", "owner-picker@example.com")
	path := "/api/v1/workspaces/" + e.wsID + "/drive-connections/" + ownerConn + "/picker-token"

	// 1. Owner gets 200 and no refresh token in payload.
	res, out := doJSON(t, e.srv, "POST", path, e.ownerTk, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("owner picker-token = %d %v, want 200", res.StatusCode, out)
	}
	if out["access_token"] != "access-token-sub-owner-picker" {
		t.Fatalf("access_token = %v, want access-token-sub-owner-picker", out["access_token"])
	}
	if out["developer_key"] != "picker-api-key-test" || out["app_id"] != "9876543210" {
		t.Fatalf("developer_key/app_id = %v / %v", out["developer_key"], out["app_id"])
	}
	if _, hasRefresh := out["refresh_token"]; hasRefresh {
		t.Fatalf("picker-token response must never contain refresh_token: %v", out)
	}
	rawBytes, _ := json.Marshal(out)
	if strings.Contains(string(rawBytes), "secret-refresh-token") || strings.Contains(string(rawBytes), "refresh_token") {
		t.Fatalf("picker-token leaked refresh token: %s", string(rawBytes))
	}

	// 2. Peer member calling with owner's connection ID gets 404.
	peerRes, peerOut := doJSON(t, e.srv, "POST", path, e.peerTk, nil)
	if peerRes.StatusCode != http.StatusNotFound {
		t.Fatalf("peer picker-token on owner connection = %d %v, want 404", peerRes.StatusCode, peerOut)
	}

	// 3. Desktop native session token (Web=false) is refused 403 forbidden.
	desktopToken, err := e.deps.Minter.MintSession(e.ownerID, "desktop-sess-1")
	if err != nil {
		t.Fatal(err)
	}
	deskRes, deskOut := doJSON(t, e.srv, "POST", path, desktopToken, nil)
	if deskRes.StatusCode != http.StatusForbidden {
		t.Fatalf("desktop session picker-token = %d %v, want 403", deskRes.StatusCode, deskOut)
	}
}

// TestDriveFilesHTTPLifecycleVisibilityAndPermissions covers:
//   - POST /workspaces/{ws}/drive-files (linked, already_linked, per-item error)
//   - GET /workspaces/{ws}/drive-files (personal library visibility gate §7.6a)
//   - GET /workspaces/{ws}/drive-files/{id} (404 to unrelated member; 200 with
//     viewer_access=unknown when linked to a visible task; 200 granted after POST /access)
//   - PUT /workspaces/{ws}/drive-files/{id}/access (409 use_rebind for bound_by;
//     200 for another member switching read account)
//   - POST /workspaces/{ws}/drive-files/{id}/rebind
//   - GET /tasks/{taskID}/drive-files and DELETE /tasks/{taskID}/drive-files/{id}
//   - DELETE /workspaces/{ws}/drive-files/{id} (403 for non-manager; 200 for bound_by)
func TestDriveFilesHTTPLifecycleVisibilityAndPermissions(t *testing.T) {
	e := newDriveHTTPTestEnv(t)
	ownerConn := e.seedConnection(t, e.ownerID, "sub-owner-1", "owner1@example.com")
	peerConn1 := e.seedConnection(t, e.peerID, "sub-peer-1", "peer1@example.com")
	peerConn2 := e.seedConnection(t, e.peerID, "sub-peer-2", "peer2@example.com")

	// Create a task in the workspace.
	taskRes, taskOut := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/tasks", e.ownerTk, map[string]any{
		"title": "Task with Drive files",
	})
	if taskRes.StatusCode != http.StatusOK {
		t.Fatalf("create task = %d %v", taskRes.StatusCode, taskOut)
	}
	taskID := taskOut["task"].(map[string]any)["id"].(string)

	// Script one missing file on Google Drive so Link returns mixed outcomes in 200 results[].
	e.mu.Lock()
	e.googleError["ext-missing-1"] = http.StatusNotFound
	e.mu.Unlock()

	// 1. Owner links ext-doc-1 and ext-missing-1.
	linkRes, linkOut := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-files", e.ownerTk, map[string]any{
		"connection_id":     ownerConn,
		"external_file_ids": []string{"ext-doc-1", "ext-missing-1"},
	})
	if linkRes.StatusCode != http.StatusOK {
		t.Fatalf("LinkDriveFiles = %d %v", linkRes.StatusCode, linkOut)
	}
	results := jsonArrayAt(t, linkOut, "results")
	if len(results) != 2 {
		t.Fatalf("results len = %d, want 2: %v", len(results), results)
	}
	r0 := results[0].(map[string]any)
	r1 := results[1].(map[string]any)
	if r0["outcome"] != "linked" {
		t.Fatalf("r0 outcome = %v, want linked: %v", r0["outcome"], r0)
	}
	driveFileID := r0["file"].(map[string]any)["id"].(string)
	if r1["outcome"] != "error" || r1["error_code"] != "drive_file_not_accessible" {
		t.Fatalf("r1 = %v, want outcome=error error_code=drive_file_not_accessible", r1)
	}

	// 2. Visibility gate on list and detail before task attachment:
	// Owner sees 1 file in GET /drive-files; peer has no drive_file_access and no task link -> 0 in list, 404 on detail.
	ownerListRes, ownerListOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files", e.ownerTk, nil)
	if ownerListRes.StatusCode != http.StatusOK || len(jsonArrayAt(t, ownerListOut, "files")) != 1 {
		t.Fatalf("owner ListDriveFiles = %d %v, want 1 file", ownerListRes.StatusCode, ownerListOut)
	}
	peerListRes, peerListOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files", e.peerTk, nil)
	if peerListRes.StatusCode != http.StatusOK || len(jsonArrayAt(t, peerListOut, "files")) != 0 {
		t.Fatalf("peer ListDriveFiles before grant = %d %v, want 0 files", peerListRes.StatusCode, peerListOut)
	}
	peerGet404, _ := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+driveFileID, e.peerTk, nil)
	if peerGet404.StatusCode != http.StatusNotFound {
		t.Fatalf("peer GetDriveFile without access or task link = %d, want 404", peerGet404.StatusCode)
	}

	// 3. Owner attaches ext-doc-1 to taskID (already_linked outcome).
	linkTaskRes, linkTaskOut := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-files", e.ownerTk, map[string]any{
		"connection_id":     ownerConn,
		"external_file_ids": []string{"ext-doc-1"},
		"task_id":           taskID,
	})
	if linkTaskRes.StatusCode != http.StatusOK {
		t.Fatalf("LinkDriveFiles with task_id = %d %v", linkTaskRes.StatusCode, linkTaskOut)
	}
	rt0 := jsonArrayAt(t, linkTaskOut, "results")[0].(map[string]any)
	if rt0["outcome"] != "already_linked" {
		t.Fatalf("re-link with task_id outcome = %v, want already_linked", rt0["outcome"])
	}

	// 4. Now peer can view taskID, so GET /drive-files/{id} and GET /tasks/{taskID}/drive-files succeed with viewer_access=unknown.
	peerGetRes, peerGetOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+driveFileID, e.peerTk, nil)
	if peerGetRes.StatusCode != http.StatusOK {
		t.Fatalf("peer GetDriveFile via visible task = %d %v, want 200", peerGetRes.StatusCode, peerGetOut)
	}
	peerFileObj := peerGetOut["file"].(map[string]any)
	if peerFileObj["viewer_access"] != "unknown" {
		t.Fatalf("peer viewer_access = %v, want unknown", peerFileObj["viewer_access"])
	}

	taskFilesRes, taskFilesOut := doJSON(t, e.srv, "GET", "/api/v1/tasks/"+taskID+"/drive-files", e.peerTk, nil)
	if taskFilesRes.StatusCode != http.StatusOK {
		t.Fatalf("peer ListTaskDriveFiles = %d %v, want 200", taskFilesRes.StatusCode, taskFilesOut)
	}
	cards := jsonArrayAt(t, taskFilesOut, "files")
	if len(cards) != 1 || cards[0].(map[string]any)["viewer_access"] != "unknown" {
		t.Fatalf("peer task drive cards = %v, want 1 card with viewer_access=unknown", cards)
	}

	// 5. Peer grants read access via POST /access with peerConn1 -> viewer_access becomes granted.
	grantRes, grantOut := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+driveFileID+"/access", e.peerTk, map[string]any{
		"connection_id": peerConn1,
	})
	if grantRes.StatusCode != http.StatusOK {
		t.Fatalf("peer GrantDriveFileAccess = %d %v, want 200", grantRes.StatusCode, grantOut)
	}
	if grantOut["file"].(map[string]any)["viewer_access"] != "granted" {
		t.Fatalf("after grant viewer_access = %v, want granted", grantOut["file"].(map[string]any)["viewer_access"])
	}

	// 6. Owner (who is bound_by) calling PUT /access gets 409 use_rebind; peer calling PUT /access with peerConn2 gets 200.
	ownerPutRes, ownerPutOut := doJSON(t, e.srv, "PUT", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+driveFileID+"/access", e.ownerTk, map[string]any{
		"connection_id": ownerConn,
	})
	if ownerPutRes.StatusCode != http.StatusConflict || errorCode(ownerPutOut) != "use_rebind" {
		t.Fatalf("owner PUT /access = %d %v, want 409 use_rebind", ownerPutRes.StatusCode, ownerPutOut)
	}
	peerPutRes, peerPutOut := doJSON(t, e.srv, "PUT", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+driveFileID+"/access", e.peerTk, map[string]any{
		"connection_id": peerConn2,
	})
	if peerPutRes.StatusCode != http.StatusOK {
		t.Fatalf("peer PUT /access = %d %v, want 200", peerPutRes.StatusCode, peerPutOut)
	}
	if peerPutOut["file"].(map[string]any)["viewer_account_email"] != "peer2@example.com" {
		t.Fatalf("peer viewer_account_email after PUT = %v, want peer2@example.com", peerPutOut["file"].(map[string]any)["viewer_account_email"])
	}

	// 7. Peer (plain member, neither creator nor bound_by) cannot rebind or unlink from workspace (403).
	peerRebindRes, _ := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+driveFileID+"/rebind", e.peerTk, map[string]any{
		"connection_id": peerConn2,
	})
	if peerRebindRes.StatusCode != http.StatusForbidden {
		t.Fatalf("peer RebindDriveFile = %d, want 403", peerRebindRes.StatusCode)
	}
	peerUnlinkRes, _ := doJSON(t, e.srv, "DELETE", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+driveFileID, e.peerTk, nil)
	if peerUnlinkRes.StatusCode != http.StatusForbidden {
		t.Fatalf("peer UnlinkDriveFile = %d, want 403", peerUnlinkRes.StatusCode)
	}

	// 8. Owner rebinds to a second connection of their own.
	ownerConn2 := e.seedConnection(t, e.ownerID, "sub-owner-2", "owner2@example.com")
	rebindRes, rebindOut := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+driveFileID+"/rebind", e.ownerTk, map[string]any{
		"connection_id": ownerConn2,
	})
	if rebindRes.StatusCode != http.StatusOK {
		t.Fatalf("owner RebindDriveFile = %d %v, want 200", rebindRes.StatusCode, rebindOut)
	}
	if rebindOut["file"].(map[string]any)["bound_account_email"] != "owner2@example.com" {
		t.Fatalf("bound_account_email after rebind = %v, want owner2@example.com", rebindOut["file"].(map[string]any)["bound_account_email"])
	}

	// 9. Remove from task keeps the file in personal libraries; Unlink from workspace soft-deletes it.
	remTaskRes, _ := doJSON(t, e.srv, "DELETE", "/api/v1/tasks/"+taskID+"/drive-files/"+driveFileID, e.ownerTk, nil)
	if remTaskRes.StatusCode != http.StatusOK {
		t.Fatalf("RemoveTaskDriveFile = %d, want 200", remTaskRes.StatusCode)
	}
	afterRemRes, afterRemOut := doJSON(t, e.srv, "GET", "/api/v1/tasks/"+taskID+"/drive-files", e.ownerTk, nil)
	if afterRemRes.StatusCode != http.StatusOK || len(jsonArrayAt(t, afterRemOut, "files")) != 0 {
		t.Fatalf("ListTaskDriveFiles after remove = %d %v, want 0 files", afterRemRes.StatusCode, afterRemOut)
	}
	unlinkRes, _ := doJSON(t, e.srv, "DELETE", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+driveFileID, e.ownerTk, nil)
	if unlinkRes.StatusCode != http.StatusOK {
		t.Fatalf("owner UnlinkDriveFile = %d, want 200", unlinkRes.StatusCode)
	}
	getAfterUnlink, _ := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+driveFileID, e.ownerTk, nil)
	if getAfterUnlink.StatusCode != http.StatusNotFound {
		t.Fatalf("GetDriveFile after unlink = %d, want 404", getAfterUnlink.StatusCode)
	}
}

// TestCreateTaskWithDriveFilesAtomicRollbackAndErrorFields verifies W4 gaps §1
// over HTTP: when POST /api/v1/workspaces/{workspaceID}/tasks includes
// drive_files[] and one entry fails on Google Drive, the whole task create rolls
// back and the error response carries fields.drive_files_index and
// fields.external_file_id.
func TestCreateTaskWithDriveFilesAtomicRollbackAndErrorFields(t *testing.T) {
	e := newDriveHTTPTestEnv(t)
	ownerConn := e.seedConnection(t, e.ownerID, "sub-owner-create", "owner-create@example.com")

	e.mu.Lock()
	e.googleError["ext-fail-second"] = http.StatusNotFound
	e.mu.Unlock()

	res, out := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/tasks", e.ownerTk, map[string]any{
		"title": "Atomic rollback task",
		"drive_files": []map[string]any{
			{"connection_id": ownerConn, "external_file_id": "ext-ok-first"},
			{"connection_id": ownerConn, "external_file_id": "ext-fail-second"},
		},
	})
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("create task with failing drive_file = %d %v, want 404", res.StatusCode, out)
	}
	if errorCode(out) != "drive_file_not_accessible" {
		t.Fatalf("error code = %q, want drive_file_not_accessible: %v", errorCode(out), out)
	}
	errObj, _ := out["error"].(map[string]any)
	fields, _ := errObj["fields"].(map[string]any)
	if fields["drive_files_index"] != float64(1) || fields["external_file_id"] != "ext-fail-second" {
		t.Fatalf("error fields = %+v, want drive_files_index=1 external_file_id=ext-fail-second", fields)
	}

	// Verify neither the task nor the first drive_file was committed.
	listRes, listOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files", e.ownerTk, nil)
	if listRes.StatusCode != http.StatusOK || len(jsonArrayAt(t, listOut, "files")) != 0 {
		t.Fatalf("drive_files after rollback = %d %v, want 0 files", listRes.StatusCode, listOut)
	}
}

// TestDriveResourceHistoryGate enforces spec §7.6a and §11 on
// GET /api/v1/workspaces/{workspaceID}/resources/{resourceType}/{resourceID}/history:
//   - drive_file: visible to a member who can Get the file (404 to another
//     member with neither drive_file_access nor a visible linked task)
//   - drive_connection: visible only to the connection owner (200 to owner;
//     indistinguishable 404 to another workspace member and for an unknown or
//     foreign connection ID)
//   - drive_task_proposal: visible only to requested_by (404 to other members)
//   - Every denied Drive history request returns 404 BEFORE executing the
//     ListResourceAuditEvents SELECT query, while authorized requests execute it.
func TestDriveResourceHistoryGate(t *testing.T) {
	e := newDriveHTTPTestEnv(t)
	ownerConn := e.seedConnection(t, e.ownerID, "sub-owner-hist", "owner-hist@example.com")

	linkRes, linkOut := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-files", e.ownerTk, map[string]any{
		"connection_id":     ownerConn,
		"external_file_ids": []string{"ext-hist-1"},
	})
	if linkRes.StatusCode != http.StatusOK {
		t.Fatalf("LinkDriveFiles = %d %v", linkRes.StatusCode, linkOut)
	}
	driveFileID := jsonArrayAt(t, linkOut, "results")[0].(map[string]any)["file"].(map[string]any)["id"].(string)

	// 1. drive_file history: owner gets 200 with at least the drive_file.linked event
	// (and runs ListResourceAuditEvents); peer (who has no drive_file_access and no task
	// link) gets 404 without running ListResourceAuditEvents.
	fileHistPath := "/api/v1/workspaces/" + e.wsID + "/resources/drive_file/" + driveFileID + "/history"
	beforeSelects := e.auditCounter.resourceSelects.Load()
	ownerHistRes, ownerHistOut := doJSON(t, e.srv, "GET", fileHistPath, e.ownerTk, nil)
	if ownerHistRes.StatusCode != http.StatusOK || len(jsonArrayAt(t, ownerHistOut, "events")) == 0 {
		t.Fatalf("owner drive_file history = %d %v, want 200 with events", ownerHistRes.StatusCode, ownerHistOut)
	}
	if got := e.auditCounter.resourceSelects.Load(); got != beforeSelects+1 {
		t.Fatalf("owner drive_file history resourceSelects = %d, want %d", got, beforeSelects+1)
	}

	beforeSelects = e.auditCounter.resourceSelects.Load()
	peerHistRes, _ := doJSON(t, e.srv, "GET", fileHistPath, e.peerTk, nil)
	if peerHistRes.StatusCode != http.StatusNotFound {
		t.Fatalf("peer drive_file history without visibility = %d, want 404", peerHistRes.StatusCode)
	}
	if got := e.auditCounter.resourceSelects.Load(); got != beforeSelects {
		t.Fatalf("denied peer drive_file history executed ListResourceAuditEvents (%d -> %d)", beforeSelects, got)
	}

	// 2. drive_connection history (spec §7.6a, plan B4): seed a connection audit event;
	// owner gets 200 with the event (and runs ListResourceAuditEvents), while another
	// member and an unknown/foreign connection get identical 404s without running the
	// resource audit SELECT.
	_, err := e.pool.Exec(context.Background(), `INSERT INTO audit_events
		(id, organization_id, workspace_id, actor_id, actor_kind, action, resource_type, resource_id, correlation_id, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, 'drive_connection', $7, $8, '{}')`,
		util.NewID(), e.orgID, e.wsID, e.ownerID, string(audit.KindHuman), "drive_connection.connected", ownerConn, util.NewID())
	if err != nil {
		t.Fatalf("seed connection audit event: %v", err)
	}
	connHistPath := "/api/v1/workspaces/" + e.wsID + "/resources/drive_connection/" + ownerConn + "/history"
	beforeSelects = e.auditCounter.resourceSelects.Load()
	connOwnerRes, connOwnerOut := doJSON(t, e.srv, "GET", connHistPath, e.ownerTk, nil)
	if connOwnerRes.StatusCode != http.StatusOK || len(jsonArrayAt(t, connOwnerOut, "events")) == 0 {
		t.Fatalf("owner drive_connection history = %d %v, want 200 with events", connOwnerRes.StatusCode, connOwnerOut)
	}
	if got := e.auditCounter.resourceSelects.Load(); got != beforeSelects+1 {
		t.Fatalf("owner drive_connection history resourceSelects = %d, want %d", got, beforeSelects+1)
	}

	beforeSelects = e.auditCounter.resourceSelects.Load()
	connPeerRes, connPeerOut := doJSON(t, e.srv, "GET", connHistPath, e.peerTk, nil)
	if connPeerRes.StatusCode != http.StatusNotFound {
		t.Fatalf("peer drive_connection history = %d, want 404", connPeerRes.StatusCode)
	}
	if got := e.auditCounter.resourceSelects.Load(); got != beforeSelects {
		t.Fatalf("denied peer drive_connection history executed ListResourceAuditEvents (%d -> %d)", beforeSelects, got)
	}

	unknownConnHistPath := "/api/v1/workspaces/" + e.wsID + "/resources/drive_connection/" + util.NewID() + "/history"
	beforeSelects = e.auditCounter.resourceSelects.Load()
	connUnknownRes, connUnknownOut := doJSON(t, e.srv, "GET", unknownConnHistPath, e.peerTk, nil)
	if connUnknownRes.StatusCode != http.StatusNotFound || errorCode(connPeerOut) != errorCode(connUnknownOut) {
		t.Fatalf("unknown drive_connection history = %d %v vs peer %d %v, want identical 404", connUnknownRes.StatusCode, connUnknownOut, connPeerRes.StatusCode, connPeerOut)
	}
	if got := e.auditCounter.resourceSelects.Load(); got != beforeSelects {
		t.Fatalf("denied unknown drive_connection history executed ListResourceAuditEvents (%d -> %d)", beforeSelects, got)
	}

	// 3. drive_task_proposal history: seed an audit event for a proposal requested by owner
	// and verify owner gets 200 while peer gets 404 (or 404 before authorizer is wired),
	// and denied requests never run ListResourceAuditEvents.
	proposalID := util.NewID()
	_, err = e.pool.Exec(context.Background(), `INSERT INTO audit_events
		(id, organization_id, workspace_id, actor_id, actor_kind, action, resource_type, resource_id, correlation_id, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, 'drive_task_proposal', $7, $8, '{}')`,
		util.NewID(), e.orgID, e.wsID, e.ownerID, string(audit.KindHuman), "drive_task_proposal.created", proposalID, util.NewID())
	if err != nil {
		t.Fatalf("seed proposal audit event: %v", err)
	}
	propHistPath := "/api/v1/workspaces/" + e.wsID + "/resources/drive_task_proposal/" + proposalID + "/history"
	beforeSelects = e.auditCounter.resourceSelects.Load()
	propPeerRes, _ := doJSON(t, e.srv, "GET", propHistPath, e.peerTk, nil)
	if propPeerRes.StatusCode != http.StatusNotFound {
		t.Fatalf("peer drive_task_proposal history = %d, want 404", propPeerRes.StatusCode)
	}
	if got := e.auditCounter.resourceSelects.Load(); got != beforeSelects {
		t.Fatalf("denied peer drive_task_proposal history executed ListResourceAuditEvents (%d -> %d)", beforeSelects, got)
	}

	beforeSelects = e.auditCounter.resourceSelects.Load()
	propOwnerNoRowRes, _ := doJSON(t, e.srv, "GET", propHistPath, e.ownerTk, nil)
	if propOwnerNoRowRes.StatusCode != http.StatusNotFound {
		t.Fatalf("owner drive_task_proposal history before proposal authorizer wired = %d, want 404", propOwnerNoRowRes.StatusCode)
	}
	if got := e.auditCounter.resourceSelects.Load(); got != beforeSelects {
		t.Fatalf("denied unwired drive_task_proposal history executed ListResourceAuditEvents (%d -> %d)", beforeSelects, got)
	}

	e.deps.Audit.SetDriveProposalHistoryAuthorizer(func(_ context.Context, uID, wsID, pID string) error {
		if wsID == e.wsID && pID == proposalID && uID == e.ownerID {
			return nil
		}
		return service.ErrNotFound
	})
	beforeSelects = e.auditCounter.resourceSelects.Load()
	propOwnerRes, propOwnerOut := doJSON(t, e.srv, "GET", propHistPath, e.ownerTk, nil)
	if propOwnerRes.StatusCode != http.StatusOK || len(jsonArrayAt(t, propOwnerOut, "events")) == 0 {
		t.Fatalf("owner drive_task_proposal history with authorizer = %d %v, want 200 with events", propOwnerRes.StatusCode, propOwnerOut)
	}
	if got := e.auditCounter.resourceSelects.Load(); got != beforeSelects+1 {
		t.Fatalf("owner drive_task_proposal history resourceSelects = %d, want %d", got, beforeSelects+1)
	}

	beforeSelects = e.auditCounter.resourceSelects.Load()
	propPeerAfterRes, _ := doJSON(t, e.srv, "GET", propHistPath, e.peerTk, nil)
	if propPeerAfterRes.StatusCode != http.StatusNotFound {
		t.Fatalf("peer drive_task_proposal history with authorizer = %d, want 404", propPeerAfterRes.StatusCode)
	}
	if got := e.auditCounter.resourceSelects.Load(); got != beforeSelects {
		t.Fatalf("denied peer drive_task_proposal history with authorizer executed ListResourceAuditEvents (%d -> %d)", beforeSelects, got)
	}
}

// TestParseListDriveFilesLimitClampsBeforeInt32Narrowing (B4b-F06) verifies
// without a database that positive limit values exceeding 100 (including values
// like 2147483648 that overflow a signed 32-bit int) are clamped to 100 before
// narrowing to int32 instead of overflowing negative and falling back to 50.
func TestParseListDriveFilesLimitClampsBeforeInt32Narrowing(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		raw  string
		want int32
		ok   bool
	}{
		{raw: "", want: 0, ok: true},
		{raw: "25", want: 25, ok: true},
		{raw: "100", want: 100, ok: true},
		{raw: "101", want: 100, ok: true},
		{raw: "2147483648", want: 100, ok: true},
		{raw: "0", want: 0, ok: false},
		{raw: "-5", want: 0, ok: false},
		{raw: "abc", want: 0, ok: false},
	} {
		got, ok := parseListDriveFilesLimit(tc.raw)
		if ok != tc.ok || got != tc.want {
			t.Fatalf("parseListDriveFilesLimit(%q) = (%d, %v), want (%d, %v)", tc.raw, got, ok, tc.want, tc.ok)
		}
	}
}

// TestDriveFolderHTTPFlow (UNI-2221) exercises the HTTP wire contract for:
//   - GET /api/v1/workspaces/{workspaceID}/drive-files and GET .../drive-files/{driveFileID}
//     returning drive_folder: null | {id, name: null} | {id, name}
//   - POST /api/v1/workspaces/{workspaceID}/drive-folders/{driveFolderID}/name
//     updating files in the workspace and refusing 403/404 from Google
//   - GET /api/v1/workspaces/{workspaceID}/drive-folders returning ordered
//     folder aggregates and file counts matching total_count.
func TestDriveFolderHTTPFlow(t *testing.T) {
	e := newDriveHTTPTestEnv(t)
	ownerConn := e.seedConnection(t, e.ownerID, "sub-owner-fldr-http", "owner-fldr-http@example.com")
	peerConn := e.seedConnection(t, e.peerID, "sub-peer-fldr-http", "peer-fldr-http@example.com")

	e.mu.Lock()
	e.googleParents["ext-http-fldr-1"] = []string{"fld-http-1"}
	e.googleParents["ext-http-fldr-2"] = []string{"fld-http-1"}
	e.googleError["fld-http-1"] = http.StatusNotFound
	e.mu.Unlock()

	// Link 1 root file (no parent) and 2 files in fld-http-1 (whose folder name initially 404s).
	linkRes, linkOut := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-files", e.ownerTk, map[string]any{
		"connection_id":     ownerConn,
		"external_file_ids": []string{"ext-http-root", "ext-http-fldr-1", "ext-http-fldr-2"},
	})
	if linkRes.StatusCode != http.StatusOK {
		t.Fatalf("LinkDriveFiles = %d %v", linkRes.StatusCode, linkOut)
	}

	listRes, listOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files", e.ownerTk, nil)
	if listRes.StatusCode != http.StatusOK {
		t.Fatalf("ListDriveFiles = %d %v", listRes.StatusCode, listOut)
	}
	files := jsonArrayAt(t, listOut, "files")
	if len(files) != 3 {
		t.Fatalf("len(files) = %d, want 3", len(files))
	}
	fileIDByExt := make(map[string]string, 3)
	for _, raw := range files {
		fobj := raw.(map[string]any)
		extID := fobj["external_file_id"].(string)
		fileIDByExt[extID] = fobj["id"].(string)
		dfVal, hasDF := fobj["drive_folder"]
		if !hasDF {
			t.Fatalf("list file %s missing drive_folder key: %+v", extID, fobj)
		}
		if extID == "ext-http-root" {
			if dfVal != nil {
				t.Fatalf("list ext-http-root drive_folder = %+v, want nil", dfVal)
			}
		} else {
			dfMap, ok := dfVal.(map[string]any)
			if !ok || dfMap["id"] != "fld-http-1" || dfMap["name"] != nil {
				t.Fatalf("list %s drive_folder before naming = %+v, want {id:fld-http-1, name:nil}", extID, dfVal)
			}
		}
	}

	// Check GET /drive-files/{driveFileID} detail before naming for null and unnamed drive_folder.
	rootDetailRes, rootDetailOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+fileIDByExt["ext-http-root"], e.ownerTk, nil)
	if rootDetailRes.StatusCode != http.StatusOK {
		t.Fatalf("GetDriveFile root = %d %v", rootDetailRes.StatusCode, rootDetailOut)
	}
	rootFileObj := rootDetailOut["file"].(map[string]any)
	if dfVal, hasDF := rootFileObj["drive_folder"]; !hasDF || dfVal != nil {
		t.Fatalf("detail ext-http-root drive_folder = (%v, exists=%v), want (nil, true)", dfVal, hasDF)
	}
	unnamedDetailRes, unnamedDetailOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+fileIDByExt["ext-http-fldr-1"], e.ownerTk, nil)
	if unnamedDetailRes.StatusCode != http.StatusOK {
		t.Fatalf("GetDriveFile unnamed = %d %v", unnamedDetailRes.StatusCode, unnamedDetailOut)
	}
	unnamedFileObj := unnamedDetailOut["file"].(map[string]any)
	unnamedDF, ok := unnamedFileObj["drive_folder"].(map[string]any)
	if !ok || unnamedDF["id"] != "fld-http-1" || unnamedDF["name"] != nil {
		t.Fatalf("detail ext-http-fldr-1 drive_folder before naming = %+v, want {id:fld-http-1, name:nil}", unnamedFileObj["drive_folder"])
	}

	// Check aggregate GET /drive-folders before naming: unnamed folder first, null id last.
	foldersRes, foldersOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-folders", e.ownerTk, nil)
	if foldersRes.StatusCode != http.StatusOK {
		t.Fatalf("ListDriveFolders = %d %v", foldersRes.StatusCode, foldersOut)
	}
	folderGroups := jsonArrayAt(t, foldersOut, "folders")
	if len(folderGroups) != 2 {
		t.Fatalf("len(folders) = %d, want 2: %v", len(folderGroups), foldersOut)
	}
	g0 := folderGroups[0].(map[string]any)
	g1 := folderGroups[1].(map[string]any)
	if g0["id"] != "fld-http-1" || g0["name"] != nil || g0["file_count"] != float64(2) {
		t.Fatalf("folders[0] before naming = %+v, want {id:fld-http-1, name:nil, file_count:2}", g0)
	}
	if g1["id"] != nil || g1["name"] != nil || g1["file_count"] != float64(1) {
		t.Fatalf("folders[1] before naming = %+v, want {id:nil, name:nil, file_count:1}", g1)
	}

	// Naming while Google returns 404 -> 404 drive_folder_not_found.
	name404Res, name404Out := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-folders/fld-http-1/name", e.ownerTk, map[string]any{
		"drive_connection_id": ownerConn,
	})
	if name404Res.StatusCode != http.StatusNotFound || errorCode(name404Out) != "drive_folder_not_found" {
		t.Fatalf("NameDriveFolder on 404 = %d %v, want 404 drive_folder_not_found", name404Res.StatusCode, name404Out)
	}

	// Naming while Google returns 403 -> 404 drive_folder_not_found.
	e.mu.Lock()
	e.googleError["fld-http-1"] = http.StatusForbidden
	e.mu.Unlock()
	name403Res, name403Out := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-folders/fld-http-1/name", e.ownerTk, map[string]any{
		"drive_connection_id": ownerConn,
	})
	if name403Res.StatusCode != http.StatusNotFound || errorCode(name403Out) != "drive_folder_not_found" {
		t.Fatalf("NameDriveFolder on 403 = %d %v, want 404 drive_folder_not_found", name403Res.StatusCode, name403Out)
	}

	// Naming when target ID is a non-folder document -> 422 drive_folder_not_folder.
	name422Res, name422Out := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-folders/ext-http-root/name", e.ownerTk, map[string]any{
		"drive_connection_id": ownerConn,
	})
	if name422Res.StatusCode != http.StatusUnprocessableEntity || errorCode(name422Out) != "drive_folder_not_folder" {
		t.Fatalf("NameDriveFolder on non-folder = %d %v, want 422 drive_folder_not_folder", name422Res.StatusCode, name422Out)
	}

	// Naming with peer's connection -> 404 not_found.
	namePeerConnRes, _ := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-folders/fld-http-1/name", e.ownerTk, map[string]any{
		"drive_connection_id": peerConn,
	})
	if namePeerConnRes.StatusCode != http.StatusNotFound {
		t.Fatalf("NameDriveFolder with peer connection = %d, want 404", namePeerConnRes.StatusCode)
	}

	// Simulate user picking fld-http-1 in Picker -> Google returns 200 folder metadata.
	e.mu.Lock()
	delete(e.googleError, "fld-http-1")
	e.googleFolders["fld-http-1"] = "Thư mục Thiết kế"
	e.mu.Unlock()

	nameOKRes, nameOKOut := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-folders/fld-http-1/name", e.ownerTk, map[string]any{
		"drive_connection_id": ownerConn,
	})
	if nameOKRes.StatusCode != http.StatusOK {
		t.Fatalf("NameDriveFolder 200 = %d %v", nameOKRes.StatusCode, nameOKOut)
	}
	dfObj, _ := nameOKOut["drive_folder"].(map[string]any)
	if dfObj["id"] != "fld-http-1" || dfObj["name"] != "Thư mục Thiết kế" || nameOKOut["updated_count"] != float64(2) {
		t.Fatalf("NameDriveFolder response = %+v, want id=fld-http-1 name=Thư mục Thiết kế updated_count=2", nameOKOut)
	}
	if _, hasOldKey := nameOKOut["updated_files"]; hasOldKey {
		t.Fatalf("NameDriveFolder response must not contain updated_files: %+v", nameOKOut)
	}

	// Check list AND get after naming for named drive_folder.
	listAfterRes, listAfterOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files", e.ownerTk, nil)
	if listAfterRes.StatusCode != http.StatusOK {
		t.Fatalf("ListDriveFiles after naming = %d %v", listAfterRes.StatusCode, listAfterOut)
	}
	for _, raw := range jsonArrayAt(t, listAfterOut, "files") {
		fobj := raw.(map[string]any)
		extID := fobj["external_file_id"].(string)
		if extID == "ext-http-root" {
			if fobj["drive_folder"] != nil {
				t.Fatalf("list after naming ext-http-root drive_folder = %+v, want nil", fobj["drive_folder"])
			}
			continue
		}
		dfMap, ok := fobj["drive_folder"].(map[string]any)
		if !ok || dfMap["id"] != "fld-http-1" || dfMap["name"] != "Thư mục Thiết kế" {
			t.Fatalf("list after naming %s drive_folder = %+v, want {id:fld-http-1, name:Thư mục Thiết kế}", extID, fobj["drive_folder"])
		}
	}
	namedDetailRes, namedDetailOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files/"+fileIDByExt["ext-http-fldr-1"], e.ownerTk, nil)
	if namedDetailRes.StatusCode != http.StatusOK {
		t.Fatalf("GetDriveFile named = %d %v", namedDetailRes.StatusCode, namedDetailOut)
	}
	namedFileObj := namedDetailOut["file"].(map[string]any)
	namedDF, ok := namedFileObj["drive_folder"].(map[string]any)
	if !ok || namedDF["id"] != "fld-http-1" || namedDF["name"] != "Thư mục Thiết kế" {
		t.Fatalf("detail ext-http-fldr-1 drive_folder after naming = %+v, want {id:fld-http-1, name:Thư mục Thiết kế}", namedFileObj["drive_folder"])
	}
	// Check aggregate GET /drive-folders after naming and with drive_connection_id filter.
	foldersAfterRes, foldersAfterOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-folders?drive_connection_id="+ownerConn, e.ownerTk, nil)
	if foldersAfterRes.StatusCode != http.StatusOK {
		t.Fatalf("ListDriveFolders after naming = %d %v", foldersAfterRes.StatusCode, foldersAfterOut)
	}
	afterGroups := jsonArrayAt(t, foldersAfterOut, "folders")
	if len(afterGroups) != 2 {
		t.Fatalf("len(folders) after naming = %d, want 2", len(afterGroups))
	}
	ag0 := afterGroups[0].(map[string]any)
	if ag0["id"] != "fld-http-1" || ag0["name"] != "Thư mục Thiết kế" || ag0["file_count"] != float64(2) {
		t.Fatalf("folders[0] after naming = %+v, want name=Thư mục Thiết kế", ag0)
	}

	// Foreign connection_id query on GET /drive-folders -> 404.
	badFilterRes, _ := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-folders?drive_connection_id="+peerConn, e.ownerTk, nil)
	if badFilterRes.StatusCode != http.StatusNotFound {
		t.Fatalf("ListDriveFolders with peer drive_connection_id = %d, want 404", badFilterRes.StatusCode)
	}

	// UNI-2221 part C: drive_folder_id filter and top-level drive_folder_id echo on GET /drive-files.
	// 1. Unfiltered list response echoes top-level "drive_folder_id": null.
	if dfIDVal, hasDFID := listAfterOut["drive_folder_id"]; !hasDFID || dfIDVal != nil {
		t.Fatalf("unfiltered ListDriveFiles drive_folder_id = (%v, exists=%v), want (nil, true)", dfIDVal, hasDFID)
	}

	// 2. ?drive_folder_id=fld-http-1 returns only the 2 files in fld-http-1, total_count=2, drive_folder_id="fld-http-1".
	fltFolderRes, fltFolderOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files?drive_folder_id=fld-http-1", e.ownerTk, nil)
	if fltFolderRes.StatusCode != http.StatusOK {
		t.Fatalf("ListDriveFiles ?drive_folder_id=fld-http-1 = %d %v", fltFolderRes.StatusCode, fltFolderOut)
	}
	if fltFolderOut["drive_folder_id"] != "fld-http-1" || fltFolderOut["total_count"] != float64(2) {
		t.Fatalf("ListDriveFiles ?drive_folder_id=fld-http-1 = %+v, want drive_folder_id=fld-http-1 total_count=2", fltFolderOut)
	}
	fltFolderFiles := jsonArrayAt(t, fltFolderOut, "files")
	if len(fltFolderFiles) != 2 {
		t.Fatalf("len(files) for fld-http-1 = %d, want 2", len(fltFolderFiles))
	}
	for _, raw := range fltFolderFiles {
		fobj := raw.(map[string]any)
		dfMap, ok := fobj["drive_folder"].(map[string]any)
		if !ok || dfMap["id"] != "fld-http-1" {
			t.Fatalf("filtered file drive_folder = %+v, want id=fld-http-1", fobj["drive_folder"])
		}
	}

	// 3. ?drive_folder_id=none returns only the 1 parentless file, total_count=1, drive_folder_id="none".
	fltNoneRes, fltNoneOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files?drive_folder_id=none", e.ownerTk, nil)
	if fltNoneRes.StatusCode != http.StatusOK {
		t.Fatalf("ListDriveFiles ?drive_folder_id=none = %d %v", fltNoneRes.StatusCode, fltNoneOut)
	}
	if fltNoneOut["drive_folder_id"] != "none" || fltNoneOut["total_count"] != float64(1) {
		t.Fatalf("ListDriveFiles ?drive_folder_id=none = %+v, want drive_folder_id=none total_count=1", fltNoneOut)
	}
	fltNoneFiles := jsonArrayAt(t, fltNoneOut, "files")
	if len(fltNoneFiles) != 1 || fltNoneFiles[0].(map[string]any)["external_file_id"] != "ext-http-root" {
		t.Fatalf("files for drive_folder_id=none = %+v, want [ext-http-root]", fltNoneFiles)
	}

	// 4. Unknown well-shaped folder ID -> 200 empty page, drive_folder_id echoed, never 404.
	fltUnknownRes, fltUnknownOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files?drive_folder_id=fld-unknown-00", e.ownerTk, nil)
	if fltUnknownRes.StatusCode != http.StatusOK {
		t.Fatalf("ListDriveFiles unknown folder ID = %d %v, want 200", fltUnknownRes.StatusCode, fltUnknownOut)
	}
	if fltUnknownOut["drive_folder_id"] != "fld-unknown-00" || fltUnknownOut["total_count"] != float64(0) || len(jsonArrayAt(t, fltUnknownOut, "files")) != 0 {
		t.Fatalf("ListDriveFiles unknown folder ID = %+v, want empty page with echoed drive_folder_id", fltUnknownOut)
	}

	// 5. Invalid drive_folder_id values ("x", "none2", "a/b") -> 400 invalid_request envelope.
	for _, bad := range []string{"x", "none2", "a%2Fb"} {
		badRes, badOut := doJSON(t, e.srv, "GET", "/api/v1/workspaces/"+e.wsID+"/drive-files?drive_folder_id="+bad, e.ownerTk, nil)
		if badRes.StatusCode != http.StatusBadRequest || errorCode(badOut) != "invalid_request" {
			t.Fatalf("ListDriveFiles ?drive_folder_id=%s = %d %v, want 400 invalid_request", bad, badRes.StatusCode, badOut)
		}
	}
}
