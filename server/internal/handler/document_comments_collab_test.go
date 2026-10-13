package handler

// G8-03 (UNI-1398) over the real HTTP surface: thread kinds, the list_token
// probe, the structure-keeping delete with its comment_deleted refusals, and
// the revision history route. Every case drives the real Chi router on a real
// database, so the SDO shape is the one a client reads (contract-collab
// sections 2.1-2.4, 2.7, 6).

import (
	"strings"
	"testing"
)

// createCommentRaw posts one create and returns the comment object, so a test
// can read the wire fields a client reads.
func (w *documentCollabWorld) createCommentRaw(t *testing.T, token, documentID string, payload map[string]any) map[string]any {
	t.Helper()
	res, out := doJSON(t, w.srv, "POST", w.commentsPath(documentID), token, payload)
	if res.StatusCode != 200 {
		t.Fatalf("create comment: %d %v", res.StatusCode, out)
	}
	return out["comment"].(map[string]any)
}

func TestDocumentCommentCollabKindsHTTP(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "Collab kinds", "workspace")

	// No kind on a root: discussion is the default (OQ-C2); `kind` and `type`
	// both carry the stored comment_type.
	root := w.createCommentRaw(t, w.member, docID, map[string]any{"body": "gốc không kind"})
	rootID := root["id"].(string)
	if root["kind"] != "discussion" || root["type"] != "discussion" {
		t.Fatalf("default root kind: %v", root)
	}
	anchored := w.createCommentRaw(t, w.member, docID, map[string]any{"body": "có neo", "kind": "comment"})
	if anchored["kind"] != "comment" || anchored["type"] != "comment" {
		t.Fatalf("kind=comment: %v", anchored)
	}
	// The pre-G8 `type` field alone is still a discussion: it never picks the
	// thread kind, and anything outside its old allowlist is refused.
	legacy := w.createCommentRaw(t, w.member, docID, map[string]any{"body": "client cũ", "type": "comment"})
	if legacy["kind"] != "discussion" {
		t.Fatalf("legacy type picked a kind: %v", legacy)
	}
	res, out := doJSON(t, w.srv, "POST", w.commentsPath(docID), w.member, map[string]any{"body": "lạ", "type": "system"})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("legacy type outside the allowlist: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "POST", w.commentsPath(docID), w.member, map[string]any{"body": "lạ", "kind": "bogus"})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("unknown kind: %d code=%q", res.StatusCode, code)
	}
	// A reply inherits its parent's kind and may not switch it.
	reply := w.createCommentRaw(t, w.member, docID, map[string]any{"body": "trả lời", "parent_id": rootID})
	if reply["kind"] != "discussion" {
		t.Fatalf("reply kind: %v", reply)
	}
	res, out = doJSON(t, w.srv, "POST", w.commentsPath(docID), w.member,
		map[string]any{"body": "đổi loại", "parent_id": rootID, "kind": "comment"})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("reply switching kinds: %d code=%q", res.StatusCode, code)
	}

	// An empty kind returns both; the filter narrows it.
	res, out = doJSON(t, w.srv, "GET", w.commentsPath(docID), w.member, nil)
	if res.StatusCode != 200 || len(out["comments"].([]any)) != 4 {
		t.Fatalf("unfiltered list: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", w.commentsPath(docID)+"?kind=comment", w.member, nil)
	comments := out["comments"].([]any)
	if res.StatusCode != 200 || len(comments) != 1 || comments[0].(map[string]any)["id"] != anchored["id"] {
		t.Fatalf("kind=comment list: %v", out)
	}
	res, out = doJSON(t, w.srv, "GET", w.commentsPath(docID)+"?kind=discussion", w.member, nil)
	if res.StatusCode != 200 || len(out["comments"].([]any)) != 3 {
		t.Fatalf("kind=discussion list: %v", out)
	}
	res, out = doJSON(t, w.srv, "GET", w.commentsPath(docID)+"?kind=bogus", w.member, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("unknown kind filter: %d code=%q", res.StatusCode, code)
	}
}

// Every list answer carries the document-wide list_token and a name-table
// slot; a since_token equal to it answers unchanged with no rows.
func TestDocumentCommentCollabListTokenHTTP(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "Collab token", "workspace")
	w.createComment(t, w.member, docID, "một", nil)

	res, out := doJSON(t, w.srv, "GET", w.commentsPath(docID), w.member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	token, _ := out["list_token"].(string)
	if token == "" || !strings.HasPrefix(token, "lt1:") {
		t.Fatalf("list_token = %q", token)
	}
	if unchanged, ok := out["unchanged"].(bool); !ok || unchanged {
		t.Fatalf("fresh list unchanged = %v", out["unchanged"])
	}
	if _, ok := out["mentions"].([]any); !ok {
		t.Fatalf("list must carry the mentions name table: %v", out)
	}

	// The probe: same token -> unchanged true, empty comments, same token.
	res, out = doJSON(t, w.srv, "GET", w.commentsPath(docID)+"?since_token="+token, w.member, nil)
	if res.StatusCode != 200 || out["unchanged"] != true || out["list_token"] != token {
		t.Fatalf("unchanged probe: %d %v", res.StatusCode, out)
	}
	if comments, ok := out["comments"].([]any); !ok || len(comments) != 0 {
		t.Fatalf("unchanged probe carries rows: %v", out["comments"])
	}

	// A new comment moves the token; the stale token is answered with the
	// full list.
	w.createComment(t, w.member, docID, "hai", nil)
	res, out = doJSON(t, w.srv, "GET", w.commentsPath(docID)+"?since_token="+token, w.member, nil)
	if res.StatusCode != 200 || out["unchanged"] != false || out["list_token"] == token {
		t.Fatalf("stale token: %d %v", res.StatusCode, out)
	}
	if len(out["comments"].([]any)) != 2 {
		t.Fatalf("stale token list: %v", out["comments"])
	}

	// The filter does not move the token: it is one per document.
	res, out = doJSON(t, w.srv, "GET", w.commentsPath(docID)+"?kind=discussion", w.member, nil)
	if res.StatusCode != 200 || out["list_token"] == "" {
		t.Fatalf("filtered list token: %v", out)
	}
}

func TestDocumentCommentCollabTombstoneHTTP(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "Collab tombstone", "workspace")
	rootID := w.createComment(t, w.member, docID, "gốc", nil)
	replyID := w.createComment(t, w.member, docID, "phản hồi", map[string]any{"parent_id": rootID})

	commentPath := w.commentsPath(docID) + "/" + rootID
	res, out := doJSON(t, w.srv, "DELETE", commentPath, w.member, nil)
	if res.StatusCode != 200 || out["status"] != "ok" || out["outcome"] != "tombstoned" {
		t.Fatalf("delete with a reply: %d %v", res.StatusCode, out)
	}
	rows := w.listComments(t, w.member, docID, 200)
	if len(rows) != 2 {
		t.Fatalf("list after tombstone: %v", rows)
	}
	frame := rows[0].(map[string]any)
	if frame["id"] != rootID || frame["body"] != "" || frame["deleted_at"] == nil || frame["deleted_by_id"] != w.memberID {
		t.Fatalf("tombstone frame: %v", frame)
	}
	if rows[1].(map[string]any)["body"] != "phản hồi" {
		t.Fatalf("the reply did not survive: %v", rows[1])
	}

	// A reply to the frame, an edit and a resolve are all 409 comment_deleted,
	// deliberately without an error_class.
	for _, tc := range []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"reply", "POST", w.commentsPath(docID), map[string]any{"body": "vào khung", "parent_id": rootID}},
		{"edit", "PATCH", commentPath, map[string]any{"body": "sửa khung"}},
		{"resolve", "POST", commentPath + "/resolve", nil},
		{"reopen", "DELETE", commentPath + "/resolve", nil},
	} {
		res, out := doJSON(t, w.srv, tc.method, tc.path, w.member, tc.body)
		code, class := errCodeClass(out)
		if res.StatusCode != 409 || code != "comment_deleted" || class != "" {
			t.Fatalf("%s on a tombstone: %d code=%q class=%q", tc.name, res.StatusCode, code, class)
		}
	}

	// Replying to the surviving reply still works, and deleting the frame
	// again is a no-op with the same outcome.
	childID := w.createComment(t, w.member, docID, "dưới phản hồi", map[string]any{"parent_id": replyID})
	res, out = doJSON(t, w.srv, "DELETE", commentPath, w.member, nil)
	if res.StatusCode != 200 || out["outcome"] != "tombstoned" {
		t.Fatalf("second delete of the frame: %d %v", res.StatusCode, out)
	}

	// Removing the branch bottom-up: the reply's child goes hard, then the
	// live reply itself goes hard and the now-childless tombstone above it
	// cascades in the same command (OQ-C4), so the thread empties.
	res, out = doJSON(t, w.srv, "DELETE", w.commentsPath(docID)+"/"+childID, w.member, nil)
	if res.StatusCode != 200 || out["outcome"] != "removed" {
		t.Fatalf("delete of the reply's child: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "DELETE", w.commentsPath(docID)+"/"+replyID, w.member, nil)
	if res.StatusCode != 200 || out["outcome"] != "removed" {
		t.Fatalf("delete of the reply: %d %v", res.StatusCode, out)
	}
	if rows = w.listComments(t, w.member, docID, 200); len(rows) != 0 {
		t.Fatalf("cascade left rows behind: %v", rows)
	}
}

func TestDocumentCommentCollabRemoveHTTP(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "Collab remove", "workspace")
	commentID := w.createComment(t, w.member, docID, "xóa hẳn", nil)

	res, out := doJSON(t, w.srv, "DELETE", w.commentsPath(docID)+"/"+commentID, w.member, nil)
	if res.StatusCode != 200 || out["status"] != "ok" || out["outcome"] != "removed" {
		t.Fatalf("delete without replies: %d %v", res.StatusCode, out)
	}
	if rows := w.listComments(t, w.member, docID, 200); len(rows) != 0 {
		t.Fatalf("thread after removal: %v", rows)
	}
	res, out = doJSON(t, w.srv, "PATCH", w.commentsPath(docID)+"/"+commentID, w.member, map[string]any{"body": "x"})
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("patch after removal: %d code=%q", res.StatusCode, code)
	}
}

func TestDocumentCommentCollabRevisionsHTTP(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "Collab revisions", "workspace")
	otherDoc := w.createDoc(t, w.token, "Collab revisions other", "workspace")
	commentID := w.createComment(t, w.member, docID, "bản một", nil)

	revisionsPath := w.commentsPath(docID) + "/" + commentID + "/revisions"
	res, out := doJSON(t, w.srv, "GET", revisionsPath, w.rival, nil)
	if res.StatusCode != 200 || len(out["revisions"].([]any)) != 0 {
		t.Fatalf("fresh history: %d %v", res.StatusCode, out)
	}

	// Two edits: two rows, newest first, each with the body it replaced and
	// the actor of the edit that replaced it.
	res, out = doJSON(t, w.srv, "PATCH", w.commentsPath(docID)+"/"+commentID, w.member, map[string]any{"body": "bản hai"})
	if res.StatusCode != 200 {
		t.Fatalf("first edit: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "PATCH", w.commentsPath(docID)+"/"+commentID, w.token, map[string]any{"body": "bản ba"})
	if res.StatusCode != 200 {
		t.Fatalf("second edit: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", revisionsPath, w.member, nil)
	if res.StatusCode != 200 || len(out["revisions"].([]any)) != 2 {
		t.Fatalf("history after edits: %d %v", res.StatusCode, out)
	}
	rows := out["revisions"].([]any)
	newest := rows[0].(map[string]any)
	if newest["revision"].(float64) != 2 || newest["body"] != "bản hai" || newest["created_by_id"] != w.userID || newest["created_by_kind"] != "human" {
		t.Fatalf("newest revision: %v", newest)
	}
	oldest := rows[1].(map[string]any)
	if oldest["revision"].(float64) != 1 || oldest["body"] != "bản một" || oldest["created_by_id"] != w.memberID {
		t.Fatalf("oldest revision: %v", oldest)
	}

	// A comment that hangs on another document is the same 404 as an unknown
	// id; the history never leaks across documents.
	res, out = doJSON(t, w.srv, "GET", w.commentsPath(otherDoc)+"/"+commentID+"/revisions", w.member, nil)
	if code, class := errCodeClass(out); res.StatusCode != 404 || code != "not_found" || class != "missing" {
		t.Fatalf("history through the wrong document: %d code=%q class=%q", res.StatusCode, code, class)
	}

	// A tombstone answers 409 comment_deleted: the history is gone for real.
	if replyID := w.createComment(t, w.member, docID, "con", map[string]any{"parent_id": commentID}); replyID == "" {
		t.Fatal("reply id")
	}
	res, out = doJSON(t, w.srv, "DELETE", w.commentsPath(docID)+"/"+commentID, w.member, nil)
	if res.StatusCode != 200 || out["outcome"] != "tombstoned" {
		t.Fatalf("tombstone the commented root: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", revisionsPath, w.member, nil)
	if code, class := errCodeClass(out); res.StatusCode != 409 || code != "comment_deleted" || class != "" {
		t.Fatalf("history of a tombstone: %d code=%q class=%q", res.StatusCode, code, class)
	}
}
