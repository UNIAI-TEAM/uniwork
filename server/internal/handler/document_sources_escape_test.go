package handler

// The web client builds the source routes with encodeURIComponent
// (packages/core/api/endpoints/documents-sources.ts), so a sourceFileID's
// colon arrives as %3A. Chi hands the param out of r.URL.RawPath, still
// escaped: the routes must unescape it once or every source download/save
// answers 404 (UNI-1815, S2V-1).

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// sourceEscapeWorld builds the full handler stack the documents home needs:
// a real DocumentService plus filesfake on chat and tasks, with the
// `documents` flag on.
func sourceEscapeWorld(t *testing.T) *httptest.Server {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	fake := filesfake.New(filesfake.Options{})
	d.Chat.SetFiles(fake)
	d.Tasks.SetFiles(fake)
	q := db.New(pool)
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	docs.SetFiles(fake)
	if d.FeatureFlags != nil {
		docs.SetFlags(d.FeatureFlags)
	}
	d.Documents = docs
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	setDocumentsOverride(t, featureflags.ScopeGlobal, "", true)
	return srv
}

// sourceEscapeFixture returns a workspace with a chat file message on it and
// answers its message id. filesfake keeps no files catalog row, so the one
// the real FileService commits at claim is written here: the source list
// gate joins it for status='ready'.
func sourceEscapeFixture(t *testing.T, srv *httptest.Server) (f *chatFixture, messageID string) {
	t.Helper()
	f = setupChatFixtureOn(t, srv, "srcesc")
	res, out := uploadChatFile(
		t, srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"ke-hoach.pdf", "application/pdf", "src-escape-1", tinyPDF,
	)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("upload chat file: %d %v", res.StatusCode, out)
	}
	messageID, _ = out["message"].(map[string]any)["id"].(string)
	if messageID == "" {
		t.Fatalf("chat file message = %v", out)
	}
	var fileID string
	if err := testPool.QueryRow(context.Background(),
		`SELECT file_id::text FROM chat_messages WHERE id = $1`, messageID).Scan(&fileID); err != nil {
		t.Fatalf("chat file row: %v", err)
	}
	if _, err := testPool.Exec(context.Background(), `INSERT INTO files
		(id, organization_id, storage, object_key, original_filename, content_type, size_bytes, status, ready_at)
		VALUES ($1, $2, 'local', $3, 'ke-hoach.pdf', 'application/pdf', $4, 'ready', now())`,
		fileID, f.orgID, "chat/"+fileID, int64(len(tinyPDF))); err != nil {
		t.Fatalf("files catalog row: %v", err)
	}
	return f, messageID
}

// A member's raw-colon and %3A-escaped requests must be the same request:
// same download bytes, and the save idempotency replay proves the escaped
// request found the same source row.
func TestDocumentSourceEscapedFileID(t *testing.T) {
	srv := sourceEscapeWorld(t)
	f, messageID := sourceEscapeFixture(t, srv)
	sourceID := "chat:" + messageID
	// Go's url.PathEscape leaves the colon raw; the client's
	// encodeURIComponent sends %3A.
	escapedID := strings.Replace(sourceID, ":", "%3A", 1)
	member := f.tokens["b"]

	base := "/api/v1/workspaces/" + f.wsID + "/documents/sources/"

	res, rawBytes := doBytes(t, srv, http.MethodGet, base+sourceID+"/download", member)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("raw-colon download = %d %s", res.StatusCode, rawBytes)
	}

	res, escBytes := doBytes(t, srv, http.MethodGet, base+escapedID+"/download", member)
	if res.StatusCode != http.StatusOK {
		t.Errorf("escaped download = %d %s, want the raw-colon 200", res.StatusCode, escBytes)
	} else if string(escBytes) != string(rawBytes) {
		t.Errorf("escaped download body differs from the raw-colon body")
	}

	headers := map[string]string{"Idempotency-Key": "src-escape-save-1"}
	res, rawSave := doJSONHeaders(t, srv, http.MethodPost, base+sourceID+"/save", member, headers, map[string]any{"title": "Lưu nguồn"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("raw-colon save = %d %v", res.StatusCode, rawSave)
	}

	res, escSave := doJSONHeaders(t, srv, http.MethodPost, base+escapedID+"/save", member, headers, map[string]any{"title": "Lưu nguồn"})
	if res.StatusCode != http.StatusCreated {
		t.Errorf("escaped save = %d %v, want the raw-colon 201", res.StatusCode, escSave)
		return
	}
	docRaw, _ := rawSave["document"].(map[string]any)
	docEsc, _ := escSave["document"].(map[string]any)
	if docEsc["id"] != docRaw["id"] {
		t.Errorf("escaped save replayed a different document: raw=%v escaped=%v", docRaw["id"], docEsc["id"])
	}
}

// An id whose escape is malformed answers like an unknown id: the same 404,
// never a 400 that would reveal a parse step. A live net/http server rejects
// a bad escape before routing, so this drives the handler's own context.
func TestSourceFileIDParamBadEscapeIsNotFound(t *testing.T) {
	h := &handlers{Deps: Deps{DocumentSources: &service.DocumentSourceService{}}}
	for _, raw := range []string{"chat%zz", "chat%3", "%"} {
		r := httptest.NewRequest(http.MethodGet, "/x", nil)
		r.URL = &url.URL{Path: raw, RawPath: raw}
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("sourceFileID", raw)
		r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
		rec := httptest.NewRecorder()
		h.downloadDocumentSource(rec, r)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("download with sourceFileID %q = %d %s, want 404", raw, rec.Code, rec.Body.String())
		}
		rec = httptest.NewRecorder()
		h.saveDocumentSource(rec, r)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("save with sourceFileID %q = %d %s, want 404", raw, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "not_found") {
			t.Fatalf("save with %q answered %s, want the not_found envelope", raw, rec.Body.String())
		}
	}
}
