package handler

// Handler-level tests for the G1-05a Documents HTTP surface (UNI-679, C-01
// §5 + §14). Every case drives the real Chi router over a real database with
// a real DocumentService; only the object store is faked (filesfake), so the
// router, flag gate, caps, idempotency and error envelope are the ones under
// test.

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type docsWorld struct {
	srv      *httptest.Server
	token    string
	userID   string
	orgID    string
	wsID     string
	outsider string
}

// docsPNG is a valid 1x1 PNG: the document layer decodes the image header,
// so a bare signature would not do.
var docsPNG = mustDecodeB64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")

func mustDecodeB64(s string) []byte {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

// newDocsWorld builds the full handler stack with DocumentService wired to an
// in-memory FileService fake and the `documents` flag on via the global
// override row the admin console writes.
func newDocsWorld(t *testing.T) *docsWorld {
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
		ID:        util.NewID(),
		FlagKey:   "documents",
		ScopeType: featureflags.ScopeGlobal,
		ScopeID:   "",
		Enabled:   true,
		Note:      "documents handler tests",
		CreatedBy: "test",
	}); err != nil {
		t.Fatalf("enable documents flag: %v", err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}

	w := &docsWorld{srv: srv}
	w.token, w.userID = filesRegister(t, srv, "docs-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "Docs Org", "slug": "docs-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/workspaces", w.token, map[string]string{"name": "Docs WS", "slug": "docs-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	w.wsID = out["workspace"].(map[string]any)["id"].(string)
	w.outsider, _ = filesRegister(t, srv, "docs-outsider@example.com")
	return w
}

// errCodeClass pulls error.code and error.error_class out of the decoded
// envelope doJSON already read.
func errCodeClass(out map[string]any) (code, class string) {
	errObj, _ := out["error"].(map[string]any)
	code, _ = errObj["code"].(string)
	class, _ = errObj["error_class"].(string)
	return code, class
}

// doMultipart posts one "file" part plus optional text fields and extra
// headers; returns the raw body so byte routes can assert on streamed bytes.
func doMultipart(t *testing.T, srv *httptest.Server, method, path, token string, fields map[string]string, filename string, fileBody []byte, headers map[string]string) (*http.Response, []byte) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(fileBody); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest(method, srv.URL+path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
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
	raw, _ := readAll(res)
	return res, raw
}

// doBytes hits a byte route with optional header pairs and returns the raw body.
func doBytes(t *testing.T, srv *httptest.Server, method, path, token string, headers ...string) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest(method, srv.URL+path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	return res, raw
}

func createPage(t *testing.T, w *docsWorld, title string, headers map[string]string) (map[string]any, string) {
	t.Helper()
	res, out := doJSONHeaders(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, headers, map[string]any{
		"title": title, "kind": "page",
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph"}}},
	})
	if res.StatusCode != 201 {
		t.Fatalf("create page: %d %v", res.StatusCode, out)
	}
	doc := out["document"].(map[string]any)
	return doc, doc["id"].(string)
}

func TestDocumentsFlagOff404(t *testing.T) {
	d, _ := newTestDeps(t, nil, discardOutbox{})
	q := db.New(testPool)
	docs := service.NewDocumentService(testPool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(testPool, q))
	docs.SetFiles(filesfake.New(filesfake.Options{}))
	d.Documents = docs
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	token, _ := filesRegister(t, srv, "flagoff@example.com")

	for _, tc := range []struct{ method, path string }{
		{"POST", "/api/v1/workspaces/ws_x/documents"},
		{"POST", "/api/v1/workspaces/ws_x/documents/files"},
		{"GET", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7"},
		{"PATCH", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7"},
		{"POST", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/uploads"},
		{"POST", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/versions/commit"},
		{"GET", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/versions"},
		{"GET", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/versions/1"},
		{"POST", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/versions"},
		{"POST", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/versions/1/restore"},
		{"POST", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/assets"},
		{"GET", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/assets/01J8X4AST0N1P2Q3R4S5T6U7V8"},
		{"GET", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/download"},
	} {
		res, out := doJSON(t, srv, tc.method, tc.path, token, map[string]any{})
		if res.StatusCode != 404 {
			t.Fatalf("%s %s with flag off: %d, want 404", tc.method, tc.path, res.StatusCode)
		}
		code, _ := errCodeClass(out)
		if code != "feature_disabled" {
			t.Fatalf("%s %s: code %q, want feature_disabled", tc.method, tc.path, code)
		}
	}
	// Unauthenticated requests still answer 401, not the flag gate.
	res, _ := doJSON(t, srv, "GET", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7", "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("unauthenticated: %d, want 401", res.StatusCode)
	}
}

func TestDocumentPageLifecycle(t *testing.T) {
	w := newDocsWorld(t)

	doc, id := createPage(t, w, "Spec v1", map[string]string{"Idempotency-Key": "create-1"})
	if doc["kind"] != "page" || doc["revision"] != "1" || doc["my_level"] != "manage" || doc["via"] != "member" {
		t.Fatalf("page doc: %v", doc)
	}
	// Same key + same payload replays the stored answer.
	res, out := doJSONHeaders(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token,
		map[string]string{"Idempotency-Key": "create-1"}, map[string]any{
			"title": "Spec v1", "kind": "page",
			"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph"}}},
		})
	if res.StatusCode != 201 || out["document"].(map[string]any)["id"] != id {
		t.Fatalf("idempotent replay: %d %v", res.StatusCode, out)
	}
	// Same key + different payload is a mismatch conflict.
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token,
		map[string]string{"Idempotency-Key": "create-1"}, map[string]any{"title": "Different", "kind": "page"})
	code, class := errCodeClass(out)
	if res.StatusCode != 409 || code != "idempotency_payload_mismatch" || class != "conflict" {
		t.Fatalf("mismatch: %d code=%q class=%q", res.StatusCode, code, class)
	}

	// GET round-trip.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+id, w.token, nil)
	if res.StatusCode != 200 || out["document"].(map[string]any)["title"] != "Spec v1" {
		t.Fatalf("get: %d %v", res.StatusCode, out)
	}

	// PATCH autosave bumps the revision; a stale base is a 422 conflict.
	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+id, w.token, map[string]any{
		"revision": "1", "title": "Spec v2",
	})
	if res.StatusCode != 200 || out["document"].(map[string]any)["revision"] != "2" {
		t.Fatalf("patch: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+id, w.token, map[string]any{
		"revision": "1", "title": "stale",
	})
	code, class = errCodeClass(out)
	if res.StatusCode != 422 || code != "revision_conflict" || class != "conflict" {
		t.Fatalf("stale patch: %d code=%q class=%q", res.StatusCode, code, class)
	}

	// Manual version checkpoint.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions", w.token, map[string]any{"label": "cut 1"})
	if res.StatusCode != 201 {
		t.Fatalf("create version: %d %v", res.StatusCode, out)
	}
	ver := out["version"].(map[string]any)
	if ver["version"].(float64) != 1 || ver["kind"] != "page" {
		t.Fatalf("version: %v", ver)
	}
	// A second checkpoint with no change is document_version_unchanged.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions", w.token, map[string]any{"label": "same"})
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "document_version_unchanged" {
		t.Fatalf("unchanged version: %d code=%q", res.StatusCode, code)
	}

	// List + get one version (content rides the single-version GET).
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+id+"/versions", w.token, nil)
	if res.StatusCode != 200 || len(out["versions"].([]any)) != 1 {
		t.Fatalf("list versions: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+id+"/versions/1", w.token, nil)
	if res.StatusCode != 200 || out["version"].(map[string]any)["content"] == nil {
		t.Fatalf("get version: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+id+"/versions/999", w.token, nil)
	if code, class := errCodeClass(out); res.StatusCode != 404 || code != "not_found" || class != "missing" {
		t.Fatalf("missing version: %d code=%q class=%q", res.StatusCode, code, class)
	}

	// Edit again, then restore version 1 over the live revision.
	res, _ = doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+id, w.token, map[string]any{
		"revision": "2", "title": "Spec v3",
	})
	if res.StatusCode != 200 {
		t.Fatalf("patch2: %d", res.StatusCode)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/1/restore", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("restore: %d %v", res.StatusCode, out)
	}
	rdoc := out["document"].(map[string]any)
	rver := out["version"].(map[string]any)
	if rver["restored_from"].(float64) != 1 || rdoc["revision"] == "3" {
		t.Fatalf("restore: doc=%v ver=%v", rdoc, rver)
	}

	// An outsider reads nothing and learns nothing.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+id, w.outsider, nil)
	if code, class := errCodeClass(out); res.StatusCode != 404 || code != "not_found" || class != "missing" {
		t.Fatalf("outsider read: %d code=%q class=%q (must not leak existence)", res.StatusCode, code, class)
	}
}

func TestDocumentFileLifecycle(t *testing.T) {
	w := newDocsWorld(t)

	// Multipart create: file part + optional title field. text/plain content
	// passes both the MIME allowlist and the UTF-8 text check.
	txt := []byte("quarterly report body, utf-8 text\n")
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files", w.token,
		map[string]string{"title": "report.txt"}, "report.txt", txt, map[string]string{"Idempotency-Key": "fc-1"})
	if res.StatusCode != 201 {
		t.Fatalf("create file doc: %d %s", res.StatusCode, raw)
	}
	var j map[string]any
	_ = json.Unmarshal(raw, &j)
	doc := j["document"].(map[string]any)
	id := doc["id"].(string)
	file, _ := doc["file"].(map[string]any)
	if doc["kind"] != "file" || file["filename"] == "" || file["checksum_sha256"] == "" {
		t.Fatalf("file doc: %v", doc)
	}

	// Stage candidate bytes; upload_id is the FileService file_id.
	v2 := []byte("v2 body: revised quarterly report\n")
	res, raw = doMultipart(t, w.srv, "POST", "/api/v1/documents/"+id+"/uploads", w.token, nil, "v2.txt", v2, map[string]string{"Idempotency-Key": "up-1"})
	if res.StatusCode != 201 {
		t.Fatalf("upload: %d %s", res.StatusCode, raw)
	}
	_ = json.Unmarshal(raw, &j)
	uploadID, _ := j["upload_id"].(string)
	if uploadID == "" || j["checksum_sha256"] == "" || j["claim_expires_at"] == "" {
		t.Fatalf("upload sdo: %s", raw)
	}

	// Commit with a stale base is a 409 document_version_conflict.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/commit", w.token, map[string]any{
		"upload_id": uploadID, "base_revision": "99",
	})
	if code, class := errCodeClass(out); res.StatusCode != 409 || code != "document_version_conflict" || class != "conflict" {
		t.Fatalf("stale commit: %d code=%q class=%q", res.StatusCode, code, class)
	}

	// Commit with the live base + Idempotency-Key appends version 2.
	rev := doc["revision"].(string)
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/commit", w.token,
		map[string]string{"Idempotency-Key": "commit-1"}, map[string]any{"upload_id": uploadID, "base_revision": rev})
	if res.StatusCode != 200 {
		t.Fatalf("commit: %d %v", res.StatusCode, out)
	}
	ver := out["version"].(map[string]any)
	if ver["version"].(float64) != 2 || ver["file_id"] == "" {
		t.Fatalf("commit version: %v", ver)
	}
	// Replay of the same key+payload replays; it does not append version 3.
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/commit", w.token,
		map[string]string{"Idempotency-Key": "commit-1"}, map[string]any{"upload_id": uploadID, "base_revision": rev})
	if res.StatusCode != 200 || out["version"].(map[string]any)["id"] != ver["id"] {
		t.Fatalf("commit replay: %d %v", res.StatusCode, out)
	}
	// Same key, different payload -> mismatch. The service resolves upload_id
	// before peeking at idempotency, so the divergent payload is a real staged
	// upload with different bytes (a different checksum).
	res, raw = doMultipart(t, w.srv, "POST", "/api/v1/documents/"+id+"/uploads", w.token, nil, "v3.txt", []byte("different bytes entirely\n"), map[string]string{"Idempotency-Key": "up-2"})
	if res.StatusCode != 201 {
		t.Fatalf("second upload: %d %s", res.StatusCode, raw)
	}
	_ = json.Unmarshal(raw, &j)
	otherUpload, _ := j["upload_id"].(string)
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/commit", w.token,
		map[string]string{"Idempotency-Key": "commit-1"}, map[string]any{"upload_id": otherUpload, "base_revision": rev})
	if code, class := errCodeClass(out); res.StatusCode != 409 || code != "idempotency_payload_mismatch" || class != "conflict" {
		t.Fatalf("commit mismatch: %d code=%q class=%q", res.StatusCode, code, class)
	}

	// meta=1 answers the descriptor; without meta the bytes stream.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+id+"/download?meta=1", w.token, nil)
	if res.StatusCode != 200 || out["disposition"] != "attachment" || out["file"].(map[string]any)["version"].(float64) != 2 {
		t.Fatalf("download meta: %d %v", res.StatusCode, out)
	}
	res, raw = doBytes(t, w.srv, "GET", "/api/v1/documents/"+id+"/download", w.token)
	if res.StatusCode != 200 || !bytes.Contains(raw, v2) {
		t.Fatalf("download: %d body=%q", res.StatusCode, raw[:min(len(raw), 80)])
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.Contains(cd, "attachment") || !strings.Contains(cd, "v2") {
		t.Fatalf("disposition: %q", cd)
	}
	if res.Header.Get("X-Checksum-Sha256") == "" || res.Header.Get("Accept-Ranges") != "bytes" {
		t.Fatalf("download headers: %v", res.Header)
	}

	// HEAD answers headers only; Range answers 206 with the window.
	res, raw = doBytes(t, w.srv, "HEAD", "/api/v1/documents/"+id+"/download", w.token)
	if res.StatusCode != 200 || res.Header.Get("Content-Length") == "" || len(raw) != 0 {
		t.Fatalf("head: %d len=%d %v", res.StatusCode, len(raw), res.Header)
	}
	res, raw = doBytes(t, w.srv, "GET", "/api/v1/documents/"+id+"/download?version=1", w.token, "Range", "bytes=0-9")
	if res.StatusCode != 206 || len(raw) != 10 || res.Header.Get("Content-Range") == "" {
		t.Fatalf("range: %d len=%d range=%q", res.StatusCode, len(raw), res.Header.Get("Content-Range"))
	}
	res, _ = doBytes(t, w.srv, "GET", "/api/v1/documents/"+id+"/download", w.token, "Range", "bytes=9999999-")
	if res.StatusCode != 416 || res.Header.Get("Content-Range") == "" {
		t.Fatalf("unsatisfiable range: %d %v", res.StatusCode, res.Header)
	}

	// Version list shows both file rows; restore needs the live base.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+id+"/versions", w.token, nil)
	if res.StatusCode != 200 || len(out["versions"].([]any)) != 2 {
		t.Fatalf("versions: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+id, w.token, nil)
	liveRev := out["document"].(map[string]any)["revision"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/1/restore", w.token, nil)
	if code, class := errCodeClass(out); res.StatusCode != 409 || code != "document_version_conflict" || class != "conflict" {
		t.Fatalf("file restore without base: %d code=%q class=%q", res.StatusCode, code, class)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/1/restore", w.token, map[string]any{"base_revision": liveRev})
	if res.StatusCode != 200 || out["version"].(map[string]any)["restored_from"].(float64) != 1 {
		t.Fatalf("file restore: %d %v", res.StatusCode, out)
	}
}

func TestDocumentAssetUploadAndStream(t *testing.T) {
	w := newDocsWorld(t)
	_, id := createPage(t, w, "with image", nil)

	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/documents/"+id+"/assets", w.token, nil, "pic.png", docsPNG, nil)
	if res.StatusCode != 201 {
		t.Fatalf("asset upload: %d %s", res.StatusCode, raw)
	}
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	url, _ := out["url"].(string)
	if out["id"] == "" || !strings.HasPrefix(url, "/api/v1/documents/"+id+"/assets/") {
		t.Fatalf("asset sdo: %s", raw)
	}
	res, raw = doBytes(t, w.srv, "GET", url, w.token)
	if res.StatusCode != 200 || !bytes.Equal(raw, docsPNG) || res.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("asset stream: %d ct=%q len=%d", res.StatusCode, res.Header.Get("Content-Type"), len(raw))
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "inline") {
		t.Fatalf("asset disposition: %q (image must serve inline)", cd)
	}
	res, _ = doBytes(t, w.srv, "GET", url, w.outsider)
	if res.StatusCode != 404 {
		t.Fatalf("outsider asset: %d, want 404", res.StatusCode)
	}
}

func TestDocumentJSONCaps(t *testing.T) {
	w := newDocsWorld(t)

	// A body past the document cap (8 MiB raw + envelope) answers 413.
	big := strings.Repeat("x", int(maxDocumentJSONBody)+1024)
	res, _ := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, map[string]any{
		"title": "huge", "kind": "page", "content": map[string]any{"type": "doc", "text": big},
	})
	if res.StatusCode != 413 {
		t.Fatalf("oversized JSON: %d, want 413", res.StatusCode)
	}

	// Between the generic 1 MiB cap and the document cap the request must
	// pass: a ~1.5 MiB raw page is inside the 8 MiB contract.
	text := strings.Repeat("nội dung dài ", 120000)
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, map[string]any{
		"title": "big page", "kind": "page",
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}}}},
	})
	if res.StatusCode != 201 {
		t.Fatalf("~1.5 MiB page: %d %v", res.StatusCode, out)
	}
}

func TestDocumentMultipartCap(t *testing.T) {
	w := newDocsWorld(t)
	_, id := createPage(t, w, "cap", nil)

	// > 50 MiB of multipart body hits the document_file request cap -> 413.
	over := bytes.Repeat([]byte{7}, 50<<20+600<<10)
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/documents/"+id+"/uploads", w.token, nil, "big.pdf", over, nil)
	if res.StatusCode != 413 {
		t.Fatalf("multipart over cap: %d %s", res.StatusCode, raw[:min(len(raw), 200)])
	}
	// Asset cap is 10 MiB.
	res, _ = doMultipart(t, w.srv, "POST", "/api/v1/documents/"+id+"/assets", w.token, nil, "big.png", bytes.Repeat([]byte{7}, 10<<20+600<<10), nil)
	if res.StatusCode != 413 {
		t.Fatalf("asset over cap: %d, want 413", res.StatusCode)
	}
}
