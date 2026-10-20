package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	featureflags "github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-2045 SV-9 over HTTP: the three routes, their shapes and their refusals.

type zipWorld struct {
	*docsWorld
	consumer *service.DocumentDownloadConsumer
}

func newZipWorld(t *testing.T) *zipWorld {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	fake := filesfake.New(filesfake.Options{})
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	docs.SetFiles(fake)
	if d.FeatureFlags != nil {
		docs.SetFlags(d.FeatureFlags)
	}
	d.Documents = docs
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "documents", ScopeType: featureflags.ScopeGlobal,
		ScopeID: "", Enabled: true, Note: "download job handler tests", CreatedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
	w := &docsWorld{srv: srv}
	w.token, w.userID = filesRegister(t, srv, "dl-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "DL Org", "slug": "dl-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/workspaces", w.token, map[string]string{"name": "DL WS", "slug": "dl-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	w.wsID = out["workspace"].(map[string]any)["id"].(string)
	w.outsider, _ = filesRegister(t, srv, "dl-outsider@example.com")
	c := service.NewDocumentDownloadConsumer(pool, q, docs)
	c.SetFileService(fake)
	return &zipWorld{docsWorld: w, consumer: c}
}

func (z *zipWorld) upload(t *testing.T, title, name, body string) string {
	t.Helper()
	res, raw := doMultipart(t, z.srv, "POST", "/api/v1/workspaces/"+z.wsID+"/documents/files", z.token,
		map[string]string{"title": title}, name, []byte(body), nil)
	if res.StatusCode != 201 {
		t.Fatalf("upload %s: %d %s", name, res.StatusCode, raw)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out["document"].(map[string]any)["id"].(string)
}

func (z *zipWorld) build(t *testing.T, jobID string) {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{"job_id": jobID, "organization_id": z.orgID, "workspace_id": z.wsID})
	if err := z.consumer.Handle(context.Background(), outbox.Row{ID: "ev-" + jobID, Topic: service.DocumentDownloadTopic, Payload: string(payload)}); err != nil {
		t.Fatal(err)
	}
}

func (z *zipWorld) base() string { return "/api/v1/workspaces/" + z.wsID + "/documents/download-jobs" }

func TestDocumentDownloadJobRoutes(t *testing.T) {
	z := newZipWorld(t)
	a := z.upload(t, "Plan", "plan.md", "plan-bytes")
	b := z.upload(t, "Budget", "budget.md", "budget-bytes")
	res, out := doJSON(t, z.srv, "POST", "/api/v1/workspaces/"+z.wsID+"/documents", z.token, map[string]any{"title": "A page", "visibility": "workspace"})
	if res.StatusCode != 201 {
		t.Fatalf("create page: %d %v", res.StatusCode, out)
	}
	page := out["document"].(map[string]any)["id"].(string)
	missing := util.NewID()

	res, job := doJSON(t, z.srv, "POST", z.base(), z.token, map[string]any{"document_ids": []string{a, b, page, missing}})
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("POST = %d %v, want 202", res.StatusCode, job)
	}
	for _, key := range []string{"id", "status", "created_at", "expires_at", "download_url", "file_count", "skipped"} {
		if _, ok := job[key]; !ok {
			t.Fatalf("202 body lacks %q: %v", key, job)
		}
	}
	if job["status"] != "queued" || job["expires_at"] != nil || job["download_url"] != nil || job["file_count"] != nil {
		t.Fatalf("queued body = %v", job)
	}
	if skipped, ok := job["skipped"].([]any); !ok || len(skipped) != 0 {
		t.Fatalf("queued skipped = %#v, want []", job["skipped"])
	}
	id := job["id"].(string)

	// Not ready: the poll says queued and the download route has nothing.
	if res, got := doJSON(t, z.srv, "GET", z.base()+"/"+id, z.token, nil); res.StatusCode != 200 || got["status"] != "queued" {
		t.Fatalf("poll = %d %v", res.StatusCode, got)
	}
	if res, _ := doJSON(t, z.srv, "GET", z.base()+"/"+id+"/download", z.token, nil); res.StatusCode != 404 {
		t.Fatalf("early download = %d, want 404", res.StatusCode)
	}

	z.build(t, id)
	res, got := doJSON(t, z.srv, "GET", z.base()+"/"+id, z.token, nil)
	if res.StatusCode != 200 || got["status"] != "ready" || got["file_count"] != float64(2) || got["error"] != nil {
		t.Fatalf("ready poll = %d %v", res.StatusCode, got)
	}
	if got["expires_at"] == nil {
		t.Fatalf("ready poll has no expires_at: %v", got)
	}
	wantURL := z.base() + "/" + id + "/download"
	if got["download_url"] != wantURL {
		t.Fatalf("download_url = %v, want %s", got["download_url"], wantURL)
	}
	skipped := got["skipped"].([]any)
	if len(skipped) != 2 {
		t.Fatalf("skipped = %v", skipped)
	}
	reasons := map[string]string{}
	for _, s := range skipped {
		m := s.(map[string]any)
		reasons[m["document_id"].(string)] = m["reason"].(string)
		if len(m) != 2 {
			t.Fatalf("skip carries more than document_id and reason: %v", m)
		}
	}
	if reasons[page] != "not_a_file" || reasons[missing] != "not_found" {
		t.Fatalf("skip reasons = %v", reasons)
	}

	req, _ := http.NewRequest("GET", z.srv.URL+got["download_url"].(string), nil)
	req.Header.Set("Authorization", "Bearer "+z.token)
	dl, err := z.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(dl.Body)
	dl.Body.Close()
	if dl.StatusCode != 200 || dl.Header.Get("Content-Type") != "application/zip" || !strings.HasPrefix(dl.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("download = %d %v", dl.StatusCode, dl.Header)
	}
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]string{}
	for _, f := range zr.File {
		r, _ := f.Open()
		raw, _ := io.ReadAll(r)
		r.Close()
		names[f.Name] = string(raw)
	}
	if names["Plan.md"] != "plan-bytes" || names["Budget.md"] != "budget-bytes" || len(names) != 2 {
		t.Fatalf("zip entries = %v", names)
	}

	// Only the creator: another member and an outsider read nothing.
	memberTok, _ := docsJoinWorkspace(t, z.docsWorld, "dl-member@example.com")
	for name, tok := range map[string]string{"member": memberTok, "outsider": z.outsider} {
		for _, p := range []string{"", "/download"} {
			if res, _ := doJSON(t, z.srv, "GET", z.base()+"/"+id+p, tok, nil); res.StatusCode != 404 {
				t.Fatalf("%s GET %q = %d, want 404", name, p, res.StatusCode)
			}
		}
	}
	if res, _ := doJSON(t, z.srv, "GET", z.base()+"/"+id, "", nil); res.StatusCode != 401 {
		t.Fatalf("anonymous GET = %d, want 401", res.StatusCode)
	}

	// After the window: expired, no link, 410 on the old one.
	if _, err := testPool.Exec(context.Background(), `UPDATE document_download_jobs SET expires_at = now() - interval '1 minute' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	res, got = doJSON(t, z.srv, "GET", z.base()+"/"+id, z.token, nil)
	if res.StatusCode != 200 || got["status"] != "expired" || got["download_url"] != nil {
		t.Fatalf("expired poll = %d %v", res.StatusCode, got)
	}
	res, got = doJSON(t, z.srv, "GET", z.base()+"/"+id+"/download", z.token, nil)
	if code, _ := errCodeClass(got); res.StatusCode != 410 || code != "document_download_expired" {
		t.Fatalf("expired download = %d %v", res.StatusCode, got)
	}
}

func TestDocumentDownloadJobRefusals(t *testing.T) {
	z := newZipWorld(t)
	a := z.upload(t, "One", "one.md", "1")
	many := make([]string, 101)
	for i := range many {
		many[i] = util.NewID()
	}
	for name, ids := range map[string][]string{
		"empty": {}, "101 ids": many, "duplicates": {a, a}, "not an id": {"nope"},
	} {
		res, out := doJSON(t, z.srv, "POST", z.base(), z.token, map[string]any{"document_ids": ids})
		if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
			t.Fatalf("%s = %d %v, want 400 invalid_request", name, res.StatusCode, out)
		}
	}
	if res, out := doJSON(t, z.srv, "POST", z.base(), z.token, map[string]any{}); res.StatusCode != 400 {
		t.Fatalf("missing document_ids = %d %v, want 400", res.StatusCode, out)
	}

	if _, err := testPool.Exec(context.Background(), `UPDATE document_versions SET size_bytes = $2 WHERE document_id = $1`, a, int64(1<<30)+1); err != nil {
		t.Fatal(err)
	}
	res, out := doJSON(t, z.srv, "POST", z.base(), z.token, map[string]any{"document_ids": []string{a}})
	code, _ := errCodeClass(out)
	fields, _ := out["error"].(map[string]any)["fields"].(map[string]any)
	if res.StatusCode != 422 || code != "download_too_large" || fields["max_bytes"] != float64(1<<30) {
		t.Fatalf("too large = %d %v, want 422 download_too_large with max_bytes", res.StatusCode, out)
	}

	if res, _ := doJSON(t, z.srv, "POST", z.base(), z.outsider, map[string]any{"document_ids": []string{a}}); res.StatusCode != 403 && res.StatusCode != 404 {
		t.Fatalf("outsider POST = %d, want 403/404", res.StatusCode)
	}
	if res, _ := doJSON(t, z.srv, "POST", z.base(), "", map[string]any{"document_ids": []string{a}}); res.StatusCode != 401 {
		t.Fatalf("anonymous POST = %d, want 401", res.StatusCode)
	}
}

// A creator with two jobs in flight gets 429 download_jobs_busy with
// Retry-After 30; a settled job frees the slot.
func TestDocumentDownloadJobBusyRefusal(t *testing.T) {
	z := newZipWorld(t)
	a := z.upload(t, "One", "one.md", "1")
	var ids []string
	for i := 0; i < 2; i++ {
		res, out := doJSON(t, z.srv, "POST", z.base(), z.token, map[string]any{"document_ids": []string{a}})
		if res.StatusCode != 202 {
			t.Fatalf("job %d = %d %v, want 202", i, res.StatusCode, out)
		}
		ids = append(ids, out["id"].(string))
	}
	res, out := doJSON(t, z.srv, "POST", z.base(), z.token, map[string]any{"document_ids": []string{a}})
	code, _ := errCodeClass(out)
	fields, _ := out["error"].(map[string]any)["fields"].(map[string]any)
	if res.StatusCode != 429 || code != "download_jobs_busy" || fields["retry_after"] != float64(30) || res.Header.Get("Retry-After") != "30" {
		t.Fatalf("third job = %d %v retry-after %q, want 429 download_jobs_busy / 30", res.StatusCode, out, res.Header.Get("Retry-After"))
	}
	z.build(t, ids[0])
	if res, out := doJSON(t, z.srv, "POST", z.base(), z.token, map[string]any{"document_ids": []string{a}}); res.StatusCode != 202 {
		t.Fatalf("after a job settled = %d %v, want 202", res.StatusCode, out)
	}
}
