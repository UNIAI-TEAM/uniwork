package handler

// HTTP proof of the FileService read path (T4, UNI-742): the resolve route
// and the ticketed proxy route on the real FileService, the test database and
// the local adapter. The service tests pin isolation, TTL caps and the batch
// rule; these pin the wire - status codes, headers, Range/HEAD, and that a
// ticket stops working the moment its session or membership does.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

var filesPNG = append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{7}, 92)...)

type filesWorld struct {
	srv      *httptest.Server
	fs       *service.FileService
	token    string
	userID   string
	orgID    string
	wsID     string
	outsider string
}

func newFilesWorld(t *testing.T) *filesWorld {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	stores, err := storage.BuildStores(context.Background(),
		storage.Config{Backend: storage.BackendLocal, Local: &storage.LocalConfig{Root: t.TempDir()}}, storage.NewDefaultRegistry())
	if err != nil {
		t.Fatal(err)
	}
	fs, err := service.NewFileService(service.FileServiceOptions{Pool: pool, Store: stores[storage.BackendLocal], SpoolDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	access, err := service.NewFileAccessService(service.FileAccessOptions{
		Files: fs, Workspaces: d.Workspaces, Secret: []byte("t4-handler-secret-t4-handler-secret"),
	})
	if err != nil {
		t.Fatal(err)
	}
	d.FileAccess = access
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	w := &filesWorld{srv: srv, fs: fs}
	w.token, w.userID = filesRegister(t, srv, "files-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "Files Org", "slug": "files-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/workspaces", w.token, map[string]string{"name": "Files WS", "slug": "files-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	w.wsID = out["workspace"].(map[string]any)["id"].(string)
	w.outsider, _ = filesRegister(t, srv, "files-outsider@example.com")
	return w
}

func filesRegister(t *testing.T, srv *httptest.Server, email string) (string, string) {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": email, "password": "password123", "display_name": "Files",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)
	return token, out["user"].(map[string]any)["id"].(string)
}

func (w *filesWorld) stage(t *testing.T, key string) files.FileID {
	t.Helper()
	up, err := w.fs.Upload(context.Background(), files.UploadInput{
		Actor: audit.User(w.userID), Purpose: files.TaskAttachment,
		Scope:          files.Scope{OrganizationID: w.orgID, WorkspaceID: w.wsID},
		IdempotencyKey: key, Filename: "ảnh.png", Body: bytes.NewReader(filesPNG),
	})
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	return up.File.ID
}

type resolveItem struct {
	FileID       string          `json:"file_id"`
	File         json.RawMessage `json:"file"`
	Access       string          `json:"access"`
	URL          string          `json:"url"`
	URLExpiresAt *string         `json:"url_expires_at"`
	Error        *struct {
		Code string `json:"code"`
	} `json:"error"`
}

func (w *filesWorld) resolve(t *testing.T, token string, body any) (int, []resolveItem, http.Header) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, w.srv.URL+"/api/v1/workspaces/"+w.wsID+"/files/resolve", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out struct {
		Items []resolveItem `json:"items"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out.Items, res.Header
}

func (w *filesWorld) fetch(t *testing.T, method, url string, header map[string]string) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest(method, w.srv.URL+url, nil)
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, b
}

func TestFilesResolveAndProxyOverHTTP(t *testing.T) {
	w := newFilesWorld(t)
	id := w.stage(t, "http-1")

	status, items, header := w.resolve(t, w.token, map[string]any{"file_ids": []string{string(id), "01J8ZQMISSING0000000000000"}})
	if status != http.StatusOK || len(items) != 2 {
		t.Fatalf("resolve = %d %+v", status, items)
	}
	if header.Get("Cache-Control") != "private, no-store" {
		t.Errorf("resolve Cache-Control = %q", header.Get("Cache-Control"))
	}
	item := items[0]
	if item.Error != nil || item.Access != "proxy" || item.URLExpiresAt == nil || !strings.Contains(string(item.File), `"filename":"ảnh.png"`) {
		t.Fatalf("item = %+v file=%s", item, item.File)
	}
	if strings.Contains(string(item.File), "object_key") || strings.Contains(item.URL, "v1/orgs/") {
		t.Fatalf("the storage locator leaked: %s %s", item.File, item.URL)
	}
	if items[1].Error == nil || items[1].Error.Code != "file_not_found" || items[1].URL != "" || string(items[1].File) != "null" {
		t.Fatalf("missing id = %+v", items[1])
	}

	// 200: the whole file, with no Bearer header (as a native <img> fetches).
	res, body := w.fetch(t, http.MethodGet, item.URL, nil)
	if res.StatusCode != http.StatusOK || !bytes.Equal(body, filesPNG) {
		t.Fatalf("GET = %d, %d bytes", res.StatusCode, len(body))
	}
	for k, want := range map[string]string{
		"Content-Type":           "image/png",
		"Content-Length":         "100",
		"Accept-Ranges":          "bytes",
		"X-Content-Type-Options": "nosniff",
		"Cache-Control":          "private, no-store",
	} {
		if got := res.Header.Get(k); got != want {
			t.Errorf("GET %s = %q, want %q", k, got, want)
		}
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "inline;") || !strings.Contains(cd, "filename*=UTF-8''%E1%BA%A3nh.png") {
		t.Errorf("Content-Disposition = %q", cd)
	}

	// HEAD: the same headers, no body.
	res, body = w.fetch(t, http.MethodHead, item.URL, nil)
	if res.StatusCode != http.StatusOK || len(body) != 0 || res.Header.Get("Content-Length") != "100" {
		t.Fatalf("HEAD = %d, %d bytes, length %q", res.StatusCode, len(body), res.Header.Get("Content-Length"))
	}

	// 206: one window, for seeking audio/video.
	res, body = w.fetch(t, http.MethodGet, item.URL, map[string]string{"Range": "bytes=10-19"})
	if res.StatusCode != http.StatusPartialContent || !bytes.Equal(body, filesPNG[10:20]) ||
		res.Header.Get("Content-Range") != "bytes 10-19/100" || res.Header.Get("Content-Length") != "10" {
		t.Fatalf("Range = %d %q %q", res.StatusCode, res.Header.Get("Content-Range"), body)
	}
	res, _ = w.fetch(t, http.MethodHead, item.URL, map[string]string{"Range": "bytes=-5"})
	if res.StatusCode != http.StatusPartialContent || res.Header.Get("Content-Range") != "bytes 95-99/100" {
		t.Fatalf("HEAD suffix range = %d %q", res.StatusCode, res.Header.Get("Content-Range"))
	}

	// 416: past the end, with the size for the client to retry correctly.
	for _, rng := range []string{"bytes=100-", "bytes=5-2", "lines=1-2", "bytes=0-1,4-5"} {
		res, _ = w.fetch(t, http.MethodGet, item.URL, map[string]string{"Range": rng})
		if res.StatusCode != http.StatusRequestedRangeNotSatisfiable || res.Header.Get("Content-Range") != "bytes */100" {
			t.Errorf("Range %q = %d %q, want 416 bytes */100", rng, res.StatusCode, res.Header.Get("Content-Range"))
		}
	}

	// A ticket for another file, a tampered one and none at all look missing.
	other := w.stage(t, "http-2")
	ticket := item.URL[strings.Index(item.URL, "?"):]
	for _, url := range []string{
		"/api/v1/files/" + string(other) + "/content" + ticket,
		item.URL + "x",
		"/api/v1/files/" + string(id) + "/content",
	} {
		if res, _ := w.fetch(t, http.MethodGet, url, nil); res.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", url, res.StatusCode)
		}
	}
}

func TestFilesProxyClosesWithTheSession(t *testing.T) {
	w := newFilesWorld(t)
	id := w.stage(t, "session-1")
	_, items, _ := w.resolve(t, w.token, map[string]any{"file_ids": []string{string(id)}})
	if len(items) != 1 || items[0].URL == "" {
		t.Fatalf("resolve = %+v", items)
	}
	if res, _ := w.fetch(t, http.MethodGet, items[0].URL, nil); res.StatusCode != http.StatusOK {
		t.Fatalf("before revoke = %d", res.StatusCode)
	}
	res, out := doJSON(t, w.srv, "GET", "/api/v1/me/sessions", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("sessions: %d %v", res.StatusCode, out)
	}
	sessions, _ := out["sessions"].([]any)
	for _, s := range sessions {
		sid, _ := s.(map[string]any)["session_id"].(string)
		if sid == "" {
			sid, _ = s.(map[string]any)["id"].(string)
		}
		req, _ := http.NewRequest(http.MethodDelete, w.srv.URL+"/api/v1/me/sessions/"+sid, nil)
		req.Header.Set("Authorization", "Bearer "+w.token)
		if r, err := w.srv.Client().Do(req); err == nil {
			_ = r.Body.Close()
		}
	}
	if res, _ := w.fetch(t, http.MethodGet, items[0].URL, nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("after revoking the session = %d, want 404", res.StatusCode)
	}
}

func TestFilesResolveGateAndValidation(t *testing.T) {
	w := newFilesWorld(t)
	id := w.stage(t, "gate-1")

	if status, _, _ := w.resolve(t, w.outsider, map[string]any{"file_ids": []string{string(id)}}); status != http.StatusForbidden {
		t.Fatalf("outsider = %d, want 403", status)
	}
	many := make([]string, service.MaxFileAccessBatch+1)
	for i := range many {
		many[i] = string(id)
	}
	for name, body := range map[string]any{
		"no ids":          map[string]any{"file_ids": []string{}},
		"too many ids":    map[string]any{"file_ids": many},
		"bad disposition": map[string]any{"file_ids": []string{string(id)}, "disposition": "download"},
		"not json":        "nope",
	} {
		if status, _, _ := w.resolve(t, w.token, body); status != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", name, status)
		}
	}
	req, _ := http.NewRequest(http.MethodPost, w.srv.URL+"/api/v1/workspaces/"+w.wsID+"/files/resolve", strings.NewReader(`{"file_ids":["x"]}`))
	res, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no bearer = %d, want 401", res.StatusCode)
	}
}

func TestFilesRoutesWithoutFileAccessAnswer501(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000"}, Log: slog.Default()})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/files/01J8ZQ/content?ticket=x", nil))
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("content without FileAccess = %d, want 501", rec.Code)
	}
}
