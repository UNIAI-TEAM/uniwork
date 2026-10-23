package storage

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestLocalStorage_Upload(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)
	os.Unsetenv("LOCAL_UPLOAD_BASE_URL")
	// No LOCAL_UPLOAD_BASE_URL set - should return relative path

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	ctx := context.Background()
	data := []byte("hello world")
	contentType := "text/plain"
	filename := "test.txt"

	link, err := store.Upload(ctx, "test-key.txt", data, contentType, filename)
	if err != nil {
		t.Fatalf("Upload failed: %v", err)
	}

	expectedLink := "/uploads/test-key.txt"
	if link != expectedLink {
		t.Errorf("link = %q, want %q", link, expectedLink)
	}

	filePath := filepath.Join(tmpDir, "test-key.txt")
	stored, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("failed to read uploaded file: %v", err)
	}
	if string(stored) != string(data) {
		t.Errorf("stored data = %q, want %q", stored, data)
	}
}

func TestLocalStorage_Upload_WithBaseURL(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "http://localhost:8080")

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	ctx := context.Background()
	data := []byte("hello world")
	contentType := "text/plain"
	filename := "test.txt"

	link, err := store.Upload(ctx, "test-key.txt", data, contentType, filename)
	if err != nil {
		t.Fatalf("Upload failed: %v", err)
	}

	// When LOCAL_UPLOAD_BASE_URL is set, should return full URL
	expectedLink := "http://localhost:8080/uploads/test-key.txt"
	if link != expectedLink {
		t.Errorf("link = %q, want %q", link, expectedLink)
	}

	filePath := filepath.Join(tmpDir, "test-key.txt")
	stored, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("failed to read uploaded file: %v", err)
	}
	if string(stored) != string(data) {
		t.Errorf("stored data = %q, want %q", stored, data)
	}
}

func TestLocalStorage_Delete(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	ctx := context.Background()
	data := []byte("hello world")

	_, err := store.Upload(ctx, "delete-me.txt", data, "text/plain", "delete-me.txt")
	if err != nil {
		t.Fatalf("Upload failed: %v", err)
	}

	filePath := filepath.Join(tmpDir, "delete-me.txt")
	if _, err := os.ReadFile(filePath); err != nil {
		t.Fatalf("file should exist: %v", err)
	}

	store.Delete(ctx, "delete-me.txt")

	if _, err := os.ReadFile(filePath); !os.IsNotExist(err) {
		t.Errorf("file should be deleted")
	}
}

func TestLocalStorage_KeyFromURL(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)
	// No baseURL set

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	tests := []struct {
		name     string
		rawURL   string
		expected string
	}{
		{"local URL format", "/uploads/abc123.png", "abc123.png"},
		{"local URL with subdir", "/uploads/2024/01/image.jpg", "2024/01/image.jpg"},
		{"local URL with workspace prefix", "/uploads/workspaces/ws-123/abc.png", "workspaces/ws-123/abc.png"},
		{"just filename", "abc123.png", "abc123.png"},
		{"full path", "/some/path/to/file.pdf", "file.pdf"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := store.KeyFromURL(tc.rawURL)
			if got != tc.expected {
				t.Errorf("KeyFromURL(%q) = %q, want %q", tc.rawURL, got, tc.expected)
			}
		})
	}
}

func TestLocalStorage_KeyFromURL_WithBaseURL(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "http://localhost:8080")

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	tests := []struct {
		name     string
		rawURL   string
		expected string
	}{
		{"full URL format", "http://localhost:8080/uploads/abc123.png", "abc123.png"},
		{"full URL with subdir", "http://localhost:8080/uploads/2024/01/image.jpg", "2024/01/image.jpg"},
		{"local URL format still works", "/uploads/abc123.png", "abc123.png"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := store.KeyFromURL(tc.rawURL)
			if got != tc.expected {
				t.Errorf("KeyFromURL(%q) = %q, want %q", tc.rawURL, got, tc.expected)
			}
		})
	}
}

func TestLocalStorage_DeleteKeys(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	ctx := context.Background()
	data := []byte("hello world")

	keys := []string{"file1.txt", "file2.txt", "file3.txt"}
	for _, key := range keys {
		_, err := store.Upload(ctx, key, data, "text/plain", key)
		if err != nil {
			t.Fatalf("Upload %s failed: %v", key, err)
		}
	}

	store.DeleteKeys(ctx, keys)

	for _, key := range keys {
		filePath := filepath.Join(tmpDir, key)
		if _, err := os.ReadFile(filePath); !os.IsNotExist(err) {
			t.Errorf("file %s should be deleted", key)
		}
	}
}

func TestLocalStorage_KeyFromURL_Empty(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	if got := store.KeyFromURL(""); got != "" {
		t.Errorf("KeyFromURL(\"\") = %q, want empty string", got)
	}
}

// TestLocalStorage_ServeFile_ContentDispositionFromSidecar verifies the fix
// for issue #2442: downloads served from /uploads/* must carry the original
// uploaded filename in Content-Disposition, mirroring the S3 Upload path's
// existing ContentDisposition behavior. Without this, browsers fall back to
// the storage-key basename (UUID + ext) for the download filename.
func TestLocalStorage_ServeFile_ContentDispositionFromSidecar(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	cases := []struct {
		name        string
		key         string
		contentType string
		filename    string
		wantHeader  string
	}{
		{
			name:        "attachment for non-inline type",
			key:         "workspaces/ws-1/abc.xlsx",
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			filename:    "Bwave JE_V1.xlsx",
			wantHeader:  `attachment; filename="Bwave JE_V1.xlsx"`,
		},
		{
			name:        "inline for image",
			key:         "workspaces/ws-1/def.png",
			contentType: "image/png",
			filename:    "screenshot 2026-05-11.png",
			wantHeader:  `inline; filename="screenshot 2026-05-11.png"`,
		},
		{
			name:        "filename with header-injection characters is sanitized",
			key:         "workspaces/ws-1/ghi.txt",
			contentType: "text/plain",
			filename:    "weird\";name.txt",
			wantHeader:  `attachment; filename="weird__name.txt"`,
		},
		{
			// SVG can carry <script>/onload — never serve inline.
			name:        "attachment for svg (stored-XSS prevention)",
			key:         "workspaces/ws-1/jkl.svg",
			contentType: "image/svg+xml",
			filename:    "logo.svg",
			wantHeader:  `attachment; filename="logo.svg"`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			if _, err := store.Upload(ctx, tc.key, []byte("body"), tc.contentType, tc.filename); err != nil {
				t.Fatalf("Upload failed: %v", err)
			}

			req := httptest.NewRequest(http.MethodGet, "/uploads/"+tc.key, nil)
			rec := httptest.NewRecorder()
			store.ServeFile(rec, req, tc.key)

			got := rec.Header().Get("Content-Disposition")
			if got != tc.wantHeader {
				t.Errorf("Content-Disposition = %q, want %q", got, tc.wantHeader)
			}
		})
	}
}

// TestLocalStorage_ServeFile_NoSidecarFallback documents the graceful
// degradation path: files uploaded before the sidecar landed (or written
// out-of-band) have no .meta.json on disk and ServeFile must not set
// Content-Disposition — leaving the existing pre-fix behavior intact.
func TestLocalStorage_ServeFile_NoSidecarFallback(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	key := "legacy-no-sidecar.txt"
	if err := os.WriteFile(filepath.Join(tmpDir, key), []byte("body"), 0644); err != nil {
		t.Fatalf("seed write failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/uploads/"+key, nil)
	rec := httptest.NewRecorder()
	store.ServeFile(rec, req, key)

	if got := rec.Header().Get("Content-Disposition"); got != "" {
		t.Errorf("Content-Disposition = %q, want empty (no sidecar fallback)", got)
	}
}

// TestLocalStorage_ServeFile_RejectsSidecarSuffix verifies that the sidecar
// JSON itself is not addressable via /uploads/*. The sidecar is an
// implementation detail; exposing it would turn the filename + content-type
// pair into a stable read API and make any future ACL change leakier than
// the data file it sits next to.
func TestLocalStorage_ServeFile_RejectsSidecarSuffix(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	ctx := context.Background()
	if _, err := store.Upload(ctx, "abc.xlsx", []byte("body"), "text/plain", "real.xlsx"); err != nil {
		t.Fatalf("Upload failed: %v", err)
	}

	sidecarKey := "abc.xlsx" + metaSuffix
	req := httptest.NewRequest(http.MethodGet, "/uploads/"+sidecarKey, nil)
	rec := httptest.NewRecorder()
	store.ServeFile(rec, req, sidecarKey)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
	if got := rec.Header().Get("Content-Disposition"); got != "" {
		t.Errorf("Content-Disposition = %q, want empty", got)
	}
}

// TestLocalStorage_ServeFile_RejectsPathTraversal documents that a key
// pointing outside uploadDir is rejected before any sidecar read. Without
// this guard, readLocalMeta would attempt a disk read at <some-path>.meta.json
// before http.ServeFile's own ".." check fires on r.URL.Path.
func TestLocalStorage_ServeFile_RejectsPathTraversal(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	// Seed a sidecar OUTSIDE uploadDir so we'd notice if it were read: the
	// header would carry "leaked.xlsx". Locating the sibling inside the
	// per-test TempDir keeps the test self-contained — no real /etc reads.
	parentDir := filepath.Dir(tmpDir)
	leakedBase := filepath.Join(parentDir, "leaked-target")
	if err := os.WriteFile(leakedBase+metaSuffix, []byte(`{"filename":"leaked.xlsx","content_type":"text/plain"}`), 0644); err != nil {
		t.Fatalf("seed leaked sidecar failed: %v", err)
	}
	t.Cleanup(func() {
		os.Remove(leakedBase + metaSuffix)
	})

	traversal := "../" + filepath.Base(leakedBase)
	req := httptest.NewRequest(http.MethodGet, "/uploads/"+traversal, nil)
	rec := httptest.NewRecorder()
	store.ServeFile(rec, req, traversal)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
	if got := rec.Header().Get("Content-Disposition"); got != "" {
		t.Errorf("Content-Disposition = %q, want empty (sidecar must not leak)", got)
	}
}

// TestLocalStorage_Upload_SkipsSidecarWhenFilenameEmpty verifies the tighter
// Upload gate: a write with no filename has nothing useful to preserve, so
// we shouldn't litter the upload directory with content-type-only sidecars
// that ServeFile would ignore anyway.
func TestLocalStorage_Upload_SkipsSidecarWhenFilenameEmpty(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	ctx := context.Background()
	key := "no-filename.bin"
	if _, err := store.Upload(ctx, key, []byte("body"), "application/octet-stream", ""); err != nil {
		t.Fatalf("Upload failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(tmpDir, key+metaSuffix)); !os.IsNotExist(err) {
		t.Errorf("sidecar should not exist when filename is empty, got err=%v", err)
	}
}

// TestLocalStorage_Delete_RemovesSidecar verifies the cleanup half of the
// fix: when the upload is deleted, its sidecar metadata file disappears too.
// Otherwise the upload directory grows orphan .meta.json files forever.
func TestLocalStorage_Delete_RemovesSidecar(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	ctx := context.Background()
	key := "deleteme.txt"
	if _, err := store.Upload(ctx, key, []byte("body"), "text/plain", "original.txt"); err != nil {
		t.Fatalf("Upload failed: %v", err)
	}
	sidecar := filepath.Join(tmpDir, key+metaSuffix)
	if _, err := os.Stat(sidecar); err != nil {
		t.Fatalf("sidecar should exist after Upload: %v", err)
	}

	store.Delete(ctx, key)

	if _, err := os.Stat(sidecar); !os.IsNotExist(err) {
		t.Errorf("sidecar should be removed after Delete, got err=%v", err)
	}
}

// GetReader returns the uploaded bytes verbatim — used by the preview proxy.
func TestLocalStorage_GetReader_RoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	ctx := context.Background()
	key := "preview.md"
	body := []byte("# hello\nworld\n")
	if _, err := store.Upload(ctx, key, body, "text/markdown", "preview.md"); err != nil {
		t.Fatalf("Upload failed: %v", err)
	}

	rc, err := store.GetReader(ctx, key)
	if err != nil {
		t.Fatalf("GetReader: %v", err)
	}
	defer rc.Close()
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("io.ReadAll: %v", err)
	}
	if string(got) != string(body) {
		t.Errorf("body = %q, want %q", got, body)
	}
}

// Refuses path traversal at storage layer so callers don't need to defend it.
func TestLocalStorage_GetReader_RejectsTraversal(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	if rc, err := store.GetReader(context.Background(), "../../../etc/passwd"); err == nil {
		rc.Close()
		t.Fatal("GetReader should refuse traversal keys")
	}
}

// The sidecar JSON is an internal detail. Allowing /content to read it via a
// crafted key would expose the original filename + content-type stored next
// to every upload.
func TestLocalStorage_GetReader_RejectsSidecarSuffix(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	if rc, err := store.GetReader(context.Background(), "some-key.txt"+metaSuffix); err == nil {
		rc.Close()
		t.Fatal("GetReader should refuse sidecar keys")
	}
}

// Missing key surfaces as a plain error — the handler maps it to 404.
func TestLocalStorage_GetReader_MissingKey(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", tmpDir)

	store := NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("NewLocalStorageFromEnv returned nil")
	}

	if rc, err := store.GetReader(context.Background(), "nonexistent.txt"); err == nil {
		rc.Close()
		t.Fatal("GetReader should error on missing key")
	}
}

// FileService objects share LOCAL_UPLOAD_DIR with the legacy objects, but the
// /uploads/* route authorizes nobody: a v1/ key must never come back from it,
// however the path is spelled. A legacy object next to it still does.
func TestServeFileRefusesFileServiceObjects(t *testing.T) {
	dir := t.TempDir()
	store := &LocalStorage{uploadDir: dir}
	write := func(key string) {
		t.Helper()
		p := filepath.Join(dir, key)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("secret"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	tenantKey := "v1/orgs/01ORG/workspaces/01WS/task-attachments/2026/10/01FILE/original"
	write(tenantKey)
	write("chat/files/legacy.pdf")

	for _, key := range []string{tenantKey, "./" + tenantKey, "chat/../" + tenantKey, "v1", "V1/" + strings.TrimPrefix(tenantKey, "v1/")} {
		rec := httptest.NewRecorder()
		store.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/"+key, nil), key)
		if rec.Code != http.StatusNotFound || rec.Body.String() == "secret" {
			t.Errorf("ServeFile(%q) = %d %q, want 404", key, rec.Code, rec.Body.String())
		}
	}
	rec := httptest.NewRecorder()
	store.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/chat/files/legacy.pdf", nil), "chat/files/legacy.pdf")
	if rec.Code != http.StatusOK {
		t.Errorf("legacy object = %d, want 200", rec.Code)
	}
}

// Email Hub body objects contain tenant mail content and share
// LOCAL_UPLOAD_DIR with legacy public uploads. The unauthenticated
// /uploads/* route must reject that exact namespace, including the configured
// environment root and path spellings that resolve to it, without hiding a
// public key whose segment merely contains "email-hub".
func TestServeFileRefusesEmailHubBodyObjects(t *testing.T) {
	dir := t.TempDir()
	store := &LocalStorage{uploadDir: dir, keyRoot: "develop/"}
	write := func(key string) {
		t.Helper()
		p := filepath.Join(dir, key)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("secret"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	privateKeys := []string{
		"email-hub/accounts/a/threads/t/body.v1.json.gz",
		"Email-Hub/accounts/a/threads/t/body.v1.json.gz",
		"develop/email-hub/accounts/a/threads/t/body.v1.json.gz",
		"DEVELOP/EMAIL-HUB/accounts/a/threads/t/body.v1.json.gz",
		"./email-hub/accounts/a/threads/t/body.v1.json.gz",
		"public/../email-hub/accounts/a/threads/t/body.v1.json.gz",
	}
	for _, key := range privateKeys {
		write(key)
		rec := httptest.NewRecorder()
		store.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/private-object", nil), key)
		if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "secret") {
			t.Errorf("ServeFile(%q) = %d %q, want 404", key, rec.Code, rec.Body.String())
		}
	}

	for _, key := range []string{
		"chat/files/public.pdf",
		"email-hub-public/accounts/a/file.pdf",
		"chat/email-hub/accounts/a/file.pdf",
	} {
		write(key)
		rec := httptest.NewRecorder()
		store.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/public-object", nil), key)
		if rec.Code != http.StatusOK || rec.Body.String() != "secret" {
			t.Errorf("ServeFile(%q) = %d %q, want public object", key, rec.Code, rec.Body.String())
		}
	}

	rec := httptest.NewRecorder()
	store.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/missing.pdf", nil), "missing.pdf")
	if rec.Code != http.StatusNotFound {
		t.Errorf("missing public object = %d, want 404", rec.Code)
	}
}

func createLocalDirectoryAlias(t *testing.T, target, alias string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(alias), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, alias); err != nil {
		if runtime.GOOS != "windows" {
			t.Fatalf("create in-root symlink: %v", err)
		}
		if out, junctionErr := exec.Command("cmd", "/c", "mklink", "/J", alias, target).CombinedOutput(); junctionErr != nil {
			t.Fatalf("create in-root symlink (%v) or junction (%v): %s", err, junctionErr, out)
		}
	}
}

func TestServeFileRefusesEmailHubBodyObjectsThroughFilesystemAlias(t *testing.T) {
	dir := t.TempDir()
	store := &LocalStorage{uploadDir: dir}
	privateDir := filepath.Join(dir, "email-hub")
	privateKey := filepath.Join("accounts", "a", "threads", "t", "body.v1.json.gz")
	privatePath := filepath.Join(privateDir, privateKey)
	if err := os.MkdirAll(filepath.Dir(privatePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(privatePath, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}

	alias := filepath.Join(dir, "mail-private")
	createLocalDirectoryAlias(t, privateDir, alias)

	key := filepath.ToSlash(filepath.Join(filepath.Base(alias), privateKey))
	rec := httptest.NewRecorder()
	store.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/"+key, nil), key)
	if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "secret") {
		t.Fatalf("ServeFile through private filesystem alias = %d %q, want 404", rec.Code, rec.Body.String())
	}
}

func TestServeFileKeepsLexicalPrivatePolicyAcrossReverseAlias(t *testing.T) {
	cases := []struct {
		name      string
		keyRoot   string
		alias     string
		targetDir string
		tail      string
	}{
		{
			name:      "email hub",
			alias:     "email-hub",
			targetDir: "mail-data",
			tail:      "accounts/a/threads/t/body.v1.json.gz",
		},
		{
			name:      "root-level FileService",
			alias:     "v1",
			targetDir: "file-data",
			tail:      "orgs/o/workspaces/w/task-attachments/2026/10/f/original",
		},
		{
			name:      "key-root FileService",
			keyRoot:   "develop/",
			alias:     "develop/v1",
			targetDir: "rooted-file-data",
			tail:      "orgs/o/workspaces/w/task-attachments/2026/10/f/original",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			store := &LocalStorage{uploadDir: dir, keyRoot: tc.keyRoot}
			targetDir := filepath.Join(dir, tc.targetDir)
			target := filepath.Join(targetDir, filepath.FromSlash(tc.tail))
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(target, []byte("secret"), 0o644); err != nil {
				t.Fatal(err)
			}
			createLocalDirectoryAlias(t, targetDir, filepath.Join(dir, filepath.FromSlash(tc.alias)))

			key := tc.alias + "/" + tc.tail
			rec := httptest.NewRecorder()
			store.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/"+key, nil), key)
			if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "secret") {
				t.Fatalf("ServeFile(%q) through reverse alias = %d %q, want 404", key, rec.Code, rec.Body.String())
			}

			physicalKey := tc.targetDir + "/" + tc.tail
			rec = httptest.NewRecorder()
			store.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/"+physicalKey, nil), physicalKey)
			if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "secret") {
				t.Fatalf("ServeFile(%q) through private namespace's physical target = %d %q, want 404", physicalKey, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestServeFileAllowsPublicFilesystemAlias(t *testing.T) {
	dir := t.TempDir()
	store := &LocalStorage{uploadDir: dir}
	targetDir := filepath.Join(dir, "public-data")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(targetDir, "report.pdf"), []byte("public"), 0o644); err != nil {
		t.Fatal(err)
	}
	createLocalDirectoryAlias(t, targetDir, filepath.Join(dir, "public-link"))

	const key = "public-link/report.pdf"
	rec := httptest.NewRecorder()
	store.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/"+key, nil), key)
	if rec.Code != http.StatusOK || rec.Body.String() != "public" {
		t.Fatalf("ServeFile through public alias = %d %q, want public object", rec.Code, rec.Body.String())
	}
}

func TestServeFileRefusesFilesystemAliasOutsideUploadRoot(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.bin"), []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	createLocalDirectoryAlias(t, outside, filepath.Join(dir, "outside-link"))

	store := &LocalStorage{uploadDir: dir}
	const key = "outside-link/secret.bin"
	rec := httptest.NewRecorder()
	store.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/"+key, nil), key)
	if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "outside") {
		t.Fatalf("ServeFile through outside alias = %d %q, want 404", rec.Code, rec.Body.String())
	}
}

func TestServeFileRefusesEmailHubBodyObjectsThroughWindowsShortName(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("8.3 short names are a Windows filesystem feature")
	}
	dir := t.TempDir()
	store := &LocalStorage{uploadDir: dir}
	privateDir := filepath.Join(dir, "email-hub")
	privateKey := filepath.Join("accounts", "a", "threads", "t", "body.v1.json.gz")
	privatePath := filepath.Join(privateDir, privateKey)
	if err := os.MkdirAll(filepath.Dir(privatePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(privatePath, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command("cmd", "/d", "/c", `for %I in ("`+privateDir+`") do @echo %~snxI`)
	out, err := cmd.Output()
	if err != nil {
		t.Skipf("cannot query an 8.3 alias: %v", err)
	}
	shortName := strings.TrimSpace(string(out))
	if shortName == "" || strings.EqualFold(shortName, filepath.Base(privateDir)) || strings.ContainsAny(shortName, `/\`) {
		t.Skip("the test volume does not expose an 8.3 alias for email-hub")
	}

	key := filepath.ToSlash(filepath.Join(shortName, privateKey))
	rec := httptest.NewRecorder()
	store.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/"+key, nil), key)
	if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "secret") {
		t.Fatalf("ServeFile through 8.3 alias %q = %d %q, want 404", shortName, rec.Code, rec.Body.String())
	}
}
