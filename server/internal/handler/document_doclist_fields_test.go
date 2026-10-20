package handler

// UNI-2045 DOCLIST-UNIFIED (server w1): the per-row fields every list branch
// of the documents table carries (is_owner) and the txt
// format. Amendment 1 of the contract: the folder level (parent_id) and the
// root are list branches too, so each field has a test on that branch.

import (
	"testing"
	"time"
)

// dlRows reads one list answer as title -> row, failing on a non-200.
func dlRows(t *testing.T, w *docsWorld, token, path string) map[string]map[string]any {
	t.Helper()
	sep := "?"
	for _, c := range path {
		if c == '?' {
			sep = "&"
		}
	}
	res, out := dlGet(t, w, token, path+sep+"limit=100")
	if res.StatusCode != 200 {
		t.Fatalf("GET %s: %d %v", path, res.StatusCode, out)
	}
	rows := map[string]map[string]any{}
	raw, _ := out["documents"].([]any)
	for _, item := range raw {
		m := item.(map[string]any)
		rows[m["title"].(string)] = m
	}
	return rows
}

// dlShelve shelves (or un-shelves) documents by SQL with the whole attribution
// the shape check wants.
func dlShelve(t *testing.T, w *docsWorld, ids []string, on bool) {
	t.Helper()
	if on {
		dlExec(t, `UPDATE documents SET shelved_at = now(), shelved_by = $2, shelved_by_kind = 'human', shelve_batch_id = $3 WHERE id = ANY($1)`, ids, w.userID, newTestID())
		return
	}
	dlExec(t, `UPDATE documents SET shelved_at = NULL, shelved_by = NULL, shelved_by_kind = NULL, shelve_batch_id = NULL WHERE id = ANY($1)`, ids)
}

// dlArchive sends documents to the trash through the API.
func dlArchive(t *testing.T, w *docsWorld, ids []string) {
	t.Helper()
	for _, id := range ids {
		if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/archive", w.token, nil); res.StatusCode != 200 {
			t.Fatalf("archive %s: %d %v", id, res.StatusCode, out)
		}
	}
}

// dlWantOwner asserts is_owner is a present boolean on each named row.
func dlWantOwner(t *testing.T, w *docsWorld, what, token, path string, want map[string]bool) {
	t.Helper()
	rows := dlRows(t, w, token, path)
	for title, owner := range want {
		row := rows[title]
		if row == nil {
			t.Errorf("%s: row %q missing from %s (%d rows)", what, title, path, len(rows))
			continue
		}
		got, ok := row["is_owner"].(bool)
		if !ok {
			t.Errorf("%s: row %q has no boolean is_owner: %v", what, title, row["is_owner"])
			continue
		}
		if got != owner {
			t.Errorf("%s: row %q is_owner = %v, want %v", what, title, got, owner)
		}
	}
}

// SV-5: every list row says whether the caller is the ACL owner of the
// document, on every branch: the folder level, the root, recent, favorites,
// shared with me, the trash and the shelf.
func TestDoclistIsOwner(t *testing.T) {
	w := newDocsWorld(t)
	memberTok, memberID := docsJoinWorkspace(t, w, "dl-owner-member@example.com")
	base := dlBase(w)
	_, folder := docsCreatePageBody(t, w, w.token, map[string]any{"title": "F", "kind": "folder"})
	// a folder takes no visibility through the API; open it to the workspace
	// so the member can create inside it.
	dlExec(t, `UPDATE documents SET visibility = 'workspace', workspace_level = 'edit' WHERE id = $1`, folder)
	_, mine := docsCreatePageBody(t, w, w.token, map[string]any{"title": "mine", "parent_id": folder, "visibility": "workspace"})
	_, theirs := docsCreatePageBody(t, w, memberTok, map[string]any{"title": "theirs", "parent_id": folder, "visibility": "workspace"})
	both := map[string]bool{"mine": true, "theirs": false}
	flipped := map[string]bool{"mine": false, "theirs": true}

	// the folder level (parent_id) and the root, for each person.
	dlWantOwner(t, w, "parent_id branch", w.token, base+"?parent_id="+folder, both)
	dlWantOwner(t, w, "parent_id branch (member)", memberTok, base+"?parent_id="+folder, flipped)
	dlWantOwner(t, w, "flat branch", w.token, base, both)
	dlWantOwner(t, w, "flat branch (member)", memberTok, base, flipped)
	dlWantOwner(t, w, "search branch", w.token, base+"?q=mine", map[string]bool{"mine": true})

	now := time.Now().UTC().Add(-time.Hour)
	dlLog(t, w, theirs, w.userID, "view", now) // mine is recent by being the caller's edit
	dlWantOwner(t, w, "recent", w.token, base+"/recent", both)
	dlFavorite(t, w, w.token, mine)
	dlFavorite(t, w, w.token, theirs)
	dlWantOwner(t, w, "favorites", w.token, base+"/favorites", both)

	// shared with me: the document is the sharer's, never the caller's.
	_, secret := docsCreatePageBody(t, w, w.token, map[string]any{"title": "secret", "visibility": "restricted"})
	dlShare(t, w, secret, "user", memberID, w.userID, "human", now)
	dlWantOwner(t, w, "shared-with-me", memberTok, base+"/shared-with-me", map[string]bool{"secret": false})

	// the shelf, then the trash.
	dlShelve(t, w, []string{mine, theirs}, true)
	dlWantOwner(t, w, "shelf", w.token, base+"?shelved=1", both)
	dlShelve(t, w, []string{mine, theirs}, false)
	dlArchive(t, w, []string{mine, theirs})
	dlWantOwner(t, w, "trash", w.token, base+"?archived=1", both)
}
