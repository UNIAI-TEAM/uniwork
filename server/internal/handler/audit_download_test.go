package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// zipMagic is a body the content detector reports as application/zip, which
// the audit_export allowlist already accepts. The export's own CSV/NDJSON
// bytes sniff as text/plain until the shared detector lands (t1c), so the
// staged file here is shaped by hand rather than produced by the consumer.
var zipMagic = append([]byte("PK\x03\x04"), bytes.Repeat([]byte{0}, 64)...)

// stageExportFile stands in for the consumer's finish: stage the file, claim
// it and complete the job row in one transaction, exactly the call sequence
// AuditExportConsumer.claimAndComplete runs.
func stageExportFile(t *testing.T, pool *pgxpool.Pool, q *db.Queries, fake *filesfake.Fake, exportID, orgID string, body []byte) files.FileID {
	t.Helper()
	ctx := context.Background()
	up, err := fake.Upload(ctx, files.UploadInput{
		Actor:          audit.System("audit-export"),
		Purpose:        files.AuditExport,
		Scope:          files.Scope{OrganizationID: orgID},
		IdempotencyKey: "audit-export:" + exportID,
		Filename:       "audit-20260901-20260925.csv",
		Body:           bytes.NewReader(body),
	})
	if err != nil {
		t.Fatalf("stage upload: %v", err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	qx := q.WithTx(tx)
	if _, err := fake.ClaimInTx(ctx, qx, files.ClaimInput{
		Actor:   audit.System("audit-export"),
		Purpose: files.AuditExport,
		Scope:   files.Scope{OrganizationID: orgID},
		FileIDs: []files.FileID{up.File.ID},
	}); err != nil {
		t.Fatalf("claim: %v", err)
	}
	if _, err := qx.CompleteAuditExportWithFile(ctx, db.CompleteAuditExportWithFileParams{
		ID:       exportID,
		FileID:   pgtype.Text{String: string(up.File.ID), Valid: true},
		RowCount: 1,
	}); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return up.File.ID
}

// The download route is the FileService replacement for the bare storage URL:
// every request authenticates, re-checks the audit permission and the 24 hour
// window, and streams through the proxy with private download headers.
func TestAuditExportDownloadRoute(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	fake := filesfake.New(filesfake.Options{})
	d.Audit.SetFileService(fake)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	w := buildAuditWorld(t, srv)

	// The route itself is integration-owned (router/routes.go); the test mounts
	// the same method on the same Deps behind the same auth middleware.
	h := &handlers{Deps: d}
	r := chi.NewRouter()
	r.With(middleware.RequireAuth(d.Minter)).
		Get("/api/v1/orgs/{orgID}/audit/exports/{exportID}/download", h.downloadAuditExport)
	dl := httptest.NewServer(r)
	t.Cleanup(dl.Close)
	get := func(token, orgID, exportID string) (*http.Response, []byte) {
		t.Helper()
		req, _ := http.NewRequest("GET",
			fmt.Sprintf("%s/api/v1/orgs/%s/audit/exports/%s/download", dl.URL, orgID, exportID), nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res, err := dl.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		return res, body
	}

	// A completed FileService-backed export.
	from := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	to := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token,
		map[string]string{"format": "csv", "from": from, "to": to})
	if res.StatusCode != 202 {
		t.Fatalf("request export: %d %v", res.StatusCode, out)
	}
	exportID := out["export"].(map[string]any)["id"].(string)
	stageExportFile(t, pool, db.New(pool), fake, exportID, w.orgID, zipMagic)

	// The status payload now points at the API route, not a storage URL.
	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports/"+exportID, w.token, nil)
	url, _ := out["export"].(map[string]any)["download_url"].(string)
	want := "/api/v1/orgs/" + w.orgID + "/audit/exports/" + exportID + "/download"
	if url != want {
		t.Fatalf("download_url = %q, want the authenticated route %q", url, want)
	}

	res, body := get(w.token, w.orgID, exportID)
	if res.StatusCode != 200 {
		t.Fatalf("download: %d %s", res.StatusCode, body)
	}
	if got := res.Header.Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("X-Content-Type-Options missing")
	}
	if got := res.Header.Get("Content-Disposition"); got != `attachment; filename="audit-20260901-20260925.csv"` {
		t.Fatalf("Content-Disposition = %q", got)
	}
	if got := res.Header.Get("Content-Type"); got != "text/csv; charset=utf-8" {
		t.Fatalf("Content-Type = %q", got)
	}
	if !bytes.Equal(body, zipMagic) {
		t.Fatal("the route did not stream the file's bytes")
	}
	if got := res.Header.Get("Content-Length"); got != fmt.Sprint(len(zipMagic)) {
		t.Fatalf("Content-Length = %q", got)
	}

	// Anonymous and foreign callers are refused before any byte moves.
	if res, _ := get("", w.orgID, exportID); res.StatusCode != 401 {
		t.Fatalf("anonymous download: %d, want 401", res.StatusCode)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "audit-dl-outsider@example.com", "password": "password123", "display_name": "Out",
	})
	outsider := out["access_token"].(string)
	if res, _ := get(outsider, w.orgID, exportID); res.StatusCode != 403 {
		t.Fatalf("non-member download: %d, want 403", res.StatusCode)
	}
	if res, _ := get(w.token, w.orgID, "01J8X4NOTHINGATALL0000000"); res.StatusCode != 404 {
		t.Fatalf("unknown export: %d, want 404", res.StatusCode)
	}

	// Past the 24 hour window the answer is a gone, not the bytes.
	if _, err := pool.Exec(context.Background(), `UPDATE audit_exports
		SET expires_at = now() - interval '1 minute' WHERE id = $1`, exportID); err != nil {
		t.Fatal(err)
	}
	res, body = get(w.token, w.orgID, exportID)
	if res.StatusCode != 410 {
		t.Fatalf("expired download: %d %s", res.StatusCode, body)
	}
	var errOut map[string]any
	if err := json.Unmarshal(body, &errOut); err == nil {
		if code, _ := errOut["error"].(map[string]any)["code"].(string); code != "audit_export_expired" {
			t.Fatalf("expired error code = %q, want audit_export_expired", code)
		}
	}
	// And the status payload stops offering the link too.
	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports/"+exportID, w.token, nil)
	if out["export"].(map[string]any)["download_url"] != nil {
		t.Fatalf("an expired export still offers the download: %v", out["export"])
	}
}

// A row the legacy path completed keeps its storage URL in the status payload
// and does not answer on the FileService download route — the migration is a
// window with both kinds of row readable, not a flag day.
func TestAuditExportDownloadRouteLeavesLegacyRowsOnStorageURLs(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	d, _ := newTestDeps(t, nil, discardOutbox{})
	d.Audit.SetFileService(filesfake.New(filesfake.Options{}))
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	w := buildAuditWorld(t, srv)

	h := &handlers{Deps: d}
	r := chi.NewRouter()
	r.With(middleware.RequireAuth(d.Minter)).
		Get("/api/v1/orgs/{orgID}/audit/exports/{exportID}/download", h.downloadAuditExport)
	dl := httptest.NewServer(r)
	t.Cleanup(dl.Close)

	from := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	to := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/audit/exports", w.token,
		map[string]string{"format": "csv", "from": from, "to": to})
	if res.StatusCode != 202 {
		t.Fatalf("request export: %d %v", res.StatusCode, out)
	}
	exportID := out["export"].(map[string]any)["id"].(string)
	runAuditExportWorker(t, exportID, w.orgID)

	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/"+w.orgID+"/audit/exports/"+exportID, w.token, nil)
	url, _ := out["export"].(map[string]any)["download_url"].(string)
	if url == "" || strings.HasPrefix(url, "/api/v1/") {
		t.Fatalf("a legacy row must keep its storage URL, got %q", url)
	}

	req, _ := http.NewRequest("GET",
		fmt.Sprintf("%s/api/v1/orgs/%s/audit/exports/%s/download", dl.URL, w.orgID, exportID), nil)
	req.Header.Set("Authorization", "Bearer "+w.token)
	dres, err := dl.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer dres.Body.Close()
	if dres.StatusCode != 404 {
		t.Fatalf("a legacy row on the download route: %d, want 404", dres.StatusCode)
	}
}
