package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// postChunked sends a body without a Content-Length, as a chunked request does
// (the server sees ContentLength -1).
func postChunked(t *testing.T, srv *httptest.Server, path, token, body string) (*http.Response, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+path, io.NopCloser(strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	raw, _ := readAll(res)
	_ = json.Unmarshal(raw, &out)
	return res, out
}

// The restore body names the version the person saw. A chunked request has no
// length, so the handler may not take "no length" for "no body".
func TestRestoreMeetingReadsAChunkedBody(t *testing.T) {
	srv := newTestServer(t)
	token, wsID := newListWorkspace(t, srv, "restore-body")
	start := time.Now().Add(24 * time.Hour)
	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings", token, map[string]any{
		"title": "Giao ban", "starts_at": start.UTC().Format(time.RFC3339), "ends_at": start.Add(time.Hour).UTC().Format(time.RFC3339),
	})
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	id := out["meeting"].(map[string]any)["id"].(string)
	if res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+id+"/cancel", token, map[string]any{"reason": "nhầm"}); res.StatusCode != http.StatusOK {
		t.Fatalf("cancel: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+id, token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get: %d %v", res.StatusCode, out)
	}
	version := int(out["meeting"].(map[string]any)["version"].(float64))

	// A stale version in a chunked body is a conflict, not a restore.
	res, out = postChunked(t, srv, "/api/v1/meetings/"+id+"/restore", token, `{"version":`+strconv.Itoa(version-1)+`}`)
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("restore at a stale version in a chunked body: %d %v, want 409", res.StatusCode, out)
	}
	if _, got := doJSON(t, srv, "GET", "/api/v1/meetings/"+id, token, nil); got["meeting"].(map[string]any)["status"] != "CANCELED" {
		t.Fatalf("the refused restore wrote: %v", got)
	}
	// The current version, chunked, restores; so does a request with no body.
	if res, out = postChunked(t, srv, "/api/v1/meetings/"+id+"/restore", token, `{"version":`+strconv.Itoa(version)+`}`); res.StatusCode != http.StatusOK {
		t.Fatalf("restore at the current version in a chunked body: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+id+"/cancel", token, nil); res.StatusCode != http.StatusOK {
		t.Fatalf("cancel again: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+id+"/restore", token, nil); res.StatusCode != http.StatusOK {
		t.Fatalf("restore without a body: %d %v", res.StatusCode, out)
	}
}
