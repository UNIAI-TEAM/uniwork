package handler

// G8-04 (UNI-1399) over the real HTTP surface: the anchored create with
// base_version_id, the PUT /comments/anchors SDO and its refusals, and the
// routing rule that the static anchors path is answered by its own handler
// (contract-collab sections 2.2, 2.6, 4.3).

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
)

const (
	anchorXLSXMime    = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	anchorForeignFile = "01J8X4FILEN1P2Q3R4S5T6U7V8"
)

// anchorFileDoc creates a workspace-visible file document whose versions
// 1..head all carry the given mime, and points the document at the head like
// a save commit does.
func (w *documentCollabWorld) anchorFileDoc(t *testing.T, title, mime string, head int) (string, []string) {
	t.Helper()
	docID := w.createDoc(t, w.token, title, "workspace")
	if _, err := w.pool.Exec(context.Background(),
		"UPDATE documents SET kind = 'file', content = NULL WHERE id = $1", docID); err != nil {
		t.Fatal(err)
	}
	versions := make([]string, 0, head)
	for n := 1; n <= head; n++ {
		id := util.NewID()
		if _, err := w.pool.Exec(context.Background(), `
			INSERT INTO document_versions (
				id, organization_id, workspace_id, document_id, version, kind, reason,
				file_id, mime_type, created_by, created_by_kind
			) VALUES ($1, $2, $3, $4, $5, 'file', 'upload', $6, $7, $8, 'human')`,
			id, w.orgID, w.wsID, docID, n, anchorForeignFile, mime, w.userID); err != nil {
			t.Fatal(err)
		}
		versions = append(versions, id)
	}
	if _, err := w.pool.Exec(context.Background(),
		"UPDATE documents SET current_version = $1, file_version_id = $2 WHERE id = $3",
		head, versions[head-1], docID); err != nil {
		t.Fatal(err)
	}
	return docID, versions
}

func anchorXLSXBody(rangeA1 string) map[string]any {
	return map[string]any{"format": "xlsx", "v": 1, "sheet": "S1", "range": rangeA1}
}

// TestDocumentCommentAnchorsHTTP drives the anchored create and the PUT
// through the real router: the SDO carries anchor/version/state, the PUT is
// idempotent by itself, and an unresolvable version is one 400 body with no
// error class.
func TestDocumentCommentAnchorsHTTP(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID, versions := w.anchorFileDoc(t, "Anchor HTTP", anchorXLSXMime, 3)

	// Create on a version older than head: stale, bound to that version.
	res, out := doJSON(t, w.srv, "POST", w.commentsPath(docID), w.member, map[string]any{
		"body": "có neo", "kind": "comment", "anchor": anchorXLSXBody("B7"), "base_version_id": versions[0],
	})
	if res.StatusCode != 201 {
		t.Fatalf("anchored create: %d %v", res.StatusCode, out)
	}
	comment := out["comment"].(map[string]any)
	commentID := comment["id"].(string)
	if comment["anchor_version_id"] != versions[0] || comment["anchor_state"] != "stale" {
		t.Fatalf("anchored create binding: %v", comment)
	}
	if anchor, _ := comment["anchor"].(map[string]any); anchor["range"] != "B7" {
		t.Fatalf("anchored create anchor: %v", comment["anchor"])
	}
	// At head: exact.
	res, out = doJSON(t, w.srv, "POST", w.commentsPath(docID), w.member, map[string]any{
		"body": "đầu", "kind": "comment", "anchor": anchorXLSXBody("C7"), "base_version_id": versions[2],
	})
	if res.StatusCode != 201 || out["comment"].(map[string]any)["anchor_state"] != "exact" {
		t.Fatalf("head create: %d %v", res.StatusCode, out)
	}
	// Unresolvable base version: the shared 400 with no error class.
	res, out = doJSON(t, w.srv, "POST", w.commentsPath(docID), w.member, map[string]any{
		"body": "lạ", "kind": "comment", "anchor": anchorXLSXBody("D7"), "base_version_id": "01J8X4VER0N1P2Q3R4S5T6U7V8",
	})
	if code, class := errCodeClass(out); res.StatusCode != 400 || code != "anchor_version_invalid" || class != "" {
		t.Fatalf("bad base version: %d code=%q class=%q %v", res.StatusCode, code, class, out)
	}

	// The PUT applies the map and answers updated/skipped/list_token.
	res, out = doJSON(t, w.srv, "PUT", w.commentsPath(docID)+"/anchors", w.member, map[string]any{
		"version_id": versions[2],
		"anchors":    []any{map[string]any{"comment_id": commentID, "anchor": anchorXLSXBody("B8"), "state": "exact"}},
	})
	if res.StatusCode != 200 {
		t.Fatalf("PUT anchors: %d %v", res.StatusCode, out)
	}
	if updated := out["updated"].([]any); len(updated) != 1 || updated[0] != commentID {
		t.Fatalf("PUT updated: %v", out)
	}
	if skipped, ok := out["skipped"].([]any); !ok || len(skipped) != 0 {
		t.Fatalf("PUT skipped: %v", out["skipped"])
	}
	if token, _ := out["list_token"].(string); len(token) < 5 || token[:4] != "lt1:" {
		t.Fatalf("PUT list_token: %v", out["list_token"])
	}
	// Same payload again: no row changes.
	res, out = doJSON(t, w.srv, "PUT", w.commentsPath(docID)+"/anchors", w.member, map[string]any{
		"version_id": versions[2],
		"anchors":    []any{map[string]any{"comment_id": commentID, "anchor": anchorXLSXBody("B8"), "state": "exact"}},
	})
	if res.StatusCode != 200 || len(out["updated"].([]any)) != 0 {
		t.Fatalf("repeat PUT: %d %v", res.StatusCode, out)
	}
	// The list shows the moved anchor after a real change.
	res, out = doJSON(t, w.srv, "GET", w.commentsPath(docID)+"?kind=comment", w.member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	found := false
	for _, raw := range out["comments"].([]any) {
		row := raw.(map[string]any)
		if row["id"] == commentID {
			found = true
			if row["anchor_version_id"] != versions[2] || row["anchor_state"] != "exact" {
				t.Fatalf("list row after PUT: %v", row)
			}
		}
	}
	if !found {
		t.Fatal("the anchored comment fell out of the list")
	}

	// An unknown version is the shared 400 and writes nothing.
	res, out = doJSON(t, w.srv, "PUT", w.commentsPath(docID)+"/anchors", w.member, map[string]any{
		"version_id": "01J8X4VER0N1P2Q3R4S5T6U7V8",
		"anchors":    []any{map[string]any{"comment_id": commentID, "anchor": anchorXLSXBody("B1"), "state": "exact"}},
	})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "anchor_version_invalid" {
		t.Fatalf("PUT bad version: %d %q %v", res.StatusCode, code, out)
	}

	// A reader without edit is refused by the mutation gate.
	restricted := w.createDoc(t, w.token, "Anchor restricted", "restricted")
	w.share(t, restricted, w.viewerID, service.DocumentLevelView)
	res, out = doJSON(t, w.srv, "PUT", w.commentsPath(restricted)+"/anchors", w.viewer, map[string]any{
		"version_id": versions[0], "anchors": []any{},
	})
	if res.StatusCode != 403 && res.StatusCode != 404 {
		t.Fatalf("viewer PUT: %d %v", res.StatusCode, out)
	}
}

// TestDocumentCommentAnchorsStaticRoute pins the Chi rule the contract calls
// out: /comments/anchors is a static segment answered by the anchors handler,
// never by a {commentID} route. A PUT here reaches the anchors validation
// (400 anchor_version_invalid), not a 405 from a method-less param route and
// not the comment lookup behind {commentID}.
func TestDocumentCommentAnchorsStaticRoute(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "Anchor route", "workspace")

	res, out := doJSON(t, w.srv, "PUT", w.commentsPath(docID)+"/anchors", w.token, map[string]any{
		"version_id": "01J8X4VER0N1P2Q3R4S5T6U7V8", "anchors": []any{},
	})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "anchor_version_invalid" {
		t.Fatalf("PUT /comments/anchors = %d code=%q %v, want the anchors handler's 400", res.StatusCode, code, out)
	}
}
