package handler

import (
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
)

// TestCommitIntentLookupRoute: GET /documents/{id}/versions/commit answers a
// commit by its Idempotency-Key header (G5-07): committed with the version and
// revision, 410 commit_intent_unknown with no error_class for a key the server
// holds nothing for, 400 without the header, 404 for an outsider; with
// office_sync_write off a new commit is 403 office_capability_off while the
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

	setFlagOverride(t, "office_sync_write", featureflags.ScopeOrganization, w.orgID, false)
	t.Cleanup(func() { clearFlagOverride(t, "office_sync_write", featureflags.ScopeOrganization, w.orgID) })
	up3 := upload("v3.txt", "intent v3\n", "ci-up-2")
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+id+"/versions/commit", w.token,
		map[string]string{"Idempotency-Key": "ci-commit-2"}, map[string]any{"upload_id": up3, "base_revision": committedRev})
	if code, class := errCodeClass(out); res.StatusCode != 403 || code != "office_capability_off" || class != "" {
		t.Fatalf("flag off commit: %d code=%q class=%q", res.StatusCode, code, class)
	}
	if fields, _ := out["error"].(map[string]any)["fields"].(map[string]any); fields["capability"] != "sync_write" {
		t.Fatalf("flag off fields: %v", out)
	}
	if status, got := lookup(w.token, "ci-commit-1"); status != 200 || got["outcome"] != "committed" {
		t.Fatalf("lookup with the flag off: %d %v", status, got)
	}
}
