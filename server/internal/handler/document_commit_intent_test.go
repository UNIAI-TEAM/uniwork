package handler

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// TestCommitIntentLookupRoute: GET /documents/{id}/versions/commit answers a
// commit by its Idempotency-Key header (G5-07): committed with the version and
// revision, 410 commit_intent_unknown with no error_class for a key the server
// holds nothing for, 400 without the header, 404 for an outsider; with
// office_sync_write off a device session's new commit is 403
// office_capability_off while a browser session still commits and the
// committed key still reads.
func TestCommitIntentLookupRoute(t *testing.T) {
	w := newDocsWorld(t)
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files", w.token,
		map[string]string{"title": "intent.txt"}, "intent.txt", []byte("intent v1\n"), map[string]string{"Idempotency-Key": "ci-create"})
	if res.StatusCode != 201 {
		t.Fatalf("create file doc: %d %s", res.StatusCode, raw)
	}
	var j map[string]any
	_ = json.Unmarshal(raw, &j)
	doc := j["document"].(map[string]any)
	id, rev := doc["id"].(string), doc["revision"].(string)
	upload := func(name, body, key string) string {
		t.Helper()
		res, raw := doMultipart(t, w.srv, "POST", "/api/v1/documents/"+id+"/uploads", w.token, nil, name, []byte(body), map[string]string{"Idempotency-Key": key})
		if res.StatusCode != 201 {
			t.Fatalf("upload: %d %s", res.StatusCode, raw)
		}
		var u map[string]any
		_ = json.Unmarshal(raw, &u)
		return u["upload_id"].(string)
	}
	lookup := func(token, key string) (int, map[string]any) {
		t.Helper()
		headers := map[string]string{}
		if key != "" {
			headers["Idempotency-Key"] = key
		}
		res, out := doJSONHeaders(t, w.srv, "GET", "/api/v1/documents/"+id+"/versions/commit", token, headers, nil)
		return res.StatusCode, out
	}

	if status, out := lookup(w.token, "ci-never"); status != 410 {
		t.Fatalf("unknown key: %d %v", status, out)
	} else if code, class := errCodeClass(out); code != "commit_intent_unknown" || class != "" {
		t.Fatalf("unknown key: code=%q class=%q", code, class)
	}
	if status, _ := lookup(w.token, ""); status != 400 {
		t.Fatalf("no key: %d, want 400", status)
	}

	up := upload("v2.txt", "intent v2\n", "ci-up-1")
	res, out := doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/commit", w.token,
		map[string]string{"Idempotency-Key": "ci-commit-1"}, map[string]any{"upload_id": up, "base_revision": rev})
	if res.StatusCode != 200 {
		t.Fatalf("commit: %d %v", res.StatusCode, out)
	}
	committedRev := out["document"].(map[string]any)["revision"].(string)
	verID := out["version"].(map[string]any)["id"].(string)

	status, got := lookup(w.token, "ci-commit-1")
	if status != 200 || got["outcome"] != "committed" || got["version_id"] != verID ||
		got["version"].(float64) != 2 || got["revision"] != committedRev {
		t.Fatalf("lookup: %d %v", status, got)
	}
	if status, _ := lookup(w.outsider, "ci-commit-1"); status != 404 {
		t.Fatalf("outsider lookup: %d, want 404", status)
	}

	// The desktop app's device session is the sync path the flag gates; a
	// browser session (w.token) is not.
	devices := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	deviceToken, err := devices.MintSession(w.userID, "ci-device-session")
	if err != nil {
		t.Fatal(err)
	}

	setFlagOverride(t, "office_sync_write", featureflags.ScopeOrganization, w.orgID, false)
	t.Cleanup(func() { clearFlagOverride(t, "office_sync_write", featureflags.ScopeOrganization, w.orgID) })
	up3 := upload("v3.txt", "intent v3\n", "ci-up-2")
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/commit", w.token,
		map[string]string{"Idempotency-Key": "ci-commit-2"}, map[string]any{"upload_id": up3, "base_revision": committedRev})
	if res.StatusCode != 200 {
		t.Fatalf("web commit with the flag off: %d %v", res.StatusCode, out)
	}
	committedRev = out["document"].(map[string]any)["revision"].(string)
	up4 := upload("v4.txt", "intent v4\n", "ci-up-3")
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/commit", deviceToken,
		map[string]string{"Idempotency-Key": "ci-commit-3"}, map[string]any{"upload_id": up4, "base_revision": committedRev})
	if code, class := errCodeClass(out); res.StatusCode != 403 || code != "office_capability_off" || class != "" {
		t.Fatalf("sync commit with the flag off: %d code=%q class=%q", res.StatusCode, code, class)
	}
	if fields, _ := out["error"].(map[string]any)["fields"].(map[string]any); fields["capability"] != "sync_write" {
		t.Fatalf("flag off fields: %v", out)
	}
	if status, got := lookup(w.token, "ci-commit-1"); status != 200 || got["outcome"] != "committed" {
		t.Fatalf("lookup with the flag off: %d %v", status, got)
	}
}

// syncedLogBuffer is a bytes.Buffer safe for the server's goroutine, used to
// capture what the request logger writes while the test reads.
type syncedLogBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncedLogBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncedLogBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// TI-8: the Idempotency-Key never reaches the request log or an error body,
// and the header bound the POST already applies covers the GET lookup too
// (printable ASCII, at most 255 bytes - middleware.IdempotencyKeyFormat).
func TestCommitIntentKeyNeverLeaks(t *testing.T) {
	w := newDocsWorld(t)
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files", w.token,
		map[string]string{"title": "leak.txt"}, "leak.txt", []byte("leak v1\n"), nil)
	if res.StatusCode != 201 {
		t.Fatalf("create file doc: %d %s", res.StatusCode, raw)
	}
	var j map[string]any
	_ = json.Unmarshal(raw, &j)
	id := j["document"].(map[string]any)["id"].(string)

	var logs syncedLogBuffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	lookup := func(key string) (int, []byte) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, w.srv.URL+"/api/v1/documents/"+id+"/versions/commit", nil)
		req.Header.Set("Authorization", "Bearer "+w.token)
		req.Header.Set("Idempotency-Key", key)
		res, err := w.srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := readAll(res)
		return res.StatusCode, body
	}

	key := "ci-leak-" + util.NewID()
	status, body := lookup(key)
	if status != 410 || !bytes.Contains(body, []byte("commit_intent_unknown")) {
		t.Fatalf("unknown key: %d %s", status, body)
	}
	if bytes.Contains(body, []byte(key)) {
		t.Fatalf("the 410 body carries the key: %s", body)
	}

	tooLong := strings.Repeat("k", 256)
	status, body = lookup(tooLong)
	if status != 400 || !bytes.Contains(body, []byte("invalid_request")) {
		t.Fatalf("over-long key: %d %s", status, body)
	}
	if bytes.Contains(body, []byte(tooLong)) {
		t.Fatalf("the 400 body carries the key: %s", body)
	}

	// The access line is written after the response leaves; wait for it before
	// reading the buffer.
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(logs.String(), "versions/commit") {
		if time.Now().After(deadline) {
			t.Fatalf("no access log line for the lookup: %s", logs.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
	if logged := logs.String(); strings.Contains(logged, key) || strings.Contains(logged, tooLong) {
		t.Fatalf("the request log carries the key: %s", logged)
	}
}
