package service

// G8-03 (UNI-1398): the collaboration half of document comments, on the real
// database - thread kinds (comment/discussion), the document-wide list_token,
// the structure-keeping soft delete, the edit history rows and the purge path
// over the four comment tables (contract-collab sections 2.1-2.7, 5, 6).

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// collabCount counts rows of one comment-orbit table for a comment.
func collabCount(t *testing.T, f *docPermFixture, table, commentID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM `+table+` WHERE comment_id = $1`, commentID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func collabWantCode(t *testing.T, err error, want string) {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != want {
		t.Fatalf("error = %v, want code %q", err, want)
	}
}

// collabMention seeds one mention row: G8-05 writes these; G8-03 owns their
// cleanup, so the tests put them there by hand.
func collabMention(t *testing.T, f *docPermFixture, tn docTenant, documentID, commentID string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO document_comment_mentions
		(id, organization_id, workspace_id, document_id, comment_id, user_id, state, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, 'human')`,
		util.NewID(), tn.orgID, tn.wsA, documentID, commentID, tn.outsider.ID, tn.member.ID); err != nil {
		t.Fatal(err)
	}
}

// kind picks the thread flow (comment_type), an empty kind inherits a reply's
// parent and starts a discussion for a root; the pre-G8 `type` field is
// validated against its old allowlist and never decides the kind. OQ-C2: a
// root `kind=comment` needs an anchor + base_version_id, so an anchorless
// root is refused and only the anchored create mints a comment row.
func TestDocumentCommentKind(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "kind")
	member, acl := Human(tn.member.ID), Human(tn.aclOwner.ID)

	// OQ-C2: an anchorable xlsx file document supplies both the document the
	// anchored root lives on and the version it binds to.
	anchorDoc, versions := f.anchorDoc(t, tn, "xlsx", 1)
	if _, err := f.svc.AddDocumentComment(f.ctx, member, anchorDoc.ID, AddCommentInput{Body: "không neo", CommentType: "comment"}, ""); err == nil {
		t.Fatal("anchorless root kind=comment accepted")
	}
	anchored, err := f.svc.AddDocumentComment(f.ctx, member, anchorDoc.ID, AddCommentInput{
		Body: "có neo", CommentType: "comment",
		Anchor: anchorRaw("xlsx", nil), BaseVersionID: versions[0].ID,
	}, "")
	if err != nil || anchored.CommentType != "comment" {
		t.Fatalf("kind=comment = %+v %v", anchored, err)
	}
	if anchored.AnchorVersionID.String != versions[0].ID || !anchored.AnchorVersionID.Valid {
		t.Fatalf("anchored root version = %+v", anchored.AnchorVersionID)
	}
	thread, err := f.svc.AddDocumentComment(f.ctx, acl, anchorDoc.ID, AddCommentInput{Body: "thảo luận", CommentType: "discussion"}, "")
	if err != nil || thread.CommentType != "discussion" {
		t.Fatalf("kind=discussion = %+v %v", thread, err)
	}
	root, err := f.svc.AddDocumentComment(f.ctx, member, anchorDoc.ID, AddCommentInput{Body: "gốc không kind"}, "")
	if err != nil || root.CommentType != "discussion" {
		t.Fatalf("default root kind = %+v %v", root, err)
	}
	reply, err := f.svc.AddDocumentComment(f.ctx, acl, anchorDoc.ID, AddCommentInput{Body: "trả lời", ParentID: &anchored.ID}, "")
	if err != nil || reply.CommentType != "comment" {
		t.Fatalf("reply kind = %+v %v", reply, err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, member, anchorDoc.ID, AddCommentInput{Body: "đổi loại", ParentID: &anchored.ID, CommentType: "discussion"}, ""); err == nil {
		t.Fatal("a reply changed its thread's kind")
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, member, anchorDoc.ID, AddCommentInput{Body: "lạ", CommentType: "system"}, ""); err == nil {
		t.Fatal("system kind accepted")
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, member, anchorDoc.ID, AddCommentInput{Body: "lạ", CommentType: "nonsense"}, ""); err == nil {
		t.Fatal("unknown kind accepted")
	}

	// The pre-G8 `type` field: "comment" (or empty) is accepted and ignored.
	legacy, err := f.svc.AddDocumentComment(f.ctx, member, anchorDoc.ID, AddCommentInput{Body: "client cũ", LegacyType: "comment"}, "")
	if err != nil || legacy.CommentType != "discussion" {
		t.Fatalf("legacy type create = %+v %v", legacy, err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, member, anchorDoc.ID, AddCommentInput{Body: "x", LegacyType: "status_change"}, ""); err == nil {
		t.Fatal("legacy type outside its old allowlist accepted")
	}

	// The list filters in memory on the same value; empty kind returns both,
	// one token per document regardless of the filter.
	all, err := f.svc.DocumentComments(f.ctx, member, anchorDoc.ID, DocumentCommentListInput{})
	if err != nil || len(all.Rows) != 5 {
		t.Fatalf("all rows = %d %v", len(all.Rows), err)
	}
	comments, err := f.svc.DocumentComments(f.ctx, member, anchorDoc.ID, DocumentCommentListInput{Kind: "comment"})
	if err != nil || len(comments.Rows) != 2 {
		t.Fatalf("kind=comment rows = %d %v", len(comments.Rows), err)
	}
	discussions, err := f.svc.DocumentComments(f.ctx, member, anchorDoc.ID, DocumentCommentListInput{Kind: "discussion"})
	if err != nil || len(discussions.Rows) != 3 {
		t.Fatalf("kind=discussion rows = %d %v", len(discussions.Rows), err)
	}
	for _, r := range comments.Rows {
		if r.CommentType != "comment" {
			t.Fatalf("kind=comment returned %q", r.CommentType)
		}
	}
	if comments.Token != all.Token || discussions.Token != all.Token {
		t.Fatal("the list_token moved with the kind filter")
	}
	if _, err := f.svc.DocumentComments(f.ctx, member, anchorDoc.ID, DocumentCommentListInput{Kind: "bogus"}); err == nil {
		t.Fatal("unknown kind filter accepted")
	}
}

// The list_token is the document-wide fingerprint of (id, updated_at,
// anchor_state): an unchanged probe answers Unchanged with no rows, and every
// edit, resolve, create or hard delete moves it - a hard delete moves it even
// though no row is newer.
func TestDocumentCommentListToken(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "tok")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	empty, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{})
	if err != nil || empty.Token == "" || !strings.HasPrefix(empty.Token, "lt1:") {
		t.Fatalf("empty token = %q %v", empty.Token, err)
	}
	if probe, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{SinceToken: empty.Token}); err != nil || !probe.Unchanged || len(probe.Rows) != 0 || probe.Token != empty.Token {
		t.Fatalf("unchanged probe = %+v %v", probe, err)
	}

	created, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "một"}, "")
	if err != nil {
		t.Fatal(err)
	}
	afterCreate, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{})
	if err != nil || afterCreate.Token == empty.Token || len(afterCreate.Rows) != 1 {
		t.Fatalf("token after create = %q vs %q rows=%d %v", afterCreate.Token, empty.Token, len(afterCreate.Rows), err)
	}
	if probe, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{SinceToken: empty.Token}); err != nil || probe.Unchanged {
		t.Fatalf("stale token was answered unchanged: %+v %v", probe, err)
	}

	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, created.ID, UpdateCommentInput{Body: "sửa"}); err != nil {
		t.Fatal(err)
	}
	afterEdit, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{SinceToken: afterCreate.Token})
	if err != nil || afterEdit.Unchanged {
		t.Fatalf("edit did not move the token: %+v %v", afterEdit, err)
	}

	if _, err := f.svc.ResolveDocumentComment(f.ctx, member, created.ID); err != nil {
		t.Fatal(err)
	}
	afterResolve, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{SinceToken: afterEdit.Token})
	if err != nil || afterResolve.Unchanged {
		t.Fatalf("resolve did not move the token: %+v %v", afterResolve, err)
	}

	// A hard delete removes a row from the hash set: the token moves even
	// though the surviving row's updated_at never changed.
	gone, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "tạm"}, "")
	if err != nil {
		t.Fatal(err)
	}
	beforeDelete, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{})
	if err != nil {
		t.Fatal(err)
	}
	if outcome, err := f.svc.DeleteDocumentComment(f.ctx, member, gone.ID); err != nil || outcome != DocumentCommentOutcomeRemoved {
		t.Fatalf("hard delete = %q %v", outcome, err)
	}
	if probe, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{SinceToken: beforeDelete.Token}); err != nil || probe.Unchanged {
		t.Fatalf("hard delete did not move the token: %+v %v", probe, err)
	}
}

// The token is computed from the rows one list call already returned, never
// by a second read: a create that lands between the read and the answer still
// shows up on the caller's next poll with the token it stored.
func TestDocumentCommentListTokenNeverRunsAhead(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "tokrace")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	armed := true
	documentCommentsAfterRead = func() {
		if !armed {
			return
		}
		armed = false
		if _, err := f.svc.AddDocumentComment(context.Background(), member, d.ID, AddCommentInput{Body: "chen vào"}, ""); err != nil {
			t.Errorf("interleaved create: %v", err)
		}
	}
	t.Cleanup(func() { documentCommentsAfterRead = nil })

	first, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Rows) != 0 {
		t.Fatalf("list returned rows the token did not hash: %d", len(first.Rows))
	}
	// The client stores first.Token and polls with it: it must NOT be told
	// unchanged, or the new row would never arrive.
	second, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{SinceToken: first.Token})
	if err != nil {
		t.Fatal(err)
	}
	if second.Unchanged {
		t.Fatal("the token ran ahead of the rows: the interleaved create was swallowed")
	}
	if len(second.Rows) != 1 {
		t.Fatalf("next poll rows = %d, want the interleaved create", len(second.Rows))
	}
}

// Delete keeps the structure: with replies the comment becomes a tombstone
// (body gone, history and reactions deleted for real, mentions removed) while
// its replies survive; without replies the row is removed. A tombstoned
// ancestor that loses its last child is removed with it, up to the root.
func TestDocumentCommentDeleteKeepsTheStructure(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "tomb")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member, acl := Human(tn.member.ID), Human(tn.aclOwner.ID)

	root, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "gốc"}, "")
	if err != nil {
		t.Fatal(err)
	}
	reply, err := f.svc.AddDocumentComment(f.ctx, acl, d.ID, AddCommentInput{Body: "phản hồi", ParentID: &root.ID}, "")
	if err != nil {
		t.Fatal(err)
	}
	// History, a reaction and a mention row exist before the delete; the
	// tombstone must leave none of them behind (mentions stay as `removed`).
	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, root.ID, UpdateCommentInput{Body: "gốc (đã sửa)"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddDocumentCommentReaction(f.ctx, member, root.ID, "👍"); err != nil {
		t.Fatal(err)
	}
	collabMention(t, f, tn, d.ID, root.ID)

	outcome, err := f.svc.DeleteDocumentComment(f.ctx, member, root.ID)
	if err != nil || outcome != DocumentCommentOutcomeTombstoned {
		t.Fatalf("delete with replies = %q %v", outcome, err)
	}
	tombstone, err := f.svc.GetDocumentComment(f.ctx, member, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !tombstone.DeletedAt.Valid || tombstone.Body != "" || tombstone.DeletedByID.String != tn.member.ID || tombstone.DeletedByKind.String != "human" {
		t.Fatalf("tombstone = %+v", tombstone)
	}
	if collabCount(t, f, "document_comment_revisions", root.ID) != 0 {
		t.Fatal("a tombstone kept its edit history")
	}
	if collabCount(t, f, "comment_reactions", root.ID) != 0 {
		t.Fatal("a tombstone kept its reactions")
	}
	var state string
	if err := f.pool.QueryRow(f.ctx, `SELECT state FROM document_comment_mentions WHERE comment_id = $1`, root.ID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "removed" {
		t.Fatalf("mention state = %q, want removed", state)
	}
	// The reply survives; the frame keeps its place in the list.
	list, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{})
	if err != nil || len(list.Rows) != 2 {
		t.Fatalf("list after tombstone = %d %v", len(list.Rows), err)
	}

	// A tombstone takes no new direct reply, no edit and no resolve.
	if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "vào khung", ParentID: &root.ID}, ""); err == nil {
		t.Fatal("a reply to a tombstone was accepted")
	} else {
		collabWantCode(t, err, "comment_deleted")
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, root.ID, UpdateCommentInput{Body: "sửa khung"}); err == nil {
		t.Fatal("a tombstone was edited")
	} else {
		collabWantCode(t, err, "comment_deleted")
	}
	if _, err := f.svc.ResolveDocumentComment(f.ctx, member, root.ID); err == nil {
		t.Fatal("a tombstone was resolved")
	} else {
		collabWantCode(t, err, "comment_deleted")
	}
	if _, err := f.svc.UnresolveDocumentComment(f.ctx, member, root.ID); err == nil {
		t.Fatal("a tombstone was reopened")
	} else {
		collabWantCode(t, err, "comment_deleted")
	}

	// Replying to a surviving reply of the tombstoned root still works.
	if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "dưới phản hồi", ParentID: &reply.ID}, ""); err != nil {
		t.Fatalf("reply to a surviving reply: %v", err)
	}
	// Deleting the tombstone again is a no-op with the same outcome.
	if again, err := f.svc.DeleteDocumentComment(f.ctx, member, root.ID); err != nil || again != DocumentCommentOutcomeTombstoned {
		t.Fatalf("second delete = %q %v", again, err)
	}

	// The nested branch, on the surviving reply: a child that has a child of
	// its own tombstones when deleted; removing the grandchild hardens into a
	// cascade - the childless tombstone between them goes in the same command
	// (OQ-C4) and the live reply above it stops the chain.
	last, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "con cuối", ParentID: &reply.ID}, "")
	if err != nil {
		t.Fatal(err)
	}
	grand, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "cháu", ParentID: &last.ID}, "")
	if err != nil {
		t.Fatal(err)
	}
	if outcome, err := f.svc.DeleteDocumentComment(f.ctx, member, last.ID); err != nil || outcome != DocumentCommentOutcomeTombstoned {
		t.Fatalf("delete of a comment with a child = %q %v", outcome, err)
	}
	if c, err := f.svc.GetDocumentComment(f.ctx, member, last.ID); err != nil || !c.DeletedAt.Valid {
		t.Fatalf("a nested delete did not tombstone: %+v %v", c, err)
	}
	if outcome, err := f.svc.DeleteDocumentComment(f.ctx, member, grand.ID); err != nil || outcome != DocumentCommentOutcomeRemoved {
		t.Fatalf("delete of the grandchild = %q %v", outcome, err)
	}
	for _, id := range []string{grand.ID, last.ID} {
		if _, err := f.svc.GetDocumentComment(f.ctx, member, id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("the cascade left comment %s behind: %v", id, err)
		}
	}
	// The live reply above the cascade survives, and so does the root frame.
	if _, err := f.svc.GetDocumentComment(f.ctx, member, reply.ID); err != nil {
		t.Fatalf("the cascade climbed past a live parent: %v", err)
	}
	if c, err := f.svc.GetDocumentComment(f.ctx, member, root.ID); err != nil || !c.DeletedAt.Valid {
		t.Fatalf("root frame after the cascade: %+v %v", c, err)
	}
}

// A comment with no child is removed for real: its reactions, revisions and
// mentions go with it (no FK; service cleanup in the same transaction).
func TestDocumentCommentRemoveWithoutReplies(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "hard")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	c, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "xóa hẳn"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, c.ID, UpdateCommentInput{Body: "sửa"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddDocumentCommentReaction(f.ctx, member, c.ID, "👍"); err != nil {
		t.Fatal(err)
	}
	collabMention(t, f, tn, d.ID, c.ID)

	if outcome, err := f.svc.DeleteDocumentComment(f.ctx, member, c.ID); err != nil || outcome != DocumentCommentOutcomeRemoved {
		t.Fatalf("delete = %q %v", outcome, err)
	}
	if _, err := f.svc.GetDocumentComment(f.ctx, member, c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("removed comment still readable: %v", err)
	}
	for _, table := range []string{"document_comment_revisions", "comment_reactions", "document_comment_mentions"} {
		if n := collabCount(t, f, table, c.ID); n != 0 {
			t.Fatalf("%s kept %d rows of a removed comment", table, n)
		}
	}
	list, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{})
	if err != nil || len(list.Rows) != 0 {
		t.Fatalf("list after removal = %d %v", len(list.Rows), err)
	}
}

// One edit writes exactly one revision row: the body being replaced and the
// revision number it carried, with the editor as its author (OQ-C3).
func TestDocumentCommentEditWritesOneRevision(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "rev")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member, acl := Human(tn.member.ID), Human(tn.aclOwner.ID)

	c, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "bản một"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, c.ID, UpdateCommentInput{Body: "bản hai"}); err != nil {
		t.Fatal(err)
	}
	revs, err := f.svc.DocumentCommentRevisions(f.ctx, member, d.ID, c.ID)
	if err != nil || len(revs) != 1 {
		t.Fatalf("revisions = %d %v", len(revs), err)
	}
	if revs[0].Body != "bản một" || revs[0].Revision != 1 || revs[0].CreatedBy != tn.member.ID || revs[0].CreatedByKind != "human" {
		t.Fatalf("revision row = %+v", revs[0])
	}

	if _, err := f.svc.UpdateDocumentComment(f.ctx, acl, c.ID, UpdateCommentInput{Body: "bản ba"}); err != nil {
		t.Fatal(err)
	}
	revs, err = f.svc.DocumentCommentRevisions(f.ctx, member, d.ID, c.ID)
	if err != nil || len(revs) != 2 {
		t.Fatalf("revisions after second edit = %d %v", len(revs), err)
	}
	// Newest first; the manager's edit is attributed to the manager.
	if revs[0].Revision != 2 || revs[0].Body != "bản hai" || revs[0].CreatedBy != tn.aclOwner.ID {
		t.Fatalf("second revision row = %+v", revs[0])
	}
	if revs[1].Revision != 1 || revs[1].Body != "bản một" {
		t.Fatalf("first revision row = %+v", revs[1])
	}
	if _, err := f.svc.DocumentCommentRevisions(f.ctx, member, d.ID, "01J8X4CMTN1P2Q3R4S5T6U7W"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown comment history: %v", err)
	}
}

// A tombstone has no history to read: the revisions are gone for real (Q8)
// and the route answers 409 comment_deleted.
func TestDocumentCommentRevisionsTombstoneRefused(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "revtomb")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	c, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "gốc"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "con", ParentID: &c.ID}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, c.ID, UpdateCommentInput{Body: "sửa"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.DeleteDocumentComment(f.ctx, member, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.DocumentCommentRevisions(f.ctx, member, d.ID, c.ID); err == nil {
		t.Fatal("a tombstone answered its deleted history")
	} else {
		collabWantCode(t, err, "comment_deleted")
	}
}

// Revisions and comments are tenant- and document-scoped: a comment of
// another tenant, or of another document of the same tenant, answers
// not-found rather than leaking rows.
func TestDocumentCommentRevisionsStayScoped(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "revscope")
	d1 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	d2 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)
	c, err := f.svc.AddDocumentComment(f.ctx, member, d2.ID, AddCommentInput{Body: "trên hai"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, c.ID, UpdateCommentInput{Body: "sửa"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.DocumentCommentRevisions(f.ctx, member, d1.ID, c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("history through the wrong document: %v", err)
	}

	foreign := f.tenant(t, "revfor")
	fd := f.doc(t, foreign, docSpec{ws: foreign.wsA, visibility: "workspace", aclOwner: foreign.aclOwner.ID, createdBy: foreign.aclOwner.ID})
	fc, err := f.svc.AddDocumentComment(f.ctx, Human(foreign.member.ID), fd.ID, AddCommentInput{Body: "ngoài"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.DocumentCommentRevisions(f.ctx, member, d1.ID, fc.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-tenant history: %v", err)
	}
}

// A departed member keeps their authored rows and their display name: the
// thread still shows who wrote the comment.
func TestDocumentCommentDepartedAuthorStillShown(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "depart")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member, acl := Human(tn.member.ID), Human(tn.aclOwner.ID)

	if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "trước khi đi"}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`,
		tn.orgID, tn.member.ID); err != nil {
		t.Fatal(err)
	}
	list, err := f.svc.DocumentComments(f.ctx, acl, d.ID, DocumentCommentListInput{})
	if err != nil || len(list.Rows) != 1 {
		t.Fatalf("list after departure = %d %v", len(list.Rows), err)
	}
	if list.Rows[0].DisplayName != "member" || list.Rows[0].AuthorID != tn.member.ID {
		t.Fatalf("departed author = %+v", list.Rows[0])
	}
}

// Two sends from two people land as two rows: every send is its own ULID.
func TestDocumentCommentTwoConcurrentSends(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "conc")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = f.svc.AddDocumentComment(context.Background(), Human(tn.member.ID), d.ID,
				AddCommentInput{Body: fmt.Sprintf("đồng thời %d", i)}, "")
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("concurrent send %d: %v", i, err)
		}
	}
	list, err := f.svc.DocumentComments(f.ctx, Human(tn.member.ID), d.ID, DocumentCommentListInput{})
	if err != nil || len(list.Rows) != 2 || list.Rows[0].ID == list.Rows[1].ID {
		t.Fatalf("concurrent list = %d %v", len(list.Rows), err)
	}
}

// CHECK constraints hold the shape of the new columns: a value outside a
// CHECK is refused by the database, not only by the service.
func TestDocumentCommentCollabCheckConstraints(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "chk")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	rawInsert := func(commentType, extra string, args ...any) error {
		sqlText := `INSERT INTO document_comments
			(id, organization_id, workspace_id, document_id, author_id, author_kind, body, comment_type` + extra + `)
			VALUES ($1, $2, $3, $4, $5, 'human', 'x', $6`
		for i := range args {
			sqlText += fmt.Sprintf(", $%d", 7+i)
		}
		sqlText += ")"
		_, err := f.pool.Exec(f.ctx, sqlText, append([]any{util.NewID(), tn.orgID, tn.wsA, d.ID, tn.member.ID, commentType}, args...)...)
		return err
	}
	if err := rawInsert("discussion", ""); err != nil {
		t.Fatalf("plain discussion row refused: %v", err)
	}
	anchor := []byte(`{"format":"pdf","v":1}`)
	// A complete anchored root comment: anchor, version and state together.
	if err := rawInsert("comment", ", anchor, anchor_version_id, anchor_state", anchor, "01J8X4VER0N1P2Q3R4S5T6U7V8", "exact"); err != nil {
		t.Fatalf("anchored root comment refused: %v", err)
	}
	for _, tc := range []struct {
		name        string
		commentType string
		extra       string
		args        []any
	}{
		{"comment_type", "system", "", nil},
		{"anchor_state", "comment", ", anchor, anchor_version_id, anchor_state", []any{anchor, "01J8X4VER0N1P2Q3R4S5T6U7V8", "weird"}},
		{"deleted_by_kind", "discussion", ", deleted_at, deleted_by_id, deleted_by_kind", []any{time.Now(), "u1", "robot"}},
		// The three anchor columns move together or not at all.
		{"anchor without version", "comment", ", anchor", []any{anchor}},
		// An anchor lives on a root comment only.
		{"anchor on a discussion", "discussion", ", anchor, anchor_version_id, anchor_state", []any{anchor, "01J8X4VER0N1P2Q3R4S5T6U7V8", "exact"}},
		// The three delete columns move together or not at all.
		{"deleted_at without actor", "discussion", ", deleted_at", []any{time.Now()}},
	} {
		if err := rawInsert(tc.commentType, tc.extra, tc.args...); err == nil {
			t.Fatalf("%s outside its CHECK accepted", tc.name)
		}
	}
}

// A copy of a document is a new standalone document: comments, mentions and
// histories stay with the source (contract-collab section 5.4).
func TestDocumentCopyCarriesNoComments(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	src := env.createFile(t, member, "collab.md", []byte("# Nguồn\n"))
	c, err := env.svc.AddDocumentComment(ctx, member, src.Document.ID, AddCommentInput{Body: "trên nguồn"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.svc.UpdateDocumentComment(ctx, member, c.ID, UpdateCommentInput{Body: "sửa"}); err != nil {
		t.Fatal(err)
	}
	if _, err := env.svc.AddDocumentCommentReaction(ctx, member, c.ID, "👍"); err != nil {
		t.Fatal(err)
	}
	if _, err := env.svc.AddDocumentComment(ctx, member, src.Document.ID, AddCommentInput{Body: "con", ParentID: &c.ID}, ""); err != nil {
		t.Fatal(err)
	}

	copied, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{Consent: "copy", IdempotencyKey: util.NewID()})
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"document_comments", "document_comment_revisions", "document_comment_mentions"} {
		var n int
		if err := env.f.pool.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE document_id = $1`, copied.Document.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatalf("the copy carries %d rows of %s", n, table)
		}
	}
	// The source keeps its thread.
	list, err := env.svc.DocumentComments(ctx, member, src.Document.ID, DocumentCommentListInput{})
	if err != nil || len(list.Rows) != 2 {
		t.Fatalf("source thread after copy = %d %v", len(list.Rows), err)
	}
}

// Document purge drops the four comment tables in one transaction: reactions
// (reached through document_comments), mentions, revisions, then comments.
func TestDocumentPurgeDropsTheCommentOrbit(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "prgc")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	c, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "gốc"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "con", ParentID: &c.ID}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, c.ID, UpdateCommentInput{Body: "sửa"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddDocumentCommentReaction(f.ctx, member, c.ID, "👍"); err != nil {
		t.Fatal(err)
	}
	collabMention(t, f, tn, d.ID, c.ID)

	// Expire the document and sweep it (the same shape the worker sees).
	f.svc.SetFiles(&releaseSpy{})
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE documents SET archived_at = now() - interval '40 days', purge_after = now() - interval '10 days' WHERE id = $1`,
		d.ID); err != nil {
		t.Fatal(err)
	}
	rep, err := f.svc.PurgeExpired(f.ctx, time.Now())
	if err != nil || rep.Purged != 1 {
		t.Fatalf("purge = %+v %v", rep, err)
	}
	for _, table := range []string{"document_comments", "document_comment_revisions", "document_comment_mentions"} {
		var n int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM `+table+` WHERE document_id = $1`, d.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatalf("%s kept %d rows after the purge", table, n)
		}
	}
	var reactions int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM comment_reactions`).Scan(&reactions); err != nil {
		t.Fatal(err)
	}
	if reactions != 0 {
		t.Fatalf("comment_reactions kept %d rows after the purge", reactions)
	}
}

// The pre-G8 insert (no comment_type) now lands as a discussion: the column
// default the migration set, which is what an old client's create resolves to.
func TestDocumentCommentInsertDefaultsToDiscussion(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "dflt")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	id := util.NewID()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO document_comments
		(id, organization_id, workspace_id, document_id, author_id, author_kind, body)
		VALUES ($1, $2, $3, $4, $5, 'human', 'dòng cũ')`,
		id, tn.orgID, tn.wsA, d.ID, tn.member.ID); err != nil {
		t.Fatal(err)
	}
	var commentType string
	var clean bool
	if err := f.pool.QueryRow(f.ctx, `SELECT comment_type, anchor_state IS NULL AND deleted_at IS NULL FROM document_comments WHERE id = $1`, id).
		Scan(&commentType, &clean); err != nil {
		t.Fatal(err)
	}
	if commentType != "discussion" {
		t.Fatalf("default comment_type = %q, want discussion", commentType)
	}
	if !clean {
		t.Fatal("a fresh row carries anchor or delete state")
	}
}
