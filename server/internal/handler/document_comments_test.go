package handler

// Handler-level tests for the G1-07 document comments HTTP surface (UNI-681;
// lane 07b). Every case drives the real Chi router over a real database with
// a real DocumentService: the flag gate, auth middleware, permission ladder,
// idempotency and error envelope are the things under test. Anonymous writes
// are refused by RequireAuth; an agent write cannot be expressed over HTTP at
// all (RequireAuth stamps a human user id and the handlers build
// service.Human), which TestDocumentCommentHandlersBuildOnlyHumanActors pins
// - the service gate itself is covered by internal/service
// TestDocumentCommentAnonymousAndAgent.

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// documentCollabWorld is the documents stack (05a + 07b) with the actors the
// comment ladder needs: the owner (manage), two workspace members (edit on a
// workspace-visible document), a viewer used with a view-only share, and an
// outsider who is in no organization at all.
type documentCollabWorld struct {
	srv      *httptest.Server
	docs     *service.DocumentService
	orgID    string
	wsID     string
	token    string // owner
	userID   string
	member   string
	memberID string
	rival    string // second member: edit level, not the author
	rivalID  string
	viewer   string // member with a view-only share on restricted documents
	viewerID string
	outsider string
}

// newDocumentCollabWorld builds the handler stack with DocumentService wired
// to an in-memory FileService fake and the `documents` flag on via the global
// override row the admin console writes.
func newDocumentCollabWorld(t *testing.T) *documentCollabWorld {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	docs.SetFiles(filesfake.New(filesfake.Options{}))
	d.Documents = docs
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID:        util.NewID(),
		FlagKey:   "documents",
		ScopeType: featureflags.ScopeGlobal,
		ScopeID:   "",
		Enabled:   true,
		Note:      "document comment handler tests",
		CreatedBy: "test",
	}); err != nil {
		t.Fatalf("enable documents flag: %v", err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}

	w := &documentCollabWorld{srv: srv, docs: docs}
	w.token, w.userID = filesRegister(t, srv, "collab-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "Collab Org", "slug": "collab-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/workspaces", w.token, map[string]string{"name": "Collab WS", "slug": "collab-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	w.wsID = out["workspace"].(map[string]any)["id"].(string)

	w.member, w.memberID = filesRegister(t, srv, "collab-member@example.com")
	w.rival, w.rivalID = filesRegister(t, srv, "collab-rival@example.com")
	w.viewer, w.viewerID = filesRegister(t, srv, "collab-viewer@example.com")
	w.outsider, _ = filesRegister(t, srv, "collab-outsider@example.com")
	for _, email := range []string{"collab-member@example.com", "collab-rival@example.com", "collab-viewer@example.com"} {
		res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+w.wsID+"/invitations", w.token,
			map[string]any{"emails": []string{email}, "role": "member"})
		if res.StatusCode != 200 {
			t.Fatalf("invite %s: %d %v", email, res.StatusCode, out)
		}
	}
	acceptInvitation(t, srv, w.member)
	acceptInvitation(t, srv, w.rival)
	acceptInvitation(t, srv, w.viewer)
	return w
}

// createDoc makes a page owned by the given token; visibility is
// "workspace" (members edit) or "restricted" (shares only).
func (w *documentCollabWorld) createDoc(t *testing.T, token, title, visibility string) string {
	t.Helper()
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", token, map[string]any{
		"title": title, "kind": "page", "visibility": visibility,
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph"}}},
	})
	if res.StatusCode != 201 {
		t.Fatalf("create doc %q: %d %v", title, res.StatusCode, out)
	}
	return out["document"].(map[string]any)["id"].(string)
}

// share grants one user a level on a document through the service (the share
// HTTP routes land with 05b; the comment surface has to answer for them now).
func (w *documentCollabWorld) share(t *testing.T, documentID, userID string, level service.DocumentLevel) {
	t.Helper()
	if _, err := w.docs.ShareDocument(context.Background(), service.Human(w.userID), documentID, service.DocumentShareInput{
		PrincipalType: service.DocumentPrincipalUser,
		PrincipalID:   userID,
		Level:         level,
	}); err != nil {
		t.Fatalf("share %s at %s: %v", userID, level, err)
	}
}

func (w *documentCollabWorld) commentsPath(documentID string) string {
	return "/api/v1/documents/" + documentID + "/comments"
}

// createComment posts one comment and returns its id.
func (w *documentCollabWorld) createComment(t *testing.T, token, documentID, body string, extra map[string]any) string {
	t.Helper()
	payload := map[string]any{"body": body}
	for k, v := range extra {
		payload[k] = v
	}
	res, out := doJSON(t, w.srv, "POST", w.commentsPath(documentID), token, payload)
	if res.StatusCode != 200 {
		t.Fatalf("create comment: %d %v", res.StatusCode, out)
	}
	return out["comment"].(map[string]any)["id"].(string)
}

func (w *documentCollabWorld) listComments(t *testing.T, token, documentID string, wantStatus int) []any {
	t.Helper()
	res, out := doJSON(t, w.srv, "GET", w.commentsPath(documentID), token, nil)
	if res.StatusCode != wantStatus {
		t.Fatalf("list comments: %d %v", res.StatusCode, out)
	}
	if wantStatus != 200 {
		return nil
	}
	return out["comments"].([]any)
}

func TestDocumentCommentHTTPLifecycle(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "Spec v1", "workspace")

	if comments := w.listComments(t, w.member, docID, 200); len(comments) != 0 {
		t.Fatalf("fresh thread: %v", comments)
	}

	// Create under an Idempotency-Key: edit level, author is the caller, the
	// type defaults to comment, and no parent is set.
	res, out := doJSONHeaders(t, w.srv, "POST", w.commentsPath(docID), w.member,
		map[string]string{"Idempotency-Key": "comment-1"}, map[string]any{"body": "Chỗ này cần số liệu Q3."})
	if res.StatusCode != 200 {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	comment := out["comment"].(map[string]any)
	commentID := comment["id"].(string)
	if comment["document_id"] != docID || comment["author_id"] != w.memberID || comment["author_kind"] != "human" {
		t.Fatalf("comment identity: %v", comment)
	}
	if comment["type"] != "comment" || comment["revision"].(float64) != 1 {
		t.Fatalf("comment type/revision: %v", comment)
	}
	if _, ok := comment["parent_id"]; ok {
		t.Fatalf("root comment carries parent_id: %v", comment)
	}
	if _, ok := comment["resolved_at"]; ok {
		t.Fatalf("fresh comment carries resolved_at: %v", comment)
	}
	if reactions, ok := comment["reactions"].([]any); !ok || len(reactions) != 0 {
		t.Fatalf("reactions must be [] on a fresh comment: %v", comment["reactions"])
	}

	// Same key + payload replays the stored answer; a different payload with
	// the same key is a conflict.
	res, out = doJSONHeaders(t, w.srv, "POST", w.commentsPath(docID), w.member,
		map[string]string{"Idempotency-Key": "comment-1"}, map[string]any{"body": "Chỗ này cần số liệu Q3."})
	if res.StatusCode != 200 || out["comment"].(map[string]any)["id"] != commentID {
		t.Fatalf("idempotent replay: %d %v", res.StatusCode, out)
	}
	res, out = doJSONHeaders(t, w.srv, "POST", w.commentsPath(docID), w.member,
		map[string]string{"Idempotency-Key": "comment-1"}, map[string]any{"body": "payload khác"})
	if code, class := errCodeClass(out); res.StatusCode != 409 || code != "idempotency_payload_mismatch" || class != "conflict" {
		t.Fatalf("idempotency mismatch: %d code=%q class=%q", res.StatusCode, code, class)
	}

	// A reply on the same document is accepted and reports its parent.
	replyID := w.createComment(t, w.member, docID, "Đồng ý với số liệu này.", map[string]any{"parent_id": commentID})
	res, out = doJSON(t, w.srv, "GET", w.commentsPath(docID), w.member, nil)
	if res.StatusCode != 200 || len(out["comments"].([]any)) != 2 {
		t.Fatalf("thread after reply: %d %v", res.StatusCode, out)
	}
	rows := out["comments"].([]any)
	if rows[0].(map[string]any)["id"] != commentID || rows[1].(map[string]any)["id"] != replyID {
		t.Fatalf("thread order (oldest first): %v", rows)
	}
	if rows[1].(map[string]any)["parent_id"] != commentID {
		t.Fatalf("reply parent: %v", rows[1])
	}

	// A parent on another document is refused; an unknown parent id is a 404.
	otherDoc := w.createDoc(t, w.token, "Spec v2", "workspace")
	res, out = doJSON(t, w.srv, "POST", w.commentsPath(otherDoc), w.member,
		map[string]any{"body": "trả lời chéo", "parent_id": commentID})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("cross-document parent: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "POST", w.commentsPath(docID), w.member,
		map[string]any{"body": "trả lời ma", "parent_id": "01J8X4CMTN1P2Q3R4S5T6U7W"})
	if code, class := errCodeClass(out); res.StatusCode != 404 || code != "not_found" || class != "missing" {
		t.Fatalf("unknown parent: %d code=%q class=%q", res.StatusCode, code, class)
	}

	// The public client can never mint a system comment_type.
	res, out = doJSON(t, w.srv, "POST", w.commentsPath(docID), w.member,
		map[string]any{"body": "hệ thống", "type": "system"})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("system comment type: %d code=%q", res.StatusCode, code)
	}
	if len(w.listComments(t, w.member, docID, 200)) != 2 {
		t.Fatalf("refused creates must not add rows")
	}

	// Author edits; another edit-level member cannot; manage (the owner) can.
	res, out = doJSON(t, w.srv, "PATCH", w.commentsPath(docID)+"/"+commentID, w.member, map[string]any{"body": "bản sửa của tác giả"})
	if res.StatusCode != 200 || out["comment"].(map[string]any)["revision"].(float64) != 2 {
		t.Fatalf("author edit: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "PATCH", w.commentsPath(docID)+"/"+commentID, w.rival, map[string]any{"body": "không phải của tôi"})
	if code, class := errCodeClass(out); res.StatusCode != 403 || code != "forbidden" || class != "permission" {
		t.Fatalf("rival edit: %d code=%q class=%q", res.StatusCode, code, class)
	}
	res, out = doJSON(t, w.srv, "PATCH", w.commentsPath(docID)+"/"+commentID, w.token, map[string]any{"body": "quản lý sửa"})
	if res.StatusCode != 200 {
		t.Fatalf("manage edit: %d %v", res.StatusCode, out)
	}

	// Reactions: add is idempotent per (comment, actor, emoji), the list
	// carries them, and remove is idempotent too.
	reactionPath := w.commentsPath(docID) + "/" + commentID + "/reactions"
	res, out = doJSON(t, w.srv, "POST", reactionPath, w.member, map[string]any{"emoji": "👍"})
	if res.StatusCode != 200 {
		t.Fatalf("add reaction: %d %v", res.StatusCode, out)
	}
	firstReaction := out["reaction"].(map[string]any)["id"].(string)
	if out["reaction"].(map[string]any)["comment_id"] != commentID {
		t.Fatalf("reaction identity: %v", out["reaction"])
	}
	res, out = doJSON(t, w.srv, "POST", reactionPath, w.member, map[string]any{"emoji": "👍"})
	if res.StatusCode != 200 || out["reaction"].(map[string]any)["id"] != firstReaction {
		t.Fatalf("idempotent reaction: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", reactionPath, w.token, map[string]any{"emoji": "🔥"})
	if res.StatusCode != 200 {
		t.Fatalf("second actor reaction: %d %v", res.StatusCode, out)
	}
	rows = w.listComments(t, w.member, docID, 200)
	reactions := rows[0].(map[string]any)["reactions"].([]any)
	if len(reactions) != 2 {
		t.Fatalf("reactions on the comment: %v", reactions)
	}
	res, out = doJSON(t, w.srv, "DELETE", reactionPath, w.member, map[string]any{"emoji": "👍"})
	if res.StatusCode != 200 || out["status"] != "ok" {
		t.Fatalf("remove reaction: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "DELETE", reactionPath, w.member, map[string]any{"emoji": "👍"})
	if res.StatusCode != 200 {
		t.Fatalf("idempotent reaction removal: %d %v", res.StatusCode, out)
	}
	rows = w.listComments(t, w.member, docID, 200)
	if reactions := rows[0].(map[string]any)["reactions"].([]any); len(reactions) != 1 {
		t.Fatalf("reactions after removal: %v", reactions)
	}

	// Resolve and reopen are edit-level and idempotent in both directions.
	resolvePath := w.commentsPath(docID) + "/" + commentID + "/resolve"
	res, out = doJSON(t, w.srv, "POST", resolvePath, w.rival, nil)
	if res.StatusCode != 200 {
		t.Fatalf("resolve: %d %v", res.StatusCode, out)
	}
	resolvedAt := out["comment"].(map[string]any)["resolved_at"]
	if resolvedAt == nil {
		t.Fatalf("resolved_at missing: %v", out["comment"])
	}
	res, out = doJSON(t, w.srv, "POST", resolvePath, w.rival, nil)
	if res.StatusCode != 200 || out["comment"].(map[string]any)["resolved_at"] != resolvedAt {
		t.Fatalf("second resolve must not move resolved_at: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "DELETE", resolvePath, w.rival, nil)
	if res.StatusCode != 200 {
		t.Fatalf("reopen: %d %v", res.StatusCode, out)
	}
	if _, ok := out["comment"].(map[string]any)["resolved_at"]; ok {
		t.Fatalf("reopened comment still carries resolved_at: %v", out["comment"])
	}
	res, out = doJSON(t, w.srv, "DELETE", resolvePath, w.rival, nil)
	if res.StatusCode != 200 {
		t.Fatalf("second reopen: %d %v", res.StatusCode, out)
	}

	// Delete is author-or-manage; the row and its reactions go together.
	res, out = doJSON(t, w.srv, "DELETE", w.commentsPath(docID)+"/"+commentID, w.rival, nil)
	if code, class := errCodeClass(out); res.StatusCode != 403 || code != "forbidden" || class != "permission" {
		t.Fatalf("rival delete: %d code=%q class=%q", res.StatusCode, code, class)
	}
	res, out = doJSON(t, w.srv, "DELETE", w.commentsPath(docID)+"/"+commentID, w.member, nil)
	if res.StatusCode != 200 || out["status"] != "ok" {
		t.Fatalf("author delete: %d %v", res.StatusCode, out)
	}
	if rows = w.listComments(t, w.member, docID, 200); len(rows) != 1 {
		t.Fatalf("thread after delete: %v", rows)
	}
	res, out = doJSON(t, w.srv, "DELETE", w.commentsPath(docID)+"/"+commentID, w.member, nil)
	if code, class := errCodeClass(out); res.StatusCode != 404 || code != "not_found" || class != "missing" {
		t.Fatalf("delete twice: %d code=%q class=%q", res.StatusCode, code, class)
	}
}

// TestDocumentCommentHTTPDocumentBinding pins the URL-to-row binding for the
// six id-addressed comment routes: a comment that hangs on another document, a
// document id from another tenant, and a document id that does not exist all
// answer the same 404 an unknown comment answers - and nothing on the real
// document moves. The service still authorizes against the comment's own
// document; this test proves the HTTP route cannot name document A while
// mutating a comment on document B.
func TestDocumentCommentHTTPDocumentBinding(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docA := w.createDoc(t, w.token, "Spec A", "workspace")
	docB := w.createDoc(t, w.token, "Spec B", "workspace")
	commentID := w.createComment(t, w.member, docB, "bình luận trên B", nil)

	// A second tenant with its own org, workspace and document: its id is a
	// real document that no one in this world can reach.
	otherToken, _ := filesRegister(t, w.srv, "binding-other-tenant@example.com")
	res, out := doJSON(t, w.srv, "POST", "/api/v1/orgs", otherToken, map[string]string{"name": "Other Org", "slug": "binding-other-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create other org: %d %v", res.StatusCode, out)
	}
	otherOrgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+otherOrgID+"/workspaces", otherToken, map[string]string{"name": "Other WS", "slug": "binding-other-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create other ws: %d %v", res.StatusCode, out)
	}
	otherWSID := out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+otherWSID+"/documents", otherToken, map[string]any{
		"title": "Other Doc", "kind": "page", "visibility": "workspace",
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph"}}},
	})
	if res.StatusCode != 201 {
		t.Fatalf("create other doc: %d %v", res.StatusCode, out)
	}
	otherDocID := out["document"].(map[string]any)["id"].(string)

	for _, doc := range []struct{ label, id string }{
		{"other-document", docA},
		{"cross-tenant", otherDocID},
		{"missing-document", "01J8X4DOC1N2P3Q4R5S6T7U8"},
	} {
		for _, tc := range []struct {
			name   string
			method string
			suffix string
			body   any
		}{
			{"patch", "PATCH", "/" + commentID, map[string]any{"body": "sai tài liệu"}},
			{"delete", "DELETE", "/" + commentID, nil},
			{"resolve", "POST", "/" + commentID + "/resolve", nil},
			{"reopen", "DELETE", "/" + commentID + "/resolve", nil},
			{"reaction-add", "POST", "/" + commentID + "/reactions", map[string]any{"emoji": "🚫"}},
			{"reaction-remove", "DELETE", "/" + commentID + "/reactions", map[string]any{"emoji": "🚫"}},
		} {
			res, out := doJSON(t, w.srv, tc.method, w.commentsPath(doc.id)+tc.suffix, w.member, tc.body)
			if code, class := errCodeClass(out); res.StatusCode != 404 || code != "not_found" || class != "missing" {
				t.Fatalf("%s %s %s: %d code=%q class=%q, want 404 not_found/missing", doc.label, tc.method, tc.name, res.StatusCode, code, class)
			}
		}
	}

	// Nothing moved on the real document: the row is still there with its
	// original body and revision, still open, and with no reactions.
	rows := w.listComments(t, w.member, docB, 200)
	if len(rows) != 1 {
		t.Fatalf("thread on B changed: %v", rows)
	}
	row := rows[0].(map[string]any)
	if row["id"] != commentID || row["body"] != "bình luận trên B" || row["revision"].(float64) != 1 {
		t.Fatalf("comment on B mutated: %v", row)
	}
	if _, ok := row["resolved_at"]; ok {
		t.Fatalf("comment on B resolved through a mismatched URL: %v", row)
	}
	if reactions := row["reactions"].([]any); len(reactions) != 0 {
		t.Fatalf("reactions on B mutated through a mismatched URL: %v", reactions)
	}

	// The pair still works when the URL names the right document.
	res, out = doJSON(t, w.srv, "PATCH", w.commentsPath(docB)+"/"+commentID, w.member, map[string]any{"body": "sửa đúng tài liệu"})
	if res.StatusCode != 200 || out["comment"].(map[string]any)["revision"].(float64) != 2 {
		t.Fatalf("same-document patch: %d %v", res.StatusCode, out)
	}
}

func TestDocumentCommentHTTPPermissions(t *testing.T) {
	w := newDocumentCollabWorld(t)
	restricted := w.createDoc(t, w.token, "Bí mật", "restricted")
	commentPath := w.commentsPath(restricted)

	// A plain workspace member has no level at all on a restricted document:
	// every route answers 404 and never leaks the row.
	res, out := doJSON(t, w.srv, "GET", commentPath, w.member, nil)
	if code, class := errCodeClass(out); res.StatusCode != 404 || code != "not_found" || class != "missing" {
		t.Fatalf("member read restricted: %d code=%q class=%q", res.StatusCode, code, class)
	}
	res, out = doJSON(t, w.srv, "POST", commentPath, w.member, map[string]any{"body": "lén"})
	if res.StatusCode != 404 {
		t.Fatalf("member comment restricted: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+restricted+"/favorite", w.member, nil)
	if res.StatusCode != 404 {
		t.Fatalf("member favorite restricted: %d %v", res.StatusCode, out)
	}

	// The owner manages it.
	if comments := w.listComments(t, w.token, restricted, 200); len(comments) != 0 {
		t.Fatalf("owner thread: %v", comments)
	}
	ownerComment := w.createComment(t, w.token, restricted, "ghi chú của chủ sở hữu", nil)

	// A view share opens reads and favorites; every write stays closed.
	w.share(t, restricted, w.viewerID, service.DocumentLevelView)
	if comments := w.listComments(t, w.viewer, restricted, 200); len(comments) != 1 {
		t.Fatalf("viewer thread: %v", comments)
	}
	res, out = doJSON(t, w.srv, "POST", commentPath, w.viewer, map[string]any{"body": "chỉ được đọc"})
	if code, class := errCodeClass(out); res.StatusCode != 403 || code != "forbidden" || class != "permission" {
		t.Fatalf("viewer comment: %d code=%q class=%q", res.StatusCode, code, class)
	}
	res, out = doJSON(t, w.srv, "PATCH", commentPath+"/"+ownerComment, w.viewer, map[string]any{"body": "sửa lén"})
	if res.StatusCode != 403 {
		t.Fatalf("viewer edit: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "DELETE", commentPath+"/"+ownerComment, w.viewer, nil)
	if res.StatusCode != 403 {
		t.Fatalf("viewer delete: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", commentPath+"/"+ownerComment+"/resolve", w.viewer, nil)
	if res.StatusCode != 403 {
		t.Fatalf("viewer resolve: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", commentPath+"/"+ownerComment+"/reactions", w.viewer, map[string]any{"emoji": "👍"})
	if res.StatusCode != 403 {
		t.Fatalf("viewer reaction: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+restricted+"/favorite", w.viewer, nil)
	if res.StatusCode != 200 {
		t.Fatalf("viewer favorite: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+restricted+"/favorite", w.viewer, nil)
	if res.StatusCode != 200 {
		t.Fatalf("viewer unfavorite: %d %v", res.StatusCode, out)
	}

	// Someone outside the organization learns nothing: same 404 as a missing
	// document, on reads and writes alike.
	for _, tc := range []struct {
		method string
		path   string
		body   any
	}{
		{"GET", commentPath, nil},
		{"POST", commentPath, map[string]any{"body": "lén"}},
		{"PATCH", commentPath + "/" + ownerComment, map[string]any{"body": "lén"}},
		{"DELETE", commentPath + "/" + ownerComment, nil},
		{"POST", commentPath + "/" + ownerComment + "/resolve", nil},
		{"DELETE", commentPath + "/" + ownerComment + "/resolve", nil},
		{"POST", commentPath + "/" + ownerComment + "/reactions", map[string]any{"emoji": "👍"}},
		{"DELETE", commentPath + "/" + ownerComment + "/reactions", map[string]any{"emoji": "👍"}},
		{"POST", "/api/v1/documents/" + restricted + "/favorite", nil},
		{"DELETE", "/api/v1/documents/" + restricted + "/favorite", nil},
		{"GET", "/api/v1/orgs/" + w.orgID + "/documents/favorites", nil},
	} {
		res, out := doJSON(t, w.srv, tc.method, tc.path, w.outsider, tc.body)
		if code, class := errCodeClass(out); res.StatusCode != 404 || code != "not_found" || class != "missing" {
			t.Fatalf("outsider %s %s: %d code=%q class=%q", tc.method, tc.path, res.StatusCode, code, class)
		}
	}

	// Without a bearer token every route is a 401 - reads included.
	for _, tc := range []struct {
		method string
		path   string
		body   any
	}{
		{"GET", commentPath, nil},
		{"POST", commentPath, map[string]any{"body": "nặc danh"}},
		{"PATCH", commentPath + "/" + ownerComment, map[string]any{"body": "nặc danh"}},
		{"DELETE", commentPath + "/" + ownerComment, nil},
		{"POST", commentPath + "/" + ownerComment + "/resolve", nil},
		{"DELETE", commentPath + "/" + ownerComment + "/resolve", nil},
		{"POST", commentPath + "/" + ownerComment + "/reactions", map[string]any{"emoji": "👍"}},
		{"DELETE", commentPath + "/" + ownerComment + "/reactions", map[string]any{"emoji": "👍"}},
		{"POST", "/api/v1/documents/" + restricted + "/favorite", nil},
		{"DELETE", "/api/v1/documents/" + restricted + "/favorite", nil},
		{"GET", "/api/v1/orgs/" + w.orgID + "/documents/favorites", nil},
	} {
		res, _ := doJSON(t, w.srv, tc.method, tc.path, "", tc.body)
		if res.StatusCode != 401 {
			t.Fatalf("anonymous %s %s: %d, want 401", tc.method, tc.path, res.StatusCode)
		}
	}
}

// TestDocumentCommentHandlersBuildOnlyHumanActors pins the agent half of the
// authz matrix at the only place HTTP can express it. RequireAuth always
// stamps a human user id (there is no agent bearer token in this server), so
// the 07b handlers have no way to build an agent actor at all; the service
// gate that refuses one that arrives by another path (agents are capped at
// view; TestDocumentCommentAnonymousAndAgent) stays the enforcement. A future
// handler that mints an agent identity fails here first.
func TestDocumentCommentHandlersBuildOnlyHumanActors(t *testing.T) {
	for _, name := range []string{"document_comments.go", "document_favorites.go"} {
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		text := string(src)
		for _, forbidden := range []string{"audit.Actor{", "audit.KindAgent", "audit.KindSystem", "service.Agent(", "service.System("} {
			if strings.Contains(text, forbidden) {
				t.Errorf("%s constructs an actor identity (%q); handlers build actors only with service.Human", name, forbidden)
			}
		}
		if !strings.Contains(text, "service.Human(") {
			t.Errorf("%s never builds its actor with service.Human", name)
		}
	}
}

func TestDocumentCommentsFlagOff404(t *testing.T) {
	d, _ := newTestDeps(t, nil, discardOutbox{})
	q := db.New(testPool)
	docs := service.NewDocumentService(testPool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(testPool, q))
	docs.SetFiles(filesfake.New(filesfake.Options{}))
	d.Documents = docs
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	token, _ := filesRegister(t, srv, "flagoff-comments@example.com")
	disableDocumentsFlag(t)

	docID := "01J8X4DOC0N1P2Q3R4S5T6U7"
	commentID := "01J8X4CMTN1P2Q3R4S5T6U7V"
	commentPath := "/api/v1/documents/" + docID + "/comments"
	for _, tc := range []struct {
		method string
		path   string
		body   any
	}{
		{"GET", commentPath, nil},
		{"POST", commentPath, map[string]any{"body": "x"}},
		{"PATCH", commentPath + "/" + commentID, map[string]any{"body": "x"}},
		{"DELETE", commentPath + "/" + commentID, nil},
		{"POST", commentPath + "/" + commentID + "/resolve", nil},
		{"DELETE", commentPath + "/" + commentID + "/resolve", nil},
		{"POST", commentPath + "/" + commentID + "/reactions", map[string]any{"emoji": "👍"}},
		{"DELETE", commentPath + "/" + commentID + "/reactions", map[string]any{"emoji": "👍"}},
		{"POST", "/api/v1/documents/" + docID + "/favorite", nil},
		{"DELETE", "/api/v1/documents/" + docID + "/favorite", nil},
		{"GET", "/api/v1/orgs/01J8X4ORGN1P2Q3R4S5T6U7V8/documents/favorites", nil},
	} {
		res, out := doJSON(t, srv, tc.method, tc.path, token, tc.body)
		if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "feature_disabled" {
			t.Fatalf("%s %s with flag off: %d code=%q, want 404 feature_disabled", tc.method, tc.path, res.StatusCode, code)
		}
	}
	// Unauthenticated requests still answer 401, not the flag gate.
	res, _ := doJSON(t, srv, "GET", commentPath, "", nil)
	if res.StatusCode != 401 {
		t.Fatalf("unauthenticated: %d, want 401", res.StatusCode)
	}
}

// TestDocumentCommentsNilService501 keeps the 05a rule: with the flag on and
// DocumentService unwired every 07b route answers 501, never a panic.
func TestDocumentCommentsNilService501(t *testing.T) {
	d, _ := newTestDeps(t, nil, discardOutbox{})
	q := db.New(testPool)
	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "documents", ScopeType: featureflags.ScopeGlobal,
		Enabled: true, Note: "nil service test", CreatedBy: "test",
	}); err != nil {
		t.Fatalf("enable documents flag: %v", err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
	srv := httptest.NewServer(New(d)) // d.Documents deliberately nil
	t.Cleanup(srv.Close)
	token, _ := filesRegister(t, srv, "nil-comments@example.com")

	docID := "01J8X4DOC0N1P2Q3R4S5T6U7"
	commentID := "01J8X4CMTN1P2Q3R4S5T6U7V"
	commentPath := "/api/v1/documents/" + docID + "/comments"
	for _, tc := range []struct {
		method string
		path   string
		body   any
	}{
		{"GET", commentPath, nil},
		{"POST", commentPath, map[string]any{"body": "x"}},
		{"PATCH", commentPath + "/" + commentID, map[string]any{"body": "x"}},
		{"DELETE", commentPath + "/" + commentID, nil},
		{"POST", commentPath + "/" + commentID + "/resolve", nil},
		{"DELETE", commentPath + "/" + commentID + "/resolve", nil},
		{"POST", commentPath + "/" + commentID + "/reactions", map[string]any{"emoji": "👍"}},
		{"DELETE", commentPath + "/" + commentID + "/reactions", map[string]any{"emoji": "👍"}},
		{"POST", "/api/v1/documents/" + docID + "/favorite", nil},
		{"DELETE", "/api/v1/documents/" + docID + "/favorite", nil},
		{"GET", "/api/v1/orgs/01J8X4ORGN1P2Q3R4S5T6U7V8/documents/favorites", nil},
	} {
		res, out := doJSON(t, srv, tc.method, tc.path, token, tc.body)
		if code, _ := errCodeClass(out); res.StatusCode != 501 || code != "storage_unavailable" {
			t.Fatalf("%s %s with nil Documents: %d code=%q, want 501 storage_unavailable", tc.method, tc.path, res.StatusCode, code)
		}
	}
}

// TestDocumentCommentsOpenAPICatalog proves every 07b route is in the spec
// built from the router catalog, with the SDI/SDO reflected (examples ride on
// the description/example tags) and the new {documentID,commentID} path-param
// case present.
func TestDocumentCommentsOpenAPICatalog(t *testing.T) {
	h := New(Deps{
		Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true},
		Log: slog.Default(),
	})
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	res, err := srv.Client().Get(srv.URL + "/swagger/doc.json")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("doc.json: %d", res.StatusCode)
	}
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}

	commentPath := "/api/v1/documents/{documentID}/comments"
	for _, tc := range []struct{ method, path string }{
		{"get", commentPath},
		{"post", commentPath},
		{"patch", commentPath + "/{commentID}"},
		{"delete", commentPath + "/{commentID}"},
		{"post", commentPath + "/{commentID}/resolve"},
		{"delete", commentPath + "/{commentID}/resolve"},
		{"post", commentPath + "/{commentID}/reactions"},
		{"delete", commentPath + "/{commentID}/reactions"},
		{"post", "/api/v1/documents/{documentID}/favorite"},
		{"delete", "/api/v1/documents/{documentID}/favorite"},
		{"get", "/api/v1/orgs/{orgID}/documents/favorites"},
	} {
		ops, ok := spec.Paths[tc.path]
		if !ok {
			t.Errorf("%s %s missing from the OpenAPI spec", strings.ToUpper(tc.method), tc.path)
			continue
		}
		if _, ok := ops[tc.method]; !ok {
			t.Errorf("%s %s missing from the OpenAPI spec", strings.ToUpper(tc.method), tc.path)
		}
	}

	// Examples: the create SDI carries a body example, the comment path param
	// an id example, and the list SDO documents an emoji example.
	for _, want := range []string{
		"Chỗ này cần số liệu Q3.",
		"01J8X4CMTN1P2Q3R4S5T6U7V",
		"01J8X4DOC0N1P2Q3R4S5T6U7",
	} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("OpenAPI spec lacks example %q", want)
		}
	}
}
