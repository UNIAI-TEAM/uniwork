package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// editLockWorld is the documents handler stack with a second workspace member
// at edit (the other editor) and an outsider. The member is inserted by SQL:
// the invite flow is not what these tests are about.
type editLockWorld struct {
	*docsWorld
	pool        *pgxpool.Pool
	editor      string
	editorToken string
}

func newEditLockWorld(t *testing.T) *editLockWorld {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	docs.SetFiles(filesfake.New(filesfake.Options{}))
	d.Documents = docs
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "documents", ScopeType: featureflags.ScopeGlobal,
		Enabled: true, Note: "edit lock handler tests", CreatedBy: "test",
	}); err != nil {
		t.Fatalf("enable documents flag: %v", err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
	w := &editLockWorld{docsWorld: &docsWorld{srv: srv}, pool: pool}
	w.token, w.userID = filesRegister(t, srv, "lock-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "Lock Org", "slug": "lock-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/workspaces", w.token, map[string]string{"name": "Lock WS", "slug": "lock-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	w.wsID = out["workspace"].(map[string]any)["id"].(string)
	w.editorToken, w.editor = filesRegister(t, srv, "lock-editor@example.com")
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`, w.orgID, w.editor); err != nil {
		t.Fatalf("org member: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO workspace_members (workspace_id, organization_id, user_id, role) VALUES ($1, $2, $3, 'member')`, w.wsID, w.orgID, w.editor); err != nil {
		t.Fatalf("workspace member: %v", err)
	}
	w.outsider, _ = filesRegister(t, srv, "lock-outsider@example.com")
	return w
}

func lockPath(id string, rest string) string { return "/api/v1/documents/" + id + "/edit-lock" + rest }

// shareEditToWorkspace raises the document's home row to workspace/edit: the
// pre-SH-S1 default these scenarios were written for, where every member
// held edit. Create only takes visibility (workspace opens at view, Q-S3);
// a share grant for the document's own workspace merges into the home row
// (SH-S1), and 403 on a member's write would never reach the lock gate the
// tests exist for. One successful share also bumps the revision by one.
func shareEditToWorkspace(t *testing.T, srv *httptest.Server, token, docID, wsID string) {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/documents/"+docID+"/shares", token, map[string]any{
		"principal_type": "workspace", "principal_id": wsID, "level": "edit",
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("share edit to workspace: %d %v", res.StatusCode, out)
	}
}

// createEditablePage is createPage for the lock tests: workspace-visible
// (SH-S1's 1cd4497d9 creates root documents restricted) and back at member
// edit through shareEditToWorkspace, so the other editor reaches the lock
// gate. The shared createPage stays as it is: the root tests call it as the
// owner and pass. The one share bump leaves the page at revision 2.
func createEditablePage(t *testing.T, w *editLockWorld, title string) string {
	t.Helper()
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, map[string]any{
		"title": title, "kind": "page", "visibility": "workspace",
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph"}}},
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create editable page: %d %v", res.StatusCode, out)
	}
	id := out["document"].(map[string]any)["id"].(string)
	shareEditToWorkspace(t, w.srv, w.token, id, w.wsID)
	return id
}

func (w *editLockWorld) acquire(t *testing.T, token, docID, editor string) map[string]any {
	t.Helper()
	res, out := doJSON(t, w.srv, "POST", lockPath(docID, ""), token, map[string]any{"editor_id": editor, "client": "web_page"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("acquire: %d %v", res.StatusCode, out)
	}
	return out
}

func pageContent(text string) map[string]any {
	return map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}}}}
}

// wantLocked checks the 423 body: who holds it, never the lock id, no
// error_class (document_locked is not a conflict).
func wantLocked(t *testing.T, what string, res *http.Response, out map[string]any, holder string, heldByMe bool) {
	t.Helper()
	code, class := errCodeClass(out)
	if res.StatusCode != http.StatusLocked || code != "document_locked" || class != "" {
		t.Fatalf("%s: %d code=%q class=%q, want 423 document_locked with no class (%v)", what, res.StatusCode, code, class, out)
	}
	fields, _ := out["error"].(map[string]any)["fields"].(map[string]any)
	for _, k := range []string{"holder_id", "holder_name", "since", "expires_at", "held_by_me", "current_revision"} {
		if _, ok := fields[k]; !ok {
			t.Errorf("%s: 423 fields miss %s: %v", what, k, fields)
		}
	}
	if fields["holder_id"] != holder || fields["held_by_me"] != heldByMe {
		t.Errorf("%s: holder %v held_by_me %v, want %s %v", what, fields["holder_id"], fields["held_by_me"], holder, heldByMe)
	}
	if _, ok := fields["current_revision"].(string); !ok {
		t.Errorf("%s: current_revision must be a string: %v", what, fields["current_revision"])
	}
	for _, k := range []string{"lock_id", "offline_hold_until"} {
		if _, ok := fields[k]; ok {
			t.Errorf("%s: 423 carries %s: %v", what, k, fields)
		}
	}
}

// TestEditLockWritesRefusedWith423Handler is EL-A01 at the HTTP layer: while
// the owner holds the page, the other editor's PATCH content and restore
// answer 423 with the documented body, before any revision check, and the
// holder's own PATCH with its edit_lock_id passes. A rename needs no lock.
// The two file-commit routes carry the same field into the same service gate
// and are covered by TestEditLockRefusesCommitRoutesHandler (CBE-1b-2).
func TestEditLockWritesRefusedWith423Handler(t *testing.T) {
	w := newEditLockWorld(t)
	id := createEditablePage(t, w, "Locked")
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions", w.token, map[string]any{"label": "v1"})
	if res.StatusCode != 201 {
		t.Fatalf("version: %d %v", res.StatusCode, out)
	}
	lock := w.acquire(t, w.token, id, util.NewID())
	lockID := lock["lock_id"].(string)

	// The other editor, right base and stale base alike: 423, never 422.
	for _, rev := range []string{"1", "0"} {
		res, out = doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+id, w.editorToken, map[string]any{"revision": rev, "content": pageContent("theirs")})
		wantLocked(t, "PATCH content base "+rev, res, out, w.userID, false)
	}
	// Naming the holder's lock id does not make the editor the holder.
	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+id, w.editorToken, map[string]any{"revision": "1", "content": pageContent("theirs"), "edit_lock_id": lockID})
	wantLocked(t, "PATCH content with the holder's id", res, out, w.userID, false)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/1/restore", w.editorToken, map[string]any{})
	wantLocked(t, "restore", res, out, w.userID, false)
	// The owner without its lock id (another tab): 423 held_by_me.
	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+id, w.token, map[string]any{"revision": "1", "content": pageContent("mine")})
	wantLocked(t, "owner without the lock id", res, out, w.userID, true)

	// A rename needs no lock (Q5); the fixture share bumped the revision to 2.
	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+id, w.editorToken, map[string]any{"revision": "2", "title": "Renamed"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("rename by the other editor: %d %v", res.StatusCode, out)
	}
	// The holder writes with its lock id; a stale base is then the usual 422.
	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+id, w.token, map[string]any{"revision": "3", "content": pageContent("mine"), "edit_lock_id": lockID})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("holder's write: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+id, w.token, map[string]any{"revision": "2", "content": pageContent("stale"), "edit_lock_id": lockID})
	if code, _ := errCodeClass(out); res.StatusCode != 422 || code != "revision_conflict" {
		t.Fatalf("holder's stale write: %d %v", res.StatusCode, out)
	}
}

// TestEditLockRefusesCommitRoutesHandler is r1b CBE-1b-2: the two file-commit
// routes carry edit_lock_id into the same service gate the PATCH and restore
// cases above cover. A non-holder is refused 423 whether the field arrives or
// not, so the holder's own commit with its edit_lock_id is the case that
// fails if a handler drops or mis-maps the field; both are driven over HTTP
// here. The office world supplies the DOCX and the frame token the frame
// route needs (office_frame.go:234).
func TestEditLockRefusesCommitRoutesHandler(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	editor, _ := w.officeJoinWorkspace(t, "lock-commit-editor@example.com")
	docID := w.createDocx(t, "locked.docx", frameDocx(t, "v1"))
	// createDocx opens the file workspace-visible but at view (Q-S3); the
	// member's staged upload is an edit, so the home row must carry edit.
	shareEditToWorkspace(t, w.srv, w.token, docID, w.wsID)

	// Every staged file differs from the current version: a commit whose
	// bytes match it is a 200 no-op (UNI-1900) and would not move the revision.
	staged := 0
	stage := func(t *testing.T, token string) string {
		t.Helper()
		staged++
		res, raw := doMultipart(t, w.srv, "POST", "/api/v1/documents/"+docID+"/uploads", token, nil,
			"locked.docx", frameDocx(t, fmt.Sprintf("staged-%d", staged)), nil)
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("stage upload: %d %s", res.StatusCode, raw)
		}
		var up struct {
			UploadID string `json:"upload_id"`
		}
		if err := json.Unmarshal(raw, &up); err != nil || up.UploadID == "" {
			t.Fatalf("upload sdo %s: %v", raw, err)
		}
		return up.UploadID
	}
	revision := func(t *testing.T) string {
		t.Helper()
		res, out := doJSON(t, w.srv, "GET", "/api/v1/documents/"+docID, w.token, nil)
		doc, _ := out["document"].(map[string]any)
		if res.StatusCode != http.StatusOK || doc == nil {
			t.Fatalf("read document: %d %v", res.StatusCode, out)
		}
		return doc["revision"].(string)
	}
	frameToken := func(t *testing.T, token string) string {
		t.Helper()
		res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/frame-token", token, nil)
		if res.StatusCode != http.StatusCreated || out["can_edit"] != true {
			t.Fatalf("frame token: %d %v", res.StatusCode, out)
		}
		return out["token"].(string)
	}

	// The owner holds the document while both routes are driven.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/edit-lock", w.token,
		map[string]any{"editor_id": "editor-holder", "client": "web_page"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("acquire: %d %v", res.StatusCode, out)
	}
	lockID := out["lock_id"].(string)

	// POST /documents/{id}/versions/commit: the other member is refused even
	// while naming the holder's tenure, and the revision does not move.
	base := revision(t)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/versions/commit", editor,
		map[string]any{"upload_id": stage(t, editor), "base_revision": base, "edit_lock_id": lockID})
	wantLocked(t, "commit by the other member", res, out, w.userID, false)
	if got := revision(t); got != base {
		t.Fatalf("a refused commit moved the revision %s -> %s", base, got)
	}
	// The holder's commit with its own edit_lock_id passes: the field hop.
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+docID+"/versions/commit", w.token,
		map[string]string{"Idempotency-Key": "lock-commit-holder"},
		map[string]any{"upload_id": stage(t, w.token), "base_revision": base, "edit_lock_id": lockID})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("holder commit: %d %v", res.StatusCode, out)
	}
	committed := revision(t)
	if committed == base {
		t.Fatalf("holder commit did not move the revision from %s", base)
	}

	// POST /api/v1/office-frame/documents/{id}/versions/commit: same pair;
	// the member's frame token carries its own user, never the holder's.
	memberFrame := frameToken(t, editor)
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/office-frame/documents/"+docID+"/versions/commit", memberFrame,
		map[string]string{"Idempotency-Key": "lock-frame-other"},
		map[string]any{"upload_id": stage(t, editor), "base_revision": committed, "edit_lock_id": lockID})
	wantLocked(t, "frame commit by the other member", res, out, w.userID, false)
	if got := revision(t); got != committed {
		t.Fatalf("a refused frame commit moved the revision %s -> %s", committed, got)
	}
	holderFrame := frameToken(t, w.token)
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/office-frame/documents/"+docID+"/versions/commit", holderFrame,
		map[string]string{"Idempotency-Key": "lock-frame-holder"},
		map[string]any{"upload_id": stage(t, w.token), "base_revision": committed, "edit_lock_id": lockID})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("holder frame commit: %d %v", res.StatusCode, out)
	}
	if got := revision(t); got == committed {
		t.Fatalf("holder frame commit did not move the revision from %s", committed)
	}
}

// TestEditLockRouteStatusesClientCancel (FA2 r1-500) is the wire-level pin:
// a browser leaving the page aborts R1's in-flight read, the service fails on
// the cancelled context before RequireMember stamps the tenant, and R1 must
// not answer that as an internal failure (the ERR 500 the cloud round caught,
// 6 ms after the same user's release). The access log follows the status, so
// a client-closed answer is a WRN 499 line and never an ERR line.
func TestEditLockRouteStatusesClientCancel(t *testing.T) {
	w := newEditLockWorld(t)
	_, id := createPage(t, w.docsWorld, "Cancelled", nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, lockPath(id, ""), nil)
	req.Header.Set("Authorization", "Bearer "+w.token)
	rec := httptest.NewRecorder()
	w.srv.Config.Handler.ServeHTTP(rec, req.WithContext(ctx))
	if rec.Code != statusClientClosedRequest {
		t.Fatalf("cancelled R1: status %d body %s, want %d client-closed (a 500 here is the r1-500 false internal error)",
			rec.Code, rec.Body.String(), statusClientClosedRequest)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("cancelled R1 body %q: %v", rec.Body.String(), err)
	}
	if code, class := errCodeClass(out); code != "client_closed_request" || class != "" {
		t.Fatalf("cancelled R1: code %q class %q, want client_closed_request with no class", code, class)
	}
}

// TestEditLockRouteStatuses walks R1-R10 through HTTP: the documented
// statuses and codes, the holder-only lock id, malformed bodies, and an
// outsider who learns nothing.
func TestEditLockRouteStatuses(t *testing.T) {
	w := newEditLockWorld(t)
	id := createEditablePage(t, w, "Statuses")
	editorID := util.NewID()

	// R1 with no lock.
	res, out := doJSON(t, w.srv, "GET", lockPath(id, ""), w.editorToken, nil)
	if res.StatusCode != 200 || out["lock"] != nil || out["can_request"] != false || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("R1 free: %d %v cache=%q", res.StatusCode, out, res.Header.Get("Cache-Control"))
	}
	// R2: malformed bodies are 400, an unknown client too.
	for _, body := range []any{"not an object", map[string]any{"editor_id": editorID, "client": "fax"}, map[string]any{"editor_id": "", "client": "web_page"}} {
		res, out = doJSON(t, w.srv, "POST", lockPath(id, ""), w.token, body)
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("R2 malformed %v: %d %v", body, res.StatusCode, out)
		}
	}
	// R2 201 then 200 for the same editor.
	lock := w.acquire(t, w.token, id, editorID)
	lockID := lock["lock_id"].(string)
	if lock["holder_id"] != w.userID || lock["granted_via"] != "acquire" || lock["heartbeat_interval_ms"].(float64) != 30000 || lock["ttl_ms"].(float64) != 120000 {
		t.Fatalf("R2 body: %v", lock)
	}
	res, out = doJSON(t, w.srv, "POST", lockPath(id, ""), w.token, map[string]any{"editor_id": editorID, "client": "web_page"})
	if res.StatusCode != http.StatusOK || out["lock_id"] != lockID {
		t.Fatalf("R2 idempotent: %d %v", res.StatusCode, out)
	}
	// R2 by the other editor (even with the holder's editor id): 423.
	res, out = doJSON(t, w.srv, "POST", lockPath(id, ""), w.editorToken, map[string]any{"editor_id": editorID, "client": "web_page"})
	wantLocked(t, "R2 other user", res, out, w.userID, false)

	// R1 as the other editor: a summary without the lock id (not manage).
	res, out = doJSON(t, w.srv, "GET", lockPath(id, ""), w.editorToken, nil)
	sum, _ := out["lock"].(map[string]any)
	if res.StatusCode != 200 || sum == nil || sum["holder_id"] != w.userID || out["can_request"] != true || out["can_take_over"] != false {
		t.Fatalf("R1 locked: %d %v", res.StatusCode, out)
	}
	if _, ok := sum["lock_id"]; ok {
		t.Fatalf("R1 shows the lock id to a non-manager: %v", sum)
	}
	// The outsider: 404 on every route, nothing of the document.
	for _, c := range []struct{ method, path string }{
		{"GET", lockPath(id, "")}, {"POST", lockPath(id, "/"+lockID+"/heartbeat")}, {"DELETE", lockPath(id, "/"+lockID)},
		{"POST", "/api/v1/documents/" + id + "/edit-requests"},
	} {
		res, out = doJSON(t, w.srv, c.method, c.path, w.outsider, map[string]any{})
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("outsider %s %s: %d %v", c.method, c.path, res.StatusCode, out)
		}
	}
	// Unauthenticated: 401.
	if res, _ = doJSON(t, w.srv, "GET", lockPath(id, ""), "", nil); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous R1: %d", res.StatusCode)
	}

	// R3 by the holder 200; by the other editor 409 edit_lock_lost; an id
	// that is no tenure of this document 404.
	res, out = doJSON(t, w.srv, "POST", lockPath(id, "/"+lockID+"/heartbeat"), w.token, nil)
	if res.StatusCode != 200 || out["lock_id"] != lockID {
		t.Fatalf("R3: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", lockPath(id, "/"+lockID+"/heartbeat"), w.editorToken, nil)
	if code, class := errCodeClass(out); res.StatusCode != 409 || code != "edit_lock_lost" || class != "" {
		t.Fatalf("R3 other user: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, w.srv, "POST", lockPath(id, "/"+util.NewID()+"/heartbeat"), w.token, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("R3 unknown id: %d", res.StatusCode)
	}
	// R6 from a web session: 403 edit_hold_device_required; R7 200.
	res, out = doJSON(t, w.srv, "PUT", lockPath(id, "/"+lockID+"/offline-hold"), w.token, map[string]any{})
	if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "edit_hold_device_required" {
		t.Fatalf("R6 web: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "DELETE", lockPath(id, "/"+lockID+"/offline-hold"), w.token, nil)
	if res.StatusCode != 200 || out["lock_id"] != lockID {
		t.Fatalf("R7: %d %v", res.StatusCode, out)
	}
	// R5: below manage 403; the owner on its own lock 409 held_by_me.
	takeOver := map[string]any{"editor_id": util.NewID(), "client": "web_page", "expected_lock_id": lockID}
	res, out = doJSON(t, w.srv, "POST", lockPath(id, "/take-over"), w.editorToken, takeOver)
	if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "forbidden" {
		t.Fatalf("R5 editor: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", lockPath(id, "/take-over"), w.token, takeOver)
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "edit_lock_held_by_me" {
		t.Fatalf("R5 own lock: %d %v", res.StatusCode, out)
	}

	// R8: malformed 400, then 201, then 200 (the open request); the holder 409.
	res, _ = doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/edit-requests", w.editorToken, "[]")
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("R8 malformed: %d", res.StatusCode)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/edit-requests", w.editorToken, map[string]any{})
	if res.StatusCode != http.StatusCreated || out["status"] != "pending" || out["holder_id"] != w.userID {
		t.Fatalf("R8: %d %v", res.StatusCode, out)
	}
	requestID := out["request_id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/edit-requests", w.editorToken, map[string]any{})
	if res.StatusCode != http.StatusOK || out["request_id"] != requestID {
		t.Fatalf("R8 again: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/edit-requests", w.token, map[string]any{})
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "edit_request_to_self" {
		t.Fatalf("R8 holder: %d %v", res.StatusCode, out)
	}
	// R1 as the holder lists the request.
	res, out = doJSON(t, w.srv, "GET", lockPath(id, ""), w.token, nil)
	if pending, _ := out["pending_requests"].([]any); res.StatusCode != 200 || len(pending) != 1 {
		t.Fatalf("R1 holder pending: %d %v", res.StatusCode, out)
	}
	// R9: the requester is not the holder 404; a wrong lock id 409
	// edit_lock_changed; decline 200.
	answer := "/api/v1/documents/" + id + "/edit-requests/" + requestID + "/answer"
	res, _ = doJSON(t, w.srv, "POST", answer, w.editorToken, map[string]any{"decision": "decline", "lock_id": lockID})
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("R9 by the requester: %d", res.StatusCode)
	}
	res, out = doJSON(t, w.srv, "POST", answer, w.token, map[string]any{"decision": "decline", "lock_id": util.NewID()})
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "edit_lock_changed" {
		t.Fatalf("R9 wrong lock: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", answer, w.token, map[string]any{"decision": "decline", "lock_id": lockID})
	if res.StatusCode != 200 || out["status"] != "declined" {
		t.Fatalf("R9 decline: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", answer, w.token, map[string]any{"decision": "decline", "lock_id": lockID})
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "edit_request_closed" {
		t.Fatalf("R9 twice: %d %v", res.StatusCode, out)
	}
	// R10: not the requester 404; the requester 204, idempotent.
	cancel := "/api/v1/documents/" + id + "/edit-requests/" + requestID
	if res, _ = doJSON(t, w.srv, "DELETE", cancel, w.token, nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("R10 by the holder: %d", res.StatusCode)
	}
	for i := 0; i < 2; i++ {
		if res, _ = doJSON(t, w.srv, "DELETE", cancel, w.editorToken, nil); res.StatusCode != http.StatusNoContent {
			t.Fatalf("R10 #%d: %d", i+1, res.StatusCode)
		}
	}
	// R4: the other editor 404; the holder 204, idempotent; then R3 is lost.
	if res, _ = doJSON(t, w.srv, "DELETE", lockPath(id, "/"+lockID), w.editorToken, nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("R4 other user: %d", res.StatusCode)
	}
	for i := 0; i < 2; i++ {
		if res, _ = doJSON(t, w.srv, "DELETE", lockPath(id, "/"+lockID), w.token, nil); res.StatusCode != http.StatusNoContent {
			t.Fatalf("R4 #%d: %d", i+1, res.StatusCode)
		}
	}
	res, out = doJSON(t, w.srv, "POST", lockPath(id, "/"+lockID+"/heartbeat"), w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "edit_lock_lost" {
		t.Fatalf("R3 after release: %d %v", res.StatusCode, out)
	}
	if reason := out["error"].(map[string]any)["fields"].(map[string]any)["reason"]; reason != "released" {
		t.Fatalf("lost reason = %v, want released", reason)
	}
	// R8 and R5 with no lock: 409 edit_lock_free.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/edit-requests", w.editorToken, map[string]any{})
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "edit_lock_free" {
		t.Fatalf("R8 free: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", lockPath(id, "/take-over"), w.token, takeOver)
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "edit_lock_free" {
		t.Fatalf("R5 free: %d %v", res.StatusCode, out)
	}
}
