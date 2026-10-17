package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// HTTP surface of the large upload flow (BIGUP-S1, addendum §6): the three
// create routes, GET, complete and DELETE on the session, the frame family,
// and the /api/v1/config field that tells a client when to use them. The world
// runs Documents on a real FileService over the multipart test store, because
// the local adapter alone cannot open a session and the fake cannot either.

// uploadSessionTestSize is one byte over the 20 MiB threshold: the smallest
// session the server accepts, so a test never moves 200 MiB to prove a shape.
const uploadSessionTestSize = 20<<20 + 1

type uploadSessionWorld struct {
	srv   *httptest.Server
	pool  *pgxpool.Pool
	q     *db.Queries
	deps  Deps
	store *multipartTestStore
	// plainStore is the local adapter alone: no multipart, no presign, the
	// store the config case wires a second Documents service over.
	plainStore    storage.ObjectStore
	token, userID string
	orgID, wsID   string
	// docID is a .md file document: the version route's target and the
	// document a Markdown frame token opens.
	docID, docRevision string
	outsiderToken      string
	outsiderID         string
}

func newUploadSessionWorld(t *testing.T) *uploadSessionWorld {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	d.Documents = docs
	stores, err := storage.BuildStores(context.Background(),
		storage.Config{Backend: storage.BackendLocal, Local: &storage.LocalConfig{Root: t.TempDir()}}, storage.NewDefaultRegistry())
	if err != nil {
		t.Fatal(err)
	}
	_, store := newMultipartDocuments(t, pool, q, docs, d.Chat, d.Meetings, stores[storage.BackendLocal])
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	w := &uploadSessionWorld{srv: srv, pool: pool, q: q, deps: d, store: store, plainStore: stores[storage.BackendLocal]}
	w.token, w.userID = filesRegister(t, srv, "upload-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "Upload Org", "slug": "upload-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/workspaces", w.token, map[string]string{"name": "Upload WS", "slug": "upload-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	w.wsID = out["workspace"].(map[string]any)["id"].(string)
	w.outsiderToken, w.outsiderID = filesRegister(t, srv, "upload-outsider@example.com")
	if err := q.AddOrganizationMember(context.Background(), db.AddOrganizationMemberParams{
		OrganizationID: w.orgID, UserID: w.outsiderID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	if err := q.AddWorkspaceMember(context.Background(), db.AddWorkspaceMemberParams{
		WorkspaceID: w.wsID, UserID: w.outsiderID, Role: "member", OrganizationID: w.orgID,
	}); err != nil {
		t.Fatal(err)
	}
	w.docID, w.docRevision = w.createMarkdownDocument(t, "note.md")
	return w
}

// createMarkdownDocument makes a .md file document through the public route.
func (w *uploadSessionWorld) createMarkdownDocument(t *testing.T, filename string) (string, string) {
	t.Helper()
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files", w.token,
		map[string]string{"visibility": "workspace"}, filename, []byte("# Ghi chu\n"), nil)
	if res.StatusCode != 201 {
		t.Fatalf("create file document: %d %s", res.StatusCode, raw)
	}
	return isoID(t, mustJSON(t, raw), "document"), isoString(t, mustJSON(t, raw), "document", "revision")
}

func mustJSON(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode %s: %v", isoClip(raw), err)
	}
	return out
}

// sessionHead is the probe head the service demands for uploadSessionTestSize:
// exactly the first 64 KiB of a text file.
func sessionHead() string {
	return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("a"), int(service.UploadSessionMaxProbeHeadBytes)))
}

// sessionOpenBody is a well-formed create body for a file of size bytes named
// filename; parentID may add the workspace route's parent.
func sessionOpenBody(filename string, size int64, parentID *string) map[string]any {
	body := map[string]any{
		"filename":   filename,
		"size_bytes": size,
		"probe": map[string]any{
			"head_b64":        sessionHead(),
			"central_dir_b64": "",
			"cd_offset":       0,
			"cd_size":         0,
		},
	}
	if parentID != nil {
		body["parent_id"] = *parentID
	}
	return body
}

// uploadSessionTestParts is the content of an uploadSessionTestSize markdown
// file split at the service's part size, and the object key the session's file
// row names.
func uploadSessionTestParts() [][]byte {
	part := int(service.UploadSessionPartSizeBytes)
	return [][]byte{
		bytes.Repeat([]byte("a"), part),
		bytes.Repeat([]byte("a"), part),
		bytes.Repeat([]byte("a"), int(uploadSessionTestSize)-2*part),
	}
}

// objectKeyOf reads the object key of the file a session uploads.
func (w *uploadSessionWorld) objectKeyOf(t *testing.T, sessionID string) string {
	t.Helper()
	var key string
	if err := w.pool.QueryRow(context.Background(),
		`SELECT f.object_key FROM file_multipart_uploads m JOIN files f ON f.id = m.file_id WHERE m.id = $1`,
		sessionID).Scan(&key); err != nil {
		t.Fatalf("object key of session %s: %v", sessionID, err)
	}
	return key
}

// seedParts PUTs every part of the test file to the session's upload and
// returns the complete body the client would send.
func (w *uploadSessionWorld) seedParts(t *testing.T, sessionID string) map[string]any {
	t.Helper()
	key := w.objectKeyOf(t, sessionID)
	uploadID, ok := w.store.openUploadForKey(key)
	if !ok {
		t.Fatalf("session %s has no open multipart upload for key %s", sessionID, key)
	}
	parts := []map[string]any{}
	for i, data := range uploadSessionTestParts() {
		number := int32(i + 1)
		etag := w.store.PutPart(t, key, uploadID, number, data)
		parts = append(parts, map[string]any{"part_number": number, "etag": etag})
	}
	return map[string]any{"parts": parts}
}

// openWorkspaceSession opens a session through the workspace route and returns
// its id and the response body.
func (w *uploadSessionWorld) openWorkspaceSession(t *testing.T) (string, map[string]any) {
	t.Helper()
	path := "/api/v1/workspaces/" + w.wsID + "/documents/upload-sessions"
	res, out := doJSONHeaders(t, w.srv, "POST", path, w.token,
		map[string]string{"Idempotency-Key": util.NewID()}, sessionOpenBody("big.md", uploadSessionTestSize, nil))
	if res.StatusCode != 201 {
		t.Fatalf("open workspace session: %d %v", res.StatusCode, out)
	}
	return out["session_id"].(string), out
}

func TestCreateUploadSessionRejectsTooSmall(t *testing.T) {
	w := newUploadSessionWorld(t)
	path := "/api/v1/workspaces/" + w.wsID + "/documents/upload-sessions"
	res, out := doJSONHeaders(t, w.srv, "POST", path, w.token,
		map[string]string{"Idempotency-Key": util.NewID()}, sessionOpenBody("small.md", 20<<20, nil))
	if code, _ := errCodeClass(out); res.StatusCode != 422 || code != "upload_session_too_small" {
		t.Fatalf("create at the threshold = %d %v", res.StatusCode, out)
	}
}

func TestCreateUploadSessionRejectsAboveCap(t *testing.T) {
	w := newUploadSessionWorld(t)
	cap := w.cfgDocumentMaxBytes(t)
	path := "/api/v1/workspaces/" + w.wsID + "/documents/upload-sessions"
	res, out := doJSONHeaders(t, w.srv, "POST", path, w.token,
		map[string]string{"Idempotency-Key": util.NewID()}, sessionOpenBody("huge.md", cap+1, nil))
	code, _ := errCodeClass(out)
	fields, _ := out["error"].(map[string]any)["fields"].(map[string]any)
	if res.StatusCode != 413 || code != "file_too_large" || fields["max_bytes"] != float64(cap) {
		t.Fatalf("create above cap = %d %v", res.StatusCode, out)
	}
}

func (w *uploadSessionWorld) cfgDocumentMaxBytes(t *testing.T) int64 {
	t.Helper()
	res, out := doJSON(t, w.srv, "GET", "/api/v1/config", "", nil)
	if res.StatusCode != 200 {
		t.Fatalf("config = %d %v", res.StatusCode, out)
	}
	limits, _ := out["documents"].(map[string]any)["limits"].(map[string]any)
	maxBytes, _ := limits["upload_max_bytes"].(float64)
	if maxBytes <= 0 {
		t.Fatalf("config has no upload_max_bytes: %v", out)
	}
	return int64(maxBytes)
}

func TestCreateUploadSessionRejectsUnknownExtension(t *testing.T) {
	w := newUploadSessionWorld(t)
	path := "/api/v1/workspaces/" + w.wsID + "/documents/upload-sessions"
	res, out := doJSONHeaders(t, w.srv, "POST", path, w.token,
		map[string]string{"Idempotency-Key": util.NewID()}, sessionOpenBody("payload.bin", uploadSessionTestSize, nil))
	if code, _ := errCodeClass(out); res.StatusCode != 415 || code != "unsupported_media_type" {
		t.Fatalf("create with a .bin = %d %v", res.StatusCode, out)
	}
}

// A probe whose head is not the declared size is refused before any part URL
// is signed, with the detector's reason on the fields.
func TestCreateUploadSessionRejectsBadProbe(t *testing.T) {
	w := newUploadSessionWorld(t)
	body := sessionOpenBody("big.md", uploadSessionTestSize, nil)
	body["probe"] = map[string]any{
		"head_b64": base64.StdEncoding.EncodeToString([]byte("too short")), "central_dir_b64": "", "cd_offset": 0, "cd_size": 0,
	}
	path := "/api/v1/workspaces/" + w.wsID + "/documents/upload-sessions"
	res, out := doJSONHeaders(t, w.srv, "POST", path, w.token, map[string]string{"Idempotency-Key": util.NewID()}, body)
	errObj, _ := out["error"].(map[string]any)
	fields, _ := errObj["fields"].(map[string]any)
	reason, _ := fields["reason"].(string)
	if code, _ := errCodeClass(out); res.StatusCode != 415 || code != "unsupported_media_type" || reason == "" {
		t.Fatalf("create with a short probe head = %d %v", res.StatusCode, out)
	}
}

// The fifth open session of one person is refused with the shared Retry-After
// header, and no multipart upload is created for it.
func TestCreateUploadSessionPerUserLimitCarriesRetryAfter(t *testing.T) {
	w := newUploadSessionWorld(t)
	path := "/api/v1/workspaces/" + w.wsID + "/documents/upload-sessions"
	for i := range 4 {
		res, out := doJSONHeaders(t, w.srv, "POST", path, w.token,
			map[string]string{"Idempotency-Key": util.NewID()}, sessionOpenBody("big.md", uploadSessionTestSize, nil))
		if res.StatusCode != 201 {
			t.Fatalf("session %d = %d %v", i+1, res.StatusCode, out)
		}
	}
	res, out := doJSONHeaders(t, w.srv, "POST", path, w.token,
		map[string]string{"Idempotency-Key": util.NewID()}, sessionOpenBody("big.md", uploadSessionTestSize, nil))
	if code, _ := errCodeClass(out); res.StatusCode != 429 || code != "upload_sessions_exhausted" {
		t.Fatalf("fifth session = %d %v", res.StatusCode, out)
	}
	if got := res.Header.Get("Retry-After"); got != "60" {
		t.Fatalf("Retry-After = %q, want 60", got)
	}
}

// The same Idempotency-Key with the same body answers the session that already
// exists (200, addendum §6.2); the same key with another payload is 409.
func TestCreateUploadSessionReplayAndPayloadMismatch(t *testing.T) {
	w := newUploadSessionWorld(t)
	path := "/api/v1/workspaces/" + w.wsID + "/documents/upload-sessions"
	body := sessionOpenBody("big.md", uploadSessionTestSize, nil)
	key := util.NewID()
	res, first := doJSONHeaders(t, w.srv, "POST", path, w.token, map[string]string{"Idempotency-Key": key}, body)
	if res.StatusCode != 201 {
		t.Fatalf("first create = %d %v", res.StatusCode, first)
	}
	res, replay := doJSONHeaders(t, w.srv, "POST", path, w.token, map[string]string{"Idempotency-Key": key}, body)
	if res.StatusCode != 200 {
		t.Fatalf("replay = %d %v", res.StatusCode, replay)
	}
	if replay["session_id"] != first["session_id"] {
		t.Fatalf("replay session = %v, want %v", replay["session_id"], first["session_id"])
	}
	res, out := doJSONHeaders(t, w.srv, "POST", path, w.token, map[string]string{"Idempotency-Key": key},
		sessionOpenBody("big.md", uploadSessionTestSize+1, nil))
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "idempotency_payload_mismatch" {
		t.Fatalf("same key, other payload = %d %v", res.StatusCode, out)
	}
}

// A session belongs to the principal and the route family that opened it:
// another member, the other family, or a frame token for another document all
// get the same 404 as an unknown id.
func TestUploadSessionPrincipalAndFamilyMismatchIs404(t *testing.T) {
	w := newUploadSessionWorld(t)
	sessionID, _ := w.openWorkspaceSession(t)

	for _, call := range []struct {
		name, method, path, token string
	}{
		{"another member reads", http.MethodGet, "/api/v1/upload-sessions/" + sessionID, w.outsiderToken},
		{"another member completes", http.MethodPost, "/api/v1/upload-sessions/" + sessionID + "/complete", w.outsiderToken},
		{"another member aborts", http.MethodDelete, "/api/v1/upload-sessions/" + sessionID, w.outsiderToken},
	} {
		body := any(nil)
		if call.method == http.MethodPost {
			body = map[string]any{"parts": []any{}}
		}
		res, out := doJSONHeaders(t, w.srv, call.method, call.path, call.token, nil, body)
		if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
			t.Fatalf("%s = %d %v", call.name, res.StatusCode, out)
		}
	}

	// The frame family needs the token of the document that opened the
	// session; a session opened with a session token is not a frame session.
	frameToken := w.mintFrameToken(t, w.docID)
	res, out := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+w.docID+"/upload-sessions/"+sessionID, frameToken, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("frame route on a session session = %d %v", res.StatusCode, out)
	}

	// And a frame session is invisible to the session routes.
	frameSession := w.openFrameSession(t, frameToken, w.docID)
	res, out = doJSON(t, w.srv, "GET", "/api/v1/upload-sessions/"+frameSession, w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("session route on a frame session = %d %v", res.StatusCode, out)
	}

	// A token for another document cannot reach it either.
	otherID, _ := w.createMarkdownDocument(t, "other.md")
	otherToken := w.mintFrameToken(t, otherID)
	res, out = doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+otherID+"/upload-sessions/"+frameSession, otherToken, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("another document's frame token = %d %v", res.StatusCode, out)
	}

	// The owner's own calls are the control: the session route answers, and
	// the same session aborts with 204.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/upload-sessions/"+sessionID, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("owner GET = %d %v", res.StatusCode, out)
	}
	res, raw := officeRaw(t, w.srv, "DELETE", "/api/v1/upload-sessions/"+sessionID, w.token, nil, nil)
	if res.StatusCode != 204 {
		t.Fatalf("owner DELETE = %d %s", res.StatusCode, isoClip(raw))
	}
}

// The frame token is not a session, and a session token is not a frame token:
// each family refuses the other's credential before it reads a session.
func TestSessionAndFrameTokensAreNotInterchangeable(t *testing.T) {
	w := newUploadSessionWorld(t)
	sessionID, _ := w.openWorkspaceSession(t)
	frameToken := w.mintFrameToken(t, w.docID)

	res, raw := officeRaw(t, w.srv, "GET", "/api/v1/upload-sessions/"+sessionID, frameToken, nil, nil)
	if res.StatusCode != 401 {
		t.Fatalf("frame token on the session route = %d %s", res.StatusCode, isoClip(raw))
	}
	res, raw = officeRaw(t, w.srv, "GET", "/api/v1/office-frame/documents/"+w.docID+"/upload-sessions/"+sessionID, w.token, nil, nil)
	if res.StatusCode != 401 {
		t.Fatalf("session token on the frame route = %d %s", res.StatusCode, isoClip(raw))
	}
}

func (w *uploadSessionWorld) mintFrameToken(t *testing.T, documentID string) string {
	t.Helper()
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/frame-token", w.token, nil)
	if res.StatusCode != 201 {
		t.Fatalf("mint frame token for %s: %d %v", documentID, res.StatusCode, out)
	}
	return out["token"].(string)
}

func (w *uploadSessionWorld) openFrameSession(t *testing.T, frameToken, documentID string) string {
	t.Helper()
	res, out := doJSONHeaders(t, w.srv, "POST", "/api/v1/office-frame/documents/"+documentID+"/upload-sessions", frameToken,
		map[string]string{"Idempotency-Key": util.NewID()}, sessionOpenBody("big.md", uploadSessionTestSize, nil))
	if res.StatusCode != 201 {
		t.Fatalf("open frame session: %d %v", res.StatusCode, out)
	}
	return out["session_id"].(string)
}

// GET answers the session status, the parts the storage holds and a fresh URL
// only for the parts still missing.
func TestGetUploadSessionShapeAndMissingParts(t *testing.T) {
	w := newUploadSessionWorld(t)
	sessionID, created := w.openWorkspaceSession(t)

	key := w.objectKeyOf(t, sessionID)
	uploadID, ok := w.store.openUploadForKey(key)
	if !ok {
		t.Fatal("no open multipart upload")
	}
	etag := w.store.PutPart(t, key, uploadID, 1, bytes.Repeat([]byte("a"), int(service.UploadSessionPartSizeBytes)))

	res, out := doJSON(t, w.srv, "GET", "/api/v1/upload-sessions/"+sessionID, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("GET = %d %v", res.StatusCode, out)
	}
	if out["status"] != "open" || out["session_id"] != sessionID {
		t.Fatalf("GET status/session = %v %v", out["status"], out["session_id"])
	}
	if out["part_size"] != created["part_size"] || out["total_parts"] != created["total_parts"] {
		t.Fatalf("GET geometry drifted from the create answer: %v vs %v", out, created)
	}
	completed, _ := out["completed_parts"].([]any)
	if len(completed) != 1 {
		t.Fatalf("completed_parts = %v, want the one part uploaded", out["completed_parts"])
	}
	part, _ := completed[0].(map[string]any)
	if part["part_number"] != float64(1) || part["etag"] != etag || part["size"] != float64(service.UploadSessionPartSizeBytes) {
		t.Fatalf("completed part = %v", part)
	}
	urls, _ := out["parts"].([]any)
	if len(urls) != 2 {
		t.Fatalf("parts = %v, want URLs for parts 2 and 3 only", out["parts"])
	}
	for _, raw := range urls {
		entry, _ := raw.(map[string]any)
		if entry["url"] == "" || entry["method"] != "PUT" || entry["expires_at"] == "" {
			t.Fatalf("part URL entry = %v", entry)
		}
	}
	if _, ok := out["expires_at"].(string); !ok {
		t.Fatalf("GET has no expires_at: %v", out)
	}
}

// Completing the workspace route creates the document and repeats its own
// answer; the session then reads as completed with no parts left to upload.
func TestCompleteWorkspaceUploadSessionCreatesDocument(t *testing.T) {
	w := newUploadSessionWorld(t)
	sessionID, _ := w.openWorkspaceSession(t)
	complete := w.seedParts(t, sessionID)

	res, out := doJSON(t, w.srv, "POST", "/api/v1/upload-sessions/"+sessionID+"/complete", w.token, complete)
	if res.StatusCode != 200 {
		t.Fatalf("complete = %d %v", res.StatusCode, out)
	}
	doc, _ := out["document"].(map[string]any)
	if doc == nil || doc["kind"] != "file" || doc["size_bytes"] != nil {
		t.Fatalf("complete answer is not a DocumentSDO: %v", out)
	}
	file, _ := doc["file"].(map[string]any)
	if file["size_bytes"] != float64(uploadSessionTestSize) || file["checksum_sha256"] == "" {
		t.Fatalf("created file = %v", file)
	}

	// Repeat complete: the same document, not a second one.
	res, replay := doJSON(t, w.srv, "POST", "/api/v1/upload-sessions/"+sessionID+"/complete", w.token, complete)
	if res.StatusCode != 200 {
		t.Fatalf("repeat complete = %d %v", res.StatusCode, replay)
	}
	replayDoc, _ := replay["document"].(map[string]any)
	if replayDoc["id"] != doc["id"] {
		t.Fatalf("repeat complete document = %v, want %v", replayDoc["id"], doc["id"])
	}

	res, got := doJSON(t, w.srv, "GET", "/api/v1/upload-sessions/"+sessionID, w.token, nil)
	if res.StatusCode != 200 || got["status"] != "completed" {
		t.Fatalf("GET after complete = %d %v", res.StatusCode, got)
	}
	if _, hasParts := got["parts"]; hasParts {
		t.Fatalf("completed session still carries part URLs: %v", got)
	}
}

// Completing the document route stages the upload; the existing commit route
// then turns it into the document's new version.
func TestCompleteDocumentUploadSessionStagesAndCommits(t *testing.T) {
	w := newUploadSessionWorld(t)
	res, out := doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+w.docID+"/upload-sessions", w.token,
		map[string]string{"Idempotency-Key": util.NewID()}, sessionOpenBody("big.md", uploadSessionTestSize, nil))
	if res.StatusCode != 201 {
		t.Fatalf("open version session = %d %v", res.StatusCode, out)
	}
	sessionID := out["session_id"].(string)
	complete := w.seedParts(t, sessionID)

	res, staged := doJSON(t, w.srv, "POST", "/api/v1/upload-sessions/"+sessionID+"/complete", w.token, complete)
	if res.StatusCode != 200 {
		t.Fatalf("complete version session = %d %v", res.StatusCode, staged)
	}
	uploadID, _ := staged["upload_id"].(string)
	if uploadID == "" || staged["checksum_sha256"] == "" || staged["size_bytes"] != float64(uploadSessionTestSize) {
		t.Fatalf("complete answer is not a DocumentUploadSDO: %v", staged)
	}

	res, committed := doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+w.docID+"/versions/commit", w.token,
		map[string]string{"Idempotency-Key": util.NewID()}, map[string]any{"upload_id": uploadID, "base_revision": w.docRevision})
	if res.StatusCode != 200 {
		t.Fatalf("commit staged upload = %d %v", res.StatusCode, committed)
	}
	version, _ := committed["version"].(map[string]any)
	if version["version"] != float64(2) || version["file_id"] != uploadID {
		t.Fatalf("committed version = %v", version)
	}
}

// The frame family runs the same flow for a document a frame token opens, and
// its staged upload commits through the frame commit route.
func TestFrameUploadSessionCompletesAndCommits(t *testing.T) {
	w := newUploadSessionWorld(t)
	frameToken := w.mintFrameToken(t, w.docID)
	sessionID := w.openFrameSession(t, frameToken, w.docID)
	complete := w.seedParts(t, sessionID)

	res, staged := doJSON(t, w.srv, "POST", "/api/v1/office-frame/documents/"+w.docID+"/upload-sessions/"+sessionID+"/complete", frameToken, complete)
	if res.StatusCode != 200 {
		t.Fatalf("frame complete = %d %v", res.StatusCode, staged)
	}
	uploadID, _ := staged["upload_id"].(string)
	if uploadID == "" {
		t.Fatalf("frame complete answer has no upload_id: %v", staged)
	}
	res, committed := doJSONHeaders(t, w.srv, "POST", "/api/v1/office-frame/documents/"+w.docID+"/versions/commit", frameToken,
		map[string]string{"Idempotency-Key": util.NewID()}, map[string]any{"upload_id": uploadID, "base_revision": w.docRevision})
	if res.StatusCode != 200 {
		t.Fatalf("frame commit = %d %v", res.StatusCode, committed)
	}
	file, _ := committed["file"].(map[string]any)
	if file["size_bytes"] != float64(uploadSessionTestSize) {
		t.Fatalf("frame commit file = %v", file)
	}
}

// A part list that does not match the storage leaves the session open so the
// client can fix it, and the answer is the coded 422.
func TestCompleteUploadSessionRejectsInvalidParts(t *testing.T) {
	w := newUploadSessionWorld(t)
	sessionID, _ := w.openWorkspaceSession(t)

	res, out := doJSON(t, w.srv, "POST", "/api/v1/upload-sessions/"+sessionID+"/complete", w.token, map[string]any{"parts": []any{}})
	if code, _ := errCodeClass(out); res.StatusCode != 422 || code != "upload_parts_invalid" {
		t.Fatalf("complete with no parts = %d %v", res.StatusCode, out)
	}
	res, got := doJSON(t, w.srv, "GET", "/api/v1/upload-sessions/"+sessionID, w.token, nil)
	if res.StatusCode != 200 || got["status"] != "open" {
		t.Fatalf("session after a refused complete = %d %v", res.StatusCode, got)
	}
}

// DELETE aborts the storage upload and releases the reservation; repeating it
// is 204, and aborting a completed session is 409.
func TestAbortUploadSessionIsIdempotentAndRefusesCompleted(t *testing.T) {
	w := newUploadSessionWorld(t)
	sessionID, _ := w.openWorkspaceSession(t)
	key := w.objectKeyOf(t, sessionID)
	uploadID, ok := w.store.openUploadForKey(key)
	if !ok {
		t.Fatal("no open multipart upload")
	}

	res, raw := officeRaw(t, w.srv, "DELETE", "/api/v1/upload-sessions/"+sessionID, w.token, nil, nil)
	if res.StatusCode != 204 {
		t.Fatalf("abort = %d %s", res.StatusCode, isoClip(raw))
	}
	if w.store.hasUpload(uploadID) {
		t.Fatal("abort left the multipart upload open at the storage")
	}
	res, raw = officeRaw(t, w.srv, "DELETE", "/api/v1/upload-sessions/"+sessionID, w.token, nil, nil)
	if res.StatusCode != 204 {
		t.Fatalf("second abort = %d %s", res.StatusCode, isoClip(raw))
	}
	res, out := doJSON(t, w.srv, "GET", "/api/v1/upload-sessions/"+sessionID, w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 410 || code != "upload_session_expired" {
		t.Fatalf("GET an aborted session = %d %v", res.StatusCode, out)
	}

	done, _ := w.openWorkspaceSession(t)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/upload-sessions/"+done+"/complete", w.token, w.seedParts(t, done))
	if res.StatusCode != 200 {
		t.Fatalf("complete before aborting it = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/upload-sessions/"+done, w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "upload_session_completed" {
		t.Fatalf("abort a completed session = %d %v", res.StatusCode, out)
	}
}

// The config advertises the chunk threshold only where the flow can run: a
// store with multipart + presign answers it, the local adapter alone does not.
// The second server reuses this world's pool - a second newTestDeps would wait
// on the test database's advisory lock the first one holds until cleanup.
func TestConfigAdvertisesChunkedUploadThresholdOnlyWithMultipart(t *testing.T) {
	w := newUploadSessionWorld(t)
	res, out := doJSON(t, w.srv, "GET", "/api/v1/config", "", nil)
	if res.StatusCode != 200 {
		t.Fatalf("config = %d %v", res.StatusCode, out)
	}
	limits, _ := out["documents"].(map[string]any)["limits"].(map[string]any)
	if got := limits["chunked_upload_threshold_bytes"]; got != float64(service.UploadSessionThresholdBytes) {
		t.Fatalf("chunked_upload_threshold_bytes = %v, want %d", got, service.UploadSessionThresholdBytes)
	}

	plain := service.NewDocumentService(w.pool, w.q, w.deps.Organizations, w.deps.Workspaces)
	plain.SetEntitlements(service.NewEntitlementService(w.pool, w.q))
	plainFS, err := service.NewFileService(service.FileServiceOptions{
		Pool: w.pool, Store: w.plainStore, SpoolDir: t.TempDir(),
		Quota: service.NewEntitlementService(w.pool, w.q),
	})
	if err != nil {
		t.Fatal(err)
	}
	plain.SetFiles(plainFS)
	w.deps.Documents = plain
	plainSrv := httptest.NewServer(New(w.deps))
	t.Cleanup(plainSrv.Close)

	res, out = doJSON(t, plainSrv, "GET", "/api/v1/config", "", nil)
	if res.StatusCode != 200 {
		t.Fatalf("config without multipart = %d %v", res.StatusCode, out)
	}
	limits, _ = out["documents"].(map[string]any)["limits"].(map[string]any)
	if got, present := limits["chunked_upload_threshold_bytes"]; present {
		t.Fatalf("chunked_upload_threshold_bytes = %v on a store without multipart", got)
	}
}
