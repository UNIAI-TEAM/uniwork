package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"

	featureflags "github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-2052 w2 over HTTP: the server content route and COMPLETE.

// unsignedFiles is the fake FileService behind a store that cannot presign a
// write, so every target is the server content route.
type unsignedFiles struct{ files.Service }

func (unsignedFiles) RegisterProviderOutput(context.Context, files.ProviderOutputInput) (files.ProviderOutput, error) {
	return files.ProviderOutput{}, files.StorageUnavailable(storage.ErrCapabilityUnsupported)
}

func newUnsignedFolderWorld(t *testing.T) *docsWorld {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetFiles(unsignedFiles{filesfake.New(filesfake.Options{})})
	if d.FeatureFlags != nil {
		docs.SetFlags(d.FeatureFlags)
	}
	d.Documents = docs
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "documents", ScopeType: featureflags.ScopeGlobal,
		ScopeID: "", Enabled: true, Note: "folder upload handler tests", CreatedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
	w := &docsWorld{srv: srv}
	w.token, w.userID = filesRegister(t, srv, "fu-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "FU Org", "slug": "fu-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/workspaces", w.token, map[string]string{"name": "FU WS", "slug": "fu-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	w.wsID = out["workspace"].(map[string]any)["id"].(string)
	w.outsider, _ = filesRegister(t, srv, "fu-outsider@example.com")
	return w
}

func TestFolderUploadContentAndCompleteOverHTTP(t *testing.T) {
	w := newUnsignedFolderWorld(t)
	md := "# Ghi chú\n"
	plan := map[string]any{
		"parent_id": nil, "root_name": "Tải", "share_with_workspace": false, "folders": []string{},
		"files": []map[string]any{{"file_key": "f-1", "path": "", "filename": "ghi-chu.md", "size_bytes": len(md)}},
	}
	base := "/api/v1/workspaces/" + w.wsID + "/documents/folder-uploads"
	res, batch := doJSONHeaders(t, w.srv, "POST", base, w.token, map[string]string{"Idempotency-Key": "plan-http"}, plan)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("plan: %d %v", res.StatusCode, batch)
	}
	target := batch["files"].([]any)[0].(map[string]any)["target"].(map[string]any)
	content := base + "/" + batch["id"].(string) + "/files/f-1/content"
	if target["url"] != content || target["auth"] != "session" {
		t.Fatalf("target = %v", target)
	}

	// Not the creator's batch, or no such file: 404 or the membership gate,
	// never a body that names the batch.
	if res, _ := doRaw(t, w.srv, "PUT", content, w.outsider, md); res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusForbidden {
		t.Fatalf("outsider PUT: %d", res.StatusCode)
	}
	if res, out := doRaw(t, w.srv, "PUT", base+"/"+util.NewID()+"/files/f-1/content", w.token, md); res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown batch: %d %v", res.StatusCode, out)
	}
	if res, out := doRaw(t, w.srv, "PUT", content, w.token, md+"more"); res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("over the declared size: %d %v", res.StatusCode, out)
	} else if code, _ := errCodeClass(out); code != "file_too_large" {
		t.Fatalf("over the declared size: %v", out)
	}

	res, out := doRaw(t, w.srv, "PUT", content, w.token, md)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("PUT: %d %v", res.StatusCode, out)
	}
	sum := sha256.Sum256([]byte(md))
	want := `"` + hex.EncodeToString(sum[:]) + `"`
	if res.Header.Get("ETag") != want || out["etag"] != want {
		t.Fatalf("etag header %q body %v, want %s", res.Header.Get("ETag"), out["etag"], want)
	}

	complete := base + "/" + batch["id"].(string) + "/complete"
	res, out = doJSON(t, w.srv, "POST", complete, w.token, map[string]any{"files": []map[string]any{
		{"file_key": "f-1", "etag": want}, {"file_key": "zzz", "etag": want},
	}})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("complete: %d %v", res.StatusCode, out)
	}
	results := out["results"].([]any)
	done, missing := results[0].(map[string]any), results[1].(map[string]any)
	if done["status"] != "done" || done["document_id"] == nil || done["error"] != nil {
		t.Fatalf("done = %v", done)
	}
	if e, _ := missing["error"].(map[string]any); missing["status"] != "failed" || missing["document_id"] != nil || e["code"] != "not_found" || e["message"] == "" {
		t.Fatalf("not_found = %v", missing)
	}
	b := out["batch"].(map[string]any)
	if b["status"] != "completed" || b["counts"].(map[string]any)["done"] != float64(1) {
		t.Fatalf("batch = %v", b)
	}

	tooMany := make([]map[string]any, 51)
	for i := range tooMany {
		tooMany[i] = map[string]any{"file_key": "k" + util.NewID()}
	}
	res, out = doJSON(t, w.srv, "POST", complete, w.token, map[string]any{"files": tooMany})
	if code, _ := errCodeClass(out); res.StatusCode != http.StatusBadRequest || code != "invalid_request" {
		t.Fatalf("51 files: %d %v", res.StatusCode, out)
	}
	if res, _ := doJSON(t, w.srv, "POST", complete, w.outsider, map[string]any{"files": []map[string]any{{"file_key": "f-1"}}}); res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusForbidden {
		t.Fatalf("outsider COMPLETE: %d", res.StatusCode)
	}
}
