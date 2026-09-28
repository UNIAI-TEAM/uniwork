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
	"sort"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// wantErr asserts status, error.code and the (possibly empty) error.error_class
// of one error envelope. An unclassified code must omit the class.
func wantErr(t *testing.T, res *http.Response, out map[string]any, status int, code, class string) {
	t.Helper()
	gotCode, gotClass := errCodeClass(out)
	if res.StatusCode != status || gotCode != code {
		t.Fatalf("status=%d code=%q, want %d %q (%v)", res.StatusCode, gotCode, status, code, out)
	}
	if gotClass != class {
		t.Fatalf("error_class=%q, want %q for code %q", gotClass, class, code)
	}
}

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
	firstCursor := ""
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
		if firstCursor == "" && next != "" {
			firstCursor = next
		}
		if next == "" {
			break
		}
		cursor = next
	}
	if len(seen) != 3 {
		t.Fatalf("cursor walk saw %d documents, want 3", len(seen))
	}
	if firstCursor == "" {
		t.Fatal("cursor walk produced no next_cursor")
	}

	// A valid cursor replayed by an unauthorized caller cannot page: the
	// permission gate runs before the cursor window on every request.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?limit=1&cursor="+firstCursor, w.outsider, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, _ = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?limit=1&cursor="+firstCursor, "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("anonymous cursor page: %d, want 401", res.StatusCode)
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
	wantErr(t, res, out, 404, "not_found", "missing")

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
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, _ = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("anonymous list: %d, want 401", res.StatusCode)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/recent", w.outsider, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
}

// TestDocumentListPermissionBeforeLimit proves the list's access predicate
// runs before LIMIT: the newest document is restricted and invisible to a
// plain member, and a limit=1 cursor walk must still return exactly the two
// visible documents, with no duplicate, leak or short page.
func TestDocumentListPermissionBeforeLimit(t *testing.T) {
	w := newDocsWorld(t)
	_, visibleA := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Visible A", "kind": "page"})
	_, visibleB := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Visible B", "kind": "page"})
	_, hidden := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Hidden", "kind": "page", "visibility": "restricted"})
	member, _ := docsJoinWorkspace(t, w, "docs-invisible-member@example.com")

	// The member sees both workspace-visible documents; the restricted one
	// stays out of the flat list entirely.
	res, out := doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("member list: %d %v", res.StatusCode, out)
	}
	if ids := docIDs(t, out); len(ids) != 2 || containsID(ids, hidden) {
		t.Fatalf("member flat list = %v", ids)
	}

	// The paged walk (newest first, so the hidden document would own the
	// first slot) visits exactly the two visible rows.
	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 5; page++ {
		path := "/api/v1/workspaces/" + w.wsID + "/documents?limit=1"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		res, out = doJSON(t, w.srv, "GET", path, member, nil)
		if res.StatusCode != 200 {
			t.Fatalf("member page %d: %d %v", page, res.StatusCode, out)
		}
		for _, id := range docIDs(t, out) {
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
	if len(seen) != 2 || !seen[visibleA] || !seen[visibleB] {
		t.Fatalf("member cursor walk = %v, want the two visible documents", seen)
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
	wantErr(t, res, out, 422, "document_cycle", "")

	// A stale revision is refused before any tree write.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+b+"/move", w.token, map[string]any{
		"parent_id": a, "revision": "99",
	})
	wantErr(t, res, out, 422, "revision_conflict", "conflict")

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
	wantErr(t, res, out, 422, "cross_workspace_reference", "")

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
	wantErr(t, res, out, 404, "not_found", "missing")
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

	// The 05b move route enforces the same ceiling: a standalone document
	// cannot move under the fifth-level parent.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token,
		map[string]any{"title": "standalone", "kind": "page"})
	if res.StatusCode != 201 {
		t.Fatalf("standalone create: %d %v", res.StatusCode, out)
	}
	standalone := out["document"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+standalone+"/move", w.token, map[string]any{
		"parent_id": parent, "revision": "1",
	})
	wantErr(t, res, out, 422, "document_too_deep", "")
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
	wantErr(t, res, out, 403, "forbidden", "permission")

	// An outsider learns nothing.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+root+"/archive", w.outsider, nil)
	wantErr(t, res, out, 404, "not_found", "missing")
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
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.outsider,
		map[string]any{"public_links_enabled": true})
	wantErr(t, res, out, 404, "not_found", "missing")
	// Flip it back off; the response reflects the stored value.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.token,
		map[string]any{"public_links_enabled": false})
	if res.StatusCode != 200 || out["public_links_enabled"] != false {
		t.Fatalf("switch off: %d %v", res.StatusCode, out)
	}
}

// TestDocumentSettingsRead covers GET /orgs/{orgID}/documents/settings: the
// same owner/admin gate as the write, the untouched-organization default
// (off, no row written) and the 404 for a non-member. The agent refusal is a
// service-level concern (no agent bearer token exists) and lives in
// TestDocumentSettingsRead (service).
func TestDocumentSettingsRead(t *testing.T) {
	w := newDocsWorld(t)
	member, memberID := docsJoinWorkspace(t, w, "docs-settings-read-member@example.com")
	ctx := context.Background()

	// Untouched organization: the default is off, and the read wrote nothing.
	res, out := doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.token, nil)
	if res.StatusCode != 200 || out["public_links_enabled"] != false || out["organization_id"] != w.orgID {
		t.Fatalf("default read: %d %v", res.StatusCode, out)
	}
	var rows int
	if err := testPool.QueryRow(ctx, "SELECT count(*) FROM document_settings WHERE organization_id = $1", w.orgID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatalf("a read wrote %d document_settings rows", rows)
	}

	// Owner flips it on; the read answers the stored value.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.token,
		map[string]any{"public_links_enabled": true})
	if res.StatusCode != 200 {
		t.Fatalf("owner switch: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.token, nil)
	if res.StatusCode != 200 || out["public_links_enabled"] != true {
		t.Fatalf("owner read after on: %d %v", res.StatusCode, out)
	}

	// An organization admin reads it too; a plain member is refused by name.
	if _, err := testPool.Exec(ctx, `UPDATE organization_members SET role = 'admin' WHERE organization_id = $1 AND user_id = $2`, w.orgID, memberID); err != nil {
		t.Fatal(err)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/settings", member, nil)
	if res.StatusCode != 200 || out["public_links_enabled"] != true {
		t.Fatalf("admin read: %d %v", res.StatusCode, out)
	}
	if _, err := testPool.Exec(ctx, `UPDATE organization_members SET role = 'member' WHERE organization_id = $1 AND user_id = $2`, w.orgID, memberID); err != nil {
		t.Fatal(err)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/settings", member, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")

	// A non-member learns nothing.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.outsider, nil)
	wantErr(t, res, out, 404, "not_found", "missing")
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
		{"GET", "/api/v1/orgs/" + orgID + "/documents/settings"},
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
	// Every 05b path reflects exactly its method(s) - a mis-methoded or
	// duplicated operation fails here, not only a missing path.
	wantOps := map[string][]string{
		"/api/v1/workspaces/{workspaceID}/documents":                {"get", "post"},
		"/api/v1/workspaces/{workspaceID}/documents/recent":         {"get"},
		"/api/v1/workspaces/{workspaceID}/documents/shared-with-me": {"get"},
		"/api/v1/workspaces/{workspaceID}/documents/tree":           {"get"},
		"/api/v1/documents/{documentID}/move":                       {"post"},
		"/api/v1/documents/{documentID}/archive":                    {"post"},
		"/api/v1/documents/{documentID}/restore":                    {"post"},
		"/api/v1/documents/{documentID}/shares":                     {"get", "post"},
		"/api/v1/documents/{documentID}/shares/{shareID}":           {"delete"},
		"/api/v1/documents/{documentID}/links":                      {"post"},
		"/api/v1/documents/{documentID}/links/{linkID}":             {"delete"},
		"/api/v1/documents/{documentID}/access-logs":                {"get"},
		"/api/v1/orgs/{orgID}/documents/settings":                   {"get", "put"},
		"/api/v1/public/documents/{token}":                          {"get"},
		"/api/v1/public/documents/{token}/download":                 {"get", "head"},
		"/api/v1/public/documents/{token}/assets/{assetID}":         {"get", "head"},
	}
	for p, methods := range wantOps {
		raw, ok := spec.Paths[p]
		if !ok {
			t.Errorf("spec missing path %s", p)
			continue
		}
		var ops map[string]json.RawMessage
		if err := json.Unmarshal(raw, &ops); err != nil {
			t.Fatalf("path %s: %v", p, err)
		}
		got := make([]string, 0, len(ops))
		for m := range ops {
			got = append(got, m)
		}
		sort.Strings(got)
		if strings.Join(got, ",") != strings.Join(methods, ",") {
			t.Errorf("spec %s methods = %v, want %v", p, got, methods)
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
	// shared-with-me publishes its paging query params.
	var swmOps map[string]struct {
		Parameters []struct {
			Name string `json:"name"`
			In   string `json:"in"`
		} `json:"parameters"`
	}
	if err := json.Unmarshal(spec.Paths["/api/v1/workspaces/{workspaceID}/documents/shared-with-me"], &swmOps); err != nil {
		t.Fatal(err)
	}
	swm := map[string]bool{}
	for _, param := range swmOps["get"].Parameters {
		if param.In == "query" {
			swm[param.Name] = true
		}
	}
	for _, name := range []string{"cursor", "limit"} {
		if !swm[name] {
			t.Errorf("shared-with-me spec missing query param %q", name)
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

// TestDocumentRecentCursorWalk proves the recent route walks its own cursor
// over the documents the caller touched, newest first, without duplicates.
func TestDocumentRecentCursorWalk(t *testing.T) {
	w := newDocsWorld(t)
	ids := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		_, id := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Recent " + string(rune('a'+i)), "kind": "page"})
		res, _ := doJSON(t, w.srv, "GET", "/api/v1/documents/"+id, w.token, nil)
		if res.StatusCode != 200 {
			t.Fatalf("recent view %d: %d", i, res.StatusCode)
		}
		ids = append(ids, id)
	}
	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 6; page++ {
		path := "/api/v1/workspaces/" + w.wsID + "/documents/recent?limit=1"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		res, out := doJSON(t, w.srv, "GET", path, w.token, nil)
		if res.StatusCode != 200 {
			t.Fatalf("recent page %d: %d %v", page, res.StatusCode, out)
		}
		if page == 0 {
			// The first page must be exactly `limit` rows with a
			// continuation cursor; a route ignoring limit would otherwise
			// pass the seen-set walk below.
			if ids := docIDs(t, out); len(ids) != 1 {
				t.Fatalf("recent page 1 = %d rows, want 1", len(ids))
			}
			if next, _ := out["next_cursor"].(string); next == "" {
				t.Fatalf("recent page 1 missing continuation cursor: %v", out)
			}
		}
		for _, id := range docIDs(t, out) {
			if seen[id] {
				t.Fatalf("recent cursor repeated %s on page %d", id, page)
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
		t.Fatalf("recent walk saw %d documents, want 3", len(seen))
	}
	for _, id := range ids {
		if !seen[id] {
			t.Fatalf("recent document %s missing from the walk", id)
		}
	}
}

// TestDocument05bWritePermissionMatrix proves the level gate on every 05b
// write route: view-level readers cannot move, archive, restore, share or
// manage links; edit-level may move but not change access; manage-level may
// do all of it, and only manage sees archived rows in the trash view.
func TestDocument05bWritePermissionMatrix(t *testing.T) {
	w := newDocsWorld(t)
	res, out := doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.token,
		map[string]any{"public_links_enabled": true})
	if res.StatusCode != 200 {
		t.Fatalf("enable links: %d %v", res.StatusCode, out)
	}

	_, docView := docsCreatePageBody(t, w, w.token, map[string]any{"title": "V", "kind": "page", "visibility": "restricted"})
	_, docEdit := docsCreatePageBody(t, w, w.token, map[string]any{"title": "E", "kind": "page", "visibility": "restricted"})
	_, docManage := docsCreatePageBody(t, w, w.token, map[string]any{"title": "M", "kind": "page", "visibility": "restricted"})
	viewer, viewerID := docsJoinWorkspace(t, w, "docs-matrix-view@example.com")
	editor, editorID := docsJoinWorkspace(t, w, "docs-matrix-edit@example.com")
	manager, managerID := docsJoinWorkspace(t, w, "docs-matrix-manage@example.com")
	share := func(doc, userID, level string) {
		t.Helper()
		res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
			"principal_type": "user", "principal_id": userID, "level": level,
		})
		if res.StatusCode != 201 {
			t.Fatalf("share %s: %d %v", level, res.StatusCode, out)
		}
	}
	share(docView, viewerID, "view")
	share(docEdit, editorID, "edit")
	share(docManage, managerID, "manage")
	// The viewer had real read access to the document whose archived view is
	// checked below, so the trash assertion proves the manage-only rule, not
	// the absence of any access.
	share(docManage, viewerID, "view")

	// View level: every 05b write is refused with the permission class.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docView+"/move", viewer, map[string]any{"revision": "1"})
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docView+"/archive", viewer, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docView+"/restore", viewer, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docView+"/shares", viewer, map[string]any{
		"principal_type": "user", "principal_id": editorID, "level": "view"})
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+docView+"/shares/01J8X4SHAREN1P2Q3R4S5T6U7", viewer, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docView+"/links", viewer, map[string]any{})
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+docView+"/links/01J8X4LINK0N1P2Q3R4S5T6U7", viewer, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")

	// Live revoke targets on docEdit: a real share and a real link the editor
	// must not be able to touch.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docEdit+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": viewerID, "level": "view"})
	if res.StatusCode != 201 {
		t.Fatalf("seed edit share: %d %v", res.StatusCode, out)
	}
	editShareID := out["share"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docEdit+"/links", w.token, map[string]any{})
	if res.StatusCode != 201 {
		t.Fatalf("seed edit link: %d %v", res.StatusCode, out)
	}
	editLinkID := out["link"].(map[string]any)["id"].(string)

	// Edit level: move is allowed; access changes are not.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docEdit+"/move", editor, map[string]any{"revision": "1"})
	if res.StatusCode != 200 {
		t.Fatalf("editor move: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docEdit+"/archive", editor, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docEdit+"/restore", editor, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docEdit+"/shares", editor, map[string]any{
		"principal_type": "user", "principal_id": viewerID, "level": "view"})
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docEdit+"/links", editor, map[string]any{})
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+docEdit+"/shares/"+editShareID, editor, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+docEdit+"/links/"+editLinkID, editor, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")

	// The real targets survived the editor's refused revokes.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+docEdit+"/shares", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("edit overview: %d %v", res.StatusCode, out)
	}
	liveShare, liveLink := false, false
	for _, sh := range out["shares"].([]any) {
		if sh.(map[string]any)["id"] == editShareID && sh.(map[string]any)["active"] == true {
			liveShare = true
		}
	}
	for _, l := range out["links"].([]any) {
		if l.(map[string]any)["id"] == editLinkID {
			liveLink = true
		}
	}
	if !liveShare || !liveLink {
		t.Fatalf("editor revokes touched live targets: shares=%v links=%v", out["shares"], out["links"])
	}

	// Manage level: archive/restore, share and link management all work,
	// and only manage sees the archived row in the trash view.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docManage+"/archive", manager, nil)
	if res.StatusCode != 200 {
		t.Fatalf("manager archive: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?archived=1", manager, nil)
	if res.StatusCode != 200 || !containsID(docIDs(t, out), docManage) {
		t.Fatalf("manager archived view: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents?archived=1", viewer, nil)
	if res.StatusCode != 200 || containsID(docIDs(t, out), docManage) {
		t.Fatalf("viewer archived view leaked: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docManage+"/restore", manager, nil)
	if res.StatusCode != 200 {
		t.Fatalf("manager restore: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docManage+"/shares", manager, map[string]any{
		"principal_type": "user", "principal_id": editorID, "level": "view"})
	if res.StatusCode != 201 {
		t.Fatalf("manager share: %d %v", res.StatusCode, out)
	}
	newShare := out["share"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+docManage+"/shares/"+newShare, manager, nil)
	if res.StatusCode != 200 {
		t.Fatalf("manager revoke share: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docManage+"/links", manager, map[string]any{})
	if res.StatusCode != 201 {
		t.Fatalf("manager link: %d %v", res.StatusCode, out)
	}
	linkID := out["link"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+docManage+"/links/"+linkID, manager, nil)
	if res.StatusCode != 200 {
		t.Fatalf("manager revoke link: %d %v", res.StatusCode, out)
	}
	// The manager grant itself is never revoked by the new share.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+docManage+"/shares", manager, nil)
	if res.StatusCode != 200 || out["my_level"] != "manage" {
		t.Fatalf("manager still manages: %d %v", res.StatusCode, out)
	}
}
