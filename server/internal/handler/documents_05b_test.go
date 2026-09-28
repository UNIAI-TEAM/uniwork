package handler

// Handler tests for the G1-05b Documents collection surface (UNI-679, C-01
// §5.1): list/search/tree, move, archive/restore, org settings. Every case
// drives the real Chi router over a real database with a real DocumentService
// (only the object store is faked), so the flag gate, RequireMember, cursor
// and error envelope are the ones under test.

import (
	"context"
	"encoding/json"
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

// docsCreatePageBody posts one page with a custom body (parent/visibility).
func docsCreatePageBody(t *testing.T, w *docsWorld, token string, body map[string]any) (map[string]any, string) {
	t.Helper()
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", token, body)
	if res.StatusCode != 201 {
		t.Fatalf("create page: %d %v", res.StatusCode, out)
	}
	doc := out["document"].(map[string]any)
	return doc, doc["id"].(string)
}

// docsJoinWorkspace registers a person and walks them through the real
// invitation flow into the test workspace.
func docsJoinWorkspace(t *testing.T, w *docsWorld, email string) (token, userID string) {
	t.Helper()
	token, userID = filesRegister(t, w.srv, email)
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/invitations", w.token,
		map[string]any{"emails": []string{email}, "role": "member"})
	if res.StatusCode != 200 {
		t.Fatalf("invite %s: %d %v", email, res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/me/invitations", token, nil)
	if res.StatusCode != 200 || len(out["invitations"].([]any)) == 0 {
		t.Fatalf("invitations %s: %d %v", email, res.StatusCode, out)
	}
	inviteToken := out["invitations"].([]any)[0].(map[string]any)["token"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/invitations/"+inviteToken+"/accept", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("accept %s: %d %v", email, res.StatusCode, out)
	}
	return token, userID
}

func docIDs(t *testing.T, out map[string]any) []string {
	t.Helper()
	raw, ok := out["documents"].([]any)
	if !ok {
		t.Fatalf("documents missing: %v", out)
	}
	ids := make([]string, 0, len(raw))
	for _, item := range raw {
		ids = append(ids, item.(map[string]any)["id"].(string))
	}
	return ids
}

func containsID(ids []string, id string) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

func TestDocumentListSearchTree(t *testing.T) {
	w := newDocsWorld(t)
	_, alpha := docsCreatePageBody(t, w, w.token, map[string]any{
		"title": "Alpha plan", "kind": "page",
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "unique-snippet-word nội dung"}}}}},
	})
	_, beta := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Beta notes", "kind": "page"})
	_, child := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Alpha child", "kind": "page", "parent_id": alpha})

	// Flat list sees every live document.
	res, out := doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	if ids := docIDs(t, out); len(ids) != 3 {
		t.Fatalf("flat list ids = %v", ids)
	}

	// parent_id present (empty) lists roots only; a value lists one level.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?parent_id=", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("roots: %d %v", res.StatusCode, out)
	}
	if ids := docIDs(t, out); len(ids) != 2 || !containsID(ids, alpha) || !containsID(ids, beta) {
		t.Fatalf("roots ids = %v", ids)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?parent_id="+alpha, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("children: %d %v", res.StatusCode, out)
	}
	if ids := docIDs(t, out); len(ids) != 1 || ids[0] != child {
		t.Fatalf("children ids = %v", ids)
	}

	// Search returns only the match and carries its snippet.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?q=unique-snippet-word", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("search: %d %v", res.StatusCode, out)
	}
	items := out["documents"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["id"] != alpha {
		t.Fatalf("search items = %v", items)
	}
	if snippet, _ := items[0].(map[string]any)["snippet"].(string); snippet == "" {
		t.Fatalf("search snippet missing: %v", items[0])
	}

	// Kind filter with no file documents answers an empty page.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?kind=file", w.token, nil)
	if res.StatusCode != 200 || len(docIDs(t, out)) != 0 {
		t.Fatalf("kind filter: %d %v", res.StatusCode, out)
	}

	// Cursor paging at limit=1 visits every document exactly once.
	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 5; page++ {
		path := "/api/v1/workspaces/" + w.wsID + "/documents?limit=1"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		res, out = doJSON(t, w.srv, "GET", path, w.token, nil)
		if res.StatusCode != 200 {
			t.Fatalf("page %d: %d %v", page, res.StatusCode, out)
		}
		ids := docIDs(t, out)
		for _, id := range ids {
			if seen[id] {
				t.Fatalf("cursor repeated %s on page %d", id, page)
			}
			seen[id] = true
		}
		next, _ := out["next_cursor"].(string)
		if next == "" {
			break
		}
		cursor = next
	}
	if len(seen) != 3 {
		t.Fatalf("cursor walk saw %d documents, want 3", len(seen))
	}

	// A malformed cursor and a negative limit are 400s.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?cursor=bm90LWpzb24", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("bad cursor: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?limit=-1", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("bad limit: %d code=%q", res.StatusCode, code)
	}

	// The tree nests children and never leaks an unknown root.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/tree", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("tree: %d %v", res.StatusCode, out)
	}
	tree := out["documents"].([]any)
	if len(tree) != 2 {
		t.Fatalf("tree roots = %v", tree)
	}
	var alphaNode map[string]any
	for _, n := range tree {
		if n.(map[string]any)["id"] == alpha {
			alphaNode = n.(map[string]any)
		}
	}
	if alphaNode == nil || len(alphaNode["children"].([]any)) != 1 || alphaNode["children"].([]any)[0].(map[string]any)["id"] != child {
		t.Fatalf("tree node = %v", alphaNode)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/tree?root="+alpha, w.token, nil)
	if res.StatusCode != 200 || len(out["documents"].([]any)) != 1 {
		t.Fatalf("tree branch: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/tree?root=01J8X4DOC0N1P2Q3R4S5T6U7", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("tree unknown root: %d code=%q", res.StatusCode, code)
	}

	// The archived view is manage-only; the plain list drops the trashed node.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+beta+"/archive", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("archive: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, nil)
	if ids := docIDs(t, out); containsID(ids, beta) {
		t.Fatalf("archived document still listed: %v", ids)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?archived=1", w.token, nil)
	if res.StatusCode != 200 || !containsID(docIDs(t, out), beta) {
		t.Fatalf("archived view: %d %v", res.StatusCode, out)
	}

	// Non-member and anonymous callers are refused before any row is read.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", w.outsider, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "forbidden" {
		t.Fatalf("outsider list: %d code=%q", res.StatusCode, code)
	}
	res, _ = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("anonymous list: %d, want 401", res.StatusCode)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/recent", w.outsider, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "forbidden" {
		t.Fatalf("outsider recent: %d code=%q", res.StatusCode, code)
	}
}

func TestDocumentMove(t *testing.T) {
	w := newDocsWorld(t)
	_, a := docsCreatePageBody(t, w, w.token, map[string]any{"title": "A", "kind": "page"})
	_, b := docsCreatePageBody(t, w, w.token, map[string]any{"title": "B", "kind": "page"})
	_, c := docsCreatePageBody(t, w, w.token, map[string]any{"title": "C", "kind": "page", "parent_id": a})

	// Reparent C under B.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+c+"/move", w.token, map[string]any{
		"parent_id": b, "position": 2.5, "revision": "1",
	})
	if res.StatusCode != 200 {
		t.Fatalf("move: %d %v", res.StatusCode, out)
	}
	moved := out["document"].(map[string]any)
	if moved["parent_id"] != b || moved["revision"] != "2" {
		t.Fatalf("moved doc = %v", moved)
	}

	// Move back under A, then try to move A under C: a cycle.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+c+"/move", w.token, map[string]any{
		"parent_id": a, "revision": "2",
	})
	if res.StatusCode != 200 {
		t.Fatalf("move back: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+a+"/move", w.token, map[string]any{
		"parent_id": c, "revision": "1",
	})
	if code, _ := errCodeClass(out); res.StatusCode != 422 || code != "document_cycle" {
		t.Fatalf("cycle: %d code=%q", res.StatusCode, code)
	}

	// A stale revision is refused before any tree write.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+b+"/move", w.token, map[string]any{
		"parent_id": a, "revision": "99",
	})
	if code, _ := errCodeClass(out); res.StatusCode != 422 || code != "revision_conflict" {
		t.Fatalf("stale move: %d code=%q", res.StatusCode, code)
	}

	// Cross-workspace move: a parent from another workspace in the same org.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+w.orgID+"/workspaces", w.token,
		map[string]string{"name": "Other WS", "slug": "other-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("second ws: %d %v", res.StatusCode, out)
	}
	otherWS := out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+otherWS+"/documents", w.token,
		map[string]any{"title": "foreign parent", "kind": "page"})
	if res.StatusCode != 201 {
		t.Fatalf("foreign page: %d %v", res.StatusCode, out)
	}
	foreign := out["document"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+b+"/move", w.token, map[string]any{
		"parent_id": foreign, "revision": "1",
	})
	if code, _ := errCodeClass(out); res.StatusCode != 422 || code != "cross_workspace_reference" {
		t.Fatalf("cross workspace: %d code=%q (%v)", res.StatusCode, code, out)
	}

	// Idempotent replay of one move.
	headers := map[string]string{"Idempotency-Key": "move-1"}
	res, _ = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+b+"/move", w.token, headers, map[string]any{
		"parent_id": a, "position": 1.0, "revision": "1",
	})
	if res.StatusCode != 200 {
		t.Fatalf("first keyed move: %d", res.StatusCode)
	}
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+b+"/move", w.token, headers, map[string]any{
		"parent_id": a, "position": 1.0, "revision": "1",
	})
	if res.StatusCode != 200 {
		t.Fatalf("replayed move: %d %v", res.StatusCode, out)
	}

	// An outsider learns nothing about the document.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+a+"/move", w.outsider, map[string]any{
		"parent_id": b, "revision": "1",
	})
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("outsider move: %d code=%q", res.StatusCode, code)
	}
}

func TestDocumentMoveDepthRefusedAtCreate(t *testing.T) {
	w := newDocsWorld(t)
	parent := ""
	for i := 1; i <= 6; i++ {
		body := map[string]any{"title": "level", "kind": "page"}
		if parent != "" {
			body["parent_id"] = parent
		}
		res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, body)
		if i <= 5 {
			if res.StatusCode != 201 {
				t.Fatalf("level %d create: %d %v", i, res.StatusCode, out)
			}
			parent = out["document"].(map[string]any)["id"].(string)
			continue
		}
		if code, _ := errCodeClass(out); res.StatusCode != 422 || code != "document_too_deep" {
			t.Fatalf("level 6 create: %d code=%q %v", res.StatusCode, code, out)
		}
	}
}

func TestDocumentArchiveRestore(t *testing.T) {
	w := newDocsWorld(t)
	_, root := docsCreatePageBody(t, w, w.token, map[string]any{"title": "root", "kind": "page"})
	_, child := docsCreatePageBody(t, w, w.token, map[string]any{"title": "child", "kind": "page", "parent_id": root})

	// Archive the subtree in one batch.
	headers := map[string]string{"Idempotency-Key": "arch-1"}
	res, out := doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+root+"/archive", w.token, headers, nil)
	if res.StatusCode != 200 {
		t.Fatalf("archive: %d %v", res.StatusCode, out)
	}
	batch, _ := out["batch_id"].(string)
	if batch == "" || out["document"].(map[string]any)["archived_at"] == nil {
		t.Fatalf("archive result = %v", out)
	}
	if affected, _ := out["affected"].([]any); len(affected) != 2 || !containsID(anyToStrings(affected), child) {
		t.Fatalf("archive affected = %v", out["affected"])
	}
	// Replay returns the same batch and does not double-apply.
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+root+"/archive", w.token, headers, nil)
	if res.StatusCode != 200 || out["batch_id"] != batch {
		t.Fatalf("archive replay: %d %v", res.StatusCode, out)
	}

	// Restore recovers exactly this batch.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+root+"/restore", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("restore: %d %v", res.StatusCode, out)
	}
	if out["document"].(map[string]any)["archived_at"] != nil {
		t.Fatalf("restored doc still archived: %v", out)
	}
	_, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, nil)
	if ids := docIDs(t, out); !containsID(ids, root) || !containsID(ids, child) {
		t.Fatalf("restored subtree missing: %v", ids)
	}

	// A view-only member cannot archive (manage is required).
	member, memberID := docsJoinWorkspace(t, w, "docs-arch-member@example.com")
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+root+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": memberID, "level": "view",
	})
	if res.StatusCode != 201 {
		t.Fatalf("share for archive test: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+root+"/archive", member, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "forbidden" {
		t.Fatalf("view member archive: %d code=%q", res.StatusCode, code)
	}

	// An outsider learns nothing.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+root+"/archive", w.outsider, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("outsider archive: %d code=%q", res.StatusCode, code)
	}
}

func anyToStrings(vals []any) []string {
	out := make([]string, 0, len(vals))
	for _, v := range vals {
		out = append(out, v.(string))
	}
	return out
}

func TestDocumentSettingsSwitch(t *testing.T) {
	w := newDocsWorld(t)
	member, _ := docsJoinWorkspace(t, w, "docs-settings-member@example.com")

	// The owner may flip the switch; a plain member may not.
	res, out := doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.token,
		map[string]any{"public_links_enabled": true})
	if res.StatusCode != 200 || out["public_links_enabled"] != true || out["organization_id"] != w.orgID {
		t.Fatalf("owner switch: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", member,
		map[string]any{"public_links_enabled": false})
	if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "forbidden" {
		t.Fatalf("member switch: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.outsider,
		map[string]any{"public_links_enabled": true})
	if res.StatusCode != 404 {
		t.Fatalf("outsider switch: %d %v", res.StatusCode, out)
	}
	// Flip it back off; the response reflects the stored value.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.token,
		map[string]any{"public_links_enabled": false})
	if res.StatusCode != 200 || out["public_links_enabled"] != false {
		t.Fatalf("switch off: %d %v", res.StatusCode, out)
	}
}

// TestDocuments05bFlagOff404 proves every authenticated 05b route answers the
// flag gate (404 feature_disabled) before auth or service work when the
// documents flag is off for the caller.
func TestDocuments05bFlagOff404(t *testing.T) {
	d, _ := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	token, _ := filesRegister(t, srv, "flagoff-05b@example.com")
	docID := "01J8X4DOC0N1P2Q3R4S5T6U7"
	shareID := "01J8X4SHAREN1P2Q3R4S5T6U7"
	linkID := "01J8X4LINK0N1P2Q3R4S5T6U7"
	orgID := "01J8X4ORG0N1P2Q3R4S5T6U7"
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/v1/workspaces/ws_x/documents"},
		{"GET", "/api/v1/workspaces/ws_x/documents/recent"},
		{"GET", "/api/v1/workspaces/ws_x/documents/shared-with-me"},
		{"GET", "/api/v1/workspaces/ws_x/documents/tree"},
		{"POST", "/api/v1/documents/" + docID + "/move"},
		{"POST", "/api/v1/documents/" + docID + "/archive"},
		{"POST", "/api/v1/documents/" + docID + "/restore"},
		{"GET", "/api/v1/documents/" + docID + "/shares"},
		{"POST", "/api/v1/documents/" + docID + "/shares"},
		{"DELETE", "/api/v1/documents/" + docID + "/shares/" + shareID},
		{"POST", "/api/v1/documents/" + docID + "/links"},
		{"DELETE", "/api/v1/documents/" + docID + "/links/" + linkID},
		{"GET", "/api/v1/documents/" + docID + "/access-logs"},
		{"PUT", "/api/v1/orgs/" + orgID + "/documents/settings"},
	} {
		res, out := doJSON(t, srv, tc.method, tc.path, token, map[string]any{})
		if res.StatusCode != 404 {
			t.Fatalf("%s %s with flag off: %d, want 404", tc.method, tc.path, res.StatusCode)
		}
		if code, _ := errCodeClass(out); code != "feature_disabled" {
			t.Fatalf("%s %s: code %q, want feature_disabled", tc.method, tc.path, code)
		}
	}
	// The public read is not behind the middleware gate (its own test covers
	// the anonymous surface), so nothing more is asserted here with the flag
	// off and the service unwired.
}

// TestDocuments05bNilService501 proves the 05b routes answer 501 instead of a
// panic while the DocumentService is unwired.
func TestDocuments05bNilService501(t *testing.T) {
	d, _ := newTestDeps(t, nil, discardOutbox{})
	if _, err := db.New(testPool).UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "documents", ScopeType: featureflags.ScopeGlobal,
		Enabled: true, Note: "nil service 05b", CreatedBy: "test",
	}); err != nil {
		t.Fatalf("enable documents flag: %v", err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
	srv := httptest.NewServer(New(d)) // d.Documents deliberately nil
	t.Cleanup(srv.Close)
	token, _ := filesRegister(t, srv, "nil-svc-05b@example.com")
	docID := "01J8X4DOC0N1P2Q3R4S5T6U7"
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/v1/workspaces/ws_x/documents"},
		{"GET", "/api/v1/workspaces/ws_x/documents/recent"},
		{"GET", "/api/v1/workspaces/ws_x/documents/tree"},
		{"POST", "/api/v1/documents/" + docID + "/move"},
		{"POST", "/api/v1/documents/" + docID + "/archive"},
		{"GET", "/api/v1/documents/" + docID + "/shares"},
		{"POST", "/api/v1/documents/" + docID + "/links"},
		{"GET", "/api/v1/documents/" + docID + "/access-logs"},
		{"PUT", "/api/v1/orgs/01J8X4ORG0N1P2Q3R4S5T6U7/documents/settings"},
		{"GET", "/api/v1/public/documents/token"},
	} {
		res, out := doJSON(t, srv, tc.method, tc.path, token, map[string]any{})
		code, _ := errCodeClass(out)
		if res.StatusCode != 501 || code != "storage_unavailable" {
			t.Fatalf("%s %s with nil Documents: %d code=%q, want 501 storage_unavailable", tc.method, tc.path, res.StatusCode, code)
		}
	}
}

// TestDocuments05bOpenAPI proves every 05b route reached the reflected spec
// with its SDI/SDO, query params and an example value.
func TestDocuments05bOpenAPI(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	d.Cfg.EnableSwagger = true
	q := db.New(pool)
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	docs.SetFiles(filesfake.New(filesfake.Options{}))
	d.Documents = docs
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	res, err := srv.Client().Get(srv.URL + "/swagger/doc.json")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("doc.json: %d", res.StatusCode)
	}
	var spec struct {
		Paths      map[string]json.RawMessage `json:"paths"`
		Components struct {
			Schemas map[string]json.RawMessage `json:"schemas"`
		} `json:"components"`
	}
	if err := json.NewDecoder(res.Body).Decode(&spec); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{
		"/api/v1/workspaces/{workspaceID}/documents",
		"/api/v1/workspaces/{workspaceID}/documents/recent",
		"/api/v1/workspaces/{workspaceID}/documents/shared-with-me",
		"/api/v1/workspaces/{workspaceID}/documents/tree",
		"/api/v1/documents/{documentID}/move",
		"/api/v1/documents/{documentID}/archive",
		"/api/v1/documents/{documentID}/restore",
		"/api/v1/documents/{documentID}/shares",
		"/api/v1/documents/{documentID}/shares/{shareID}",
		"/api/v1/documents/{documentID}/links",
		"/api/v1/documents/{documentID}/links/{linkID}",
		"/api/v1/documents/{documentID}/access-logs",
		"/api/v1/orgs/{orgID}/documents/settings",
		"/api/v1/public/documents/{token}",
		"/api/v1/public/documents/{token}/download",
		"/api/v1/public/documents/{token}/assets/{assetID}",
	} {
		p = strings.TrimSuffix(p, "/")
		if _, ok := spec.Paths[p]; !ok {
			t.Errorf("spec missing path %s", p)
		}
	}
	// The list route documents its filters; the move SDI carries examples.
	var ops map[string]struct {
		Parameters []struct {
			Name string `json:"name"`
			In   string `json:"in"`
		} `json:"parameters"`
	}
	if err := json.Unmarshal(spec.Paths["/api/v1/workspaces/{workspaceID}/documents"], &ops); err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, param := range ops["get"].Parameters {
		if param.In == "query" {
			got[param.Name] = true
		}
	}
	for _, name := range []string{"parent_id", "q", "kind", "archived", "updated_by", "updated_from", "updated_to", "cursor", "limit"} {
		if !got[name] {
			t.Errorf("list spec missing query param %q", name)
		}
	}
	move := string(spec.Components.Schemas["SdiMoveDocumentSDI"])
	if !strings.Contains(move, "01J8X4DOC0N1P2Q3R4S5T6U7W9") {
		t.Errorf("move SDI example missing: %s", move)
	}
	if public := string(spec.Components.Schemas["SdoPublicDocumentSDO"]); public == "" {
		t.Error("public document SDO not reflected")
	}
}
