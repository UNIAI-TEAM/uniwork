package handler

// UNI-1645 §3.2 wire shape of the list rows: the library list and tree answer
// `edit_lock` with the summary of the live tenure - holder fields, since,
// expiry - and never `lock_id`, which stays R1's (C2-1). The organization-
// scoped favorites list answers no edit_lock at all.

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// acquireEditLockHolder takes a live tenure over HTTP as token and returns
// the tenure id the holder would use.
func acquireEditLockHolder(t *testing.T, w *docsWorld, token, documentID string) string {
	t.Helper()
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/edit-lock", token,
		map[string]any{"editor_id": util.NewID(), "client": "web_page"})
	if res.StatusCode != 201 {
		t.Fatalf("acquire edit lock: %d %v", res.StatusCode, out)
	}
	lockID, _ := out["lock_id"].(string)
	if lockID == "" {
		t.Fatalf("acquire edit lock answered no lock_id: %v", out)
	}
	return lockID
}

// listRowByID finds one decoded list row by document id.
func listRowByID(t *testing.T, out map[string]any, docID string) map[string]any {
	t.Helper()
	for _, item := range out["documents"].([]any) {
		row := item.(map[string]any)
		if row["id"] == docID {
			return row
		}
	}
	t.Fatalf("document %s is not in %v", docID, out)
	return nil
}

// treeRowByID finds one decoded tree node by document id.
func treeRowByID(nodes []any, docID string) (map[string]any, bool) {
	for _, item := range nodes {
		node := item.(map[string]any)
		if node["id"] == docID {
			return node, true
		}
		if children, ok := node["children"].([]any); ok {
			if found, ok := treeRowByID(children, docID); ok {
				return found, true
			}
		}
	}
	return nil, false
}

// TestDocumentListAndTreeRowsCarryEditLock drives the two row mappers over
// the real router: the holder's own list shows held_by_me=true, the tree node
// the same summary, and neither row carries lock_id.
func TestDocumentListAndTreeRowsCarryEditLock(t *testing.T) {
	w := newDocsWorld(t)
	_, docID := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Trang có khóa", "kind": "page"})
	lockID := acquireEditLockHolder(t, w, w.token, docID)

	res, out := doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	lock, ok := listRowByID(t, out, docID)["edit_lock"].(map[string]any)
	if !ok {
		t.Fatalf("list row carries no edit_lock: %v", out)
	}
	if lock["holder_id"] != w.userID || lock["held_by_me"] != true {
		t.Fatalf("list row edit_lock = %v, want the owner as holder", lock)
	}
	if lock["holder_name"] == "" || lock["since"] == "" || lock["expires_at"] == "" {
		t.Fatalf("list row edit_lock is missing holder fields: %v", lock)
	}
	if leaked, ok := lock["lock_id"]; ok {
		t.Fatalf("list row leaked lock_id %v (tenure %s; C2-1 is R1 only)", leaked, lockID)
	}

	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/tree", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("tree: %d %v", res.StatusCode, out)
	}
	node, ok := treeRowByID(out["documents"].([]any), docID)
	if !ok {
		t.Fatalf("document %s is not in the tree: %v", docID, out)
	}
	treeLock, ok := node["edit_lock"].(map[string]any)
	if !ok {
		t.Fatalf("tree node carries no edit_lock: %v", node)
	}
	if treeLock["holder_id"] != w.userID || treeLock["held_by_me"] != true {
		t.Fatalf("tree node edit_lock = %v, want the owner as holder", treeLock)
	}
	if leaked, ok := treeLock["lock_id"]; ok {
		t.Fatalf("tree node leaked lock_id %v (tenure %s; C2-1 is R1 only)", leaked, lockID)
	}
}

// TestDocumentFavoriteRowsHaveNoEditLock: the organization-scoped favorites
// list takes no part in the lock summary (§3.2), even while the document has
// a live tenure.
func TestDocumentFavoriteRowsHaveNoEditLock(t *testing.T) {
	w := newDocsWorld(t)
	_, docID := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Trang yêu thích", "kind": "page"})
	acquireEditLockHolder(t, w, w.token, docID)

	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/favorite", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("favorite: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/favorites", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("favorites: %d %v", res.StatusCode, out)
	}
	rows := out["favorites"].([]any)
	if len(rows) != 1 {
		t.Fatalf("favorites = %v, want the one row", out)
	}
	row := rows[0].(map[string]any)
	if row["document_id"] != docID {
		t.Fatalf("favorite row = %v, want document %s", row, docID)
	}
	if _, ok := row["edit_lock"]; ok {
		t.Fatalf("org-scoped favorites carry edit_lock (§3.2 excludes them): %v", row)
	}
}
