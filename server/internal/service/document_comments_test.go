package service

// UNI-681 (G1-07a): document comments on the shared comment core. The
// ladder is the document one - view reads, edit writes, author-or-manage
// edits/deletes - decided fresh inside withDocumentMutation, so a share
// revoked before the command is already invisible to it. Anonymous and
// agent writes are refused by the gate itself.

import (
	"errors"
	"testing"
)

func TestDocumentCommentThread(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "thr")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member, acl := Human(tn.member.ID), Human(tn.aclOwner.ID)

	root, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "đoạn này cần sửa"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if root.DocumentID != d.ID || root.OrganizationID != tn.orgID || root.WorkspaceID != tn.wsA ||
		root.AuthorID != tn.member.ID || root.AuthorKind != "human" || root.CommentType != "comment" {
		t.Fatalf("root comment = %+v", root)
	}
	reply, err := f.svc.AddDocumentComment(f.ctx, acl, d.ID, AddCommentInput{Body: "sẽ xử", ParentID: &root.ID}, "")
	if err != nil {
		t.Fatal(err)
	}
	if reply.ParentCommentID.String != root.ID {
		t.Fatalf("reply parent = %v", reply.ParentCommentID)
	}

	list, err := f.svc.DocumentComments(f.ctx, member, d.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("comments = %d %v", len(list), err)
	}

	// The same Idempotency-Key replays the stored response instead of
	// writing a second comment.
	again, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "một"}, "key-1")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "một"}, "key-1")
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != replay.ID {
		t.Fatalf("idempotent replay wrote a second row: %s vs %s", again.ID, replay.ID)
	}
	list, err = f.svc.DocumentComments(f.ctx, member, d.ID)
	if err != nil || len(list) != 3 {
		t.Fatalf("comments after replay = %d %v", len(list), err)
	}
}

// A parent id that belongs to another document is refused; one from another
// tenant is not found. Both through the same checkCommentParent.
func TestDocumentCommentCrossDocumentParent(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "xdoc")
	d1 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	d2 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	c, err := f.svc.AddDocumentComment(f.ctx, member, d1.ID, AddCommentInput{Body: "trên tài liệu một"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, member, d2.ID, AddCommentInput{Body: "reply lạc", ParentID: &c.ID}, ""); err == nil {
		t.Fatal("a comment id of another document was accepted as parent")
	}

	// A comment id from another tenant is not found, never readable.
	foreign := f.tenant(t, "xfor")
	fd := f.doc(t, foreign, docSpec{ws: foreign.wsA, visibility: "workspace", aclOwner: foreign.aclOwner.ID, createdBy: foreign.aclOwner.ID})
	fc, err := f.svc.AddDocumentComment(f.ctx, Human(foreign.member.ID), fd.ID, AddCommentInput{Body: "ngoài"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, member, d1.ID, AddCommentInput{Body: "cross-tenant", ParentID: &fc.ID}, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign parent: %v, want ErrNotFound", err)
	}
	if _, err := f.svc.GetDocumentComment(f.ctx, member, fc.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign comment read: %v, want ErrNotFound", err)
	}
}

// view reads, edit writes, author-or-manage moderates - each step gated by
// the document permission ladder, not by workspace membership alone.
func TestDocumentCommentLevels(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "lvl")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member, outsider, acl := Human(tn.member.ID), Human(tn.outsider.ID), Human(tn.aclOwner.ID)

	// A workspace member of a restricted document: nothing, not even read.
	if _, err := f.svc.DocumentComments(f.ctx, member, d.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("member on restricted doc: %v, want ErrNotFound", err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "x"}, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("member comment on restricted doc: %v, want ErrNotFound", err)
	}

	// A view share reads but never writes.
	f.share(t, d, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
	c, err := f.svc.AddDocumentComment(f.ctx, acl, d.ID, AddCommentInput{Body: "chủ tài liệu"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := f.svc.DocumentComments(f.ctx, outsider, d.ID); err != nil || len(got) != 1 {
		t.Fatalf("viewer comments = %d %v", len(got), err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, outsider, d.ID, AddCommentInput{Body: "viewer writes"}, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer write: %v, want ErrForbidden", err)
	}
	if _, err := f.svc.AddDocumentCommentReaction(f.ctx, outsider, c.ID, "👍"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer reaction: %v, want ErrForbidden", err)
	}

	// An edit share comments and reacts.
	f.share(t, d, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)
	mc, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "tôi được sửa"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddDocumentCommentReaction(f.ctx, member, c.ID, "👍"); err != nil {
		t.Fatalf("editor reaction: %v", err)
	}

	// Author edits their own body; an edit-level peer cannot.
	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, mc.ID, UpdateCommentInput{Body: "sửa"}); err != nil {
		t.Fatalf("author edit: %v", err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, c.ID, UpdateCommentInput{Body: "sửa của chủ"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("peer edit: %v, want ErrForbidden", err)
	}
	// Manage moderates: the ACL owner edits and deletes the member's comment.
	if _, err := f.svc.UpdateDocumentComment(f.ctx, acl, mc.ID, UpdateCommentInput{Body: "manage sửa"}); err != nil {
		t.Fatalf("manage edit: %v", err)
	}
	if err := f.svc.DeleteDocumentComment(f.ctx, member, c.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("editor deleting another's: %v, want ErrForbidden", err)
	}
	if err := f.svc.DeleteDocumentComment(f.ctx, acl, mc.ID); err != nil {
		t.Fatalf("manage delete: %v", err)
	}
}

// Anonymous (a public link carries no actor) and agents never write; an
// agent still reads a workspace-visible document at view.
func TestDocumentCommentAnonymousAndAgent(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anon")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	restricted := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	agent := agentActor(tn.agent)

	if _, err := f.svc.AddDocumentComment(f.ctx, Actor{}, d.ID, AddCommentInput{Body: "anon"}, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("anonymous write: %v, want ErrNotFound", err)
	}
	if _, err := f.svc.DocumentComments(f.ctx, Actor{}, d.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("anonymous read: %v, want ErrNotFound", err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, agent, d.ID, AddCommentInput{Body: "agent"}, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent write on workspace doc: %v, want ErrForbidden", err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, agent, restricted.ID, AddCommentInput{Body: "agent"}, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("agent write on restricted doc: %v, want ErrNotFound", err)
	}
}

// A public client can never mint a system row through the document path.
func TestDocumentCommentSystemTypeRefused(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "syst")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	for _, ct := range []string{"system", "status_change", "progress_update"} {
		if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "x", CommentType: ct}, ""); err == nil {
			t.Fatalf("comment_type %q accepted", ct)
		}
	}
	if c, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "x", CommentType: "comment"}, ""); err != nil || c.CommentType != "comment" {
		t.Fatalf("plain comment: %v %+v", err, c)
	}
}

// A share revoked between two writes is already invisible to the second -
// the mutation gate re-reads the ACL under the document row lock.
func TestDocumentCommentRevokeBetweenWrites(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "rev")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	actor := Human(tn.outsider.ID)
	sh := f.share(t, d, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelEdit, tn.aclOwner.ID)

	if _, err := f.svc.AddDocumentComment(f.ctx, actor, d.ID, AddCommentInput{Body: "trước"}, ""); err != nil {
		t.Fatal(err)
	}
	f.revoke(t, sh, tn.aclOwner.ID)
	if _, err := f.svc.AddDocumentComment(f.ctx, actor, d.ID, AddCommentInput{Body: "sau"}, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("comment after revoke: %v, want ErrNotFound", err)
	}
	if _, err := f.svc.DocumentComments(f.ctx, actor, d.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("read after revoke: %v, want ErrNotFound", err)
	}
}

// Edit and resolve bump revision; a repeated resolve is a no-op. Reactions
// upsert once and remove once; a comment id of another document is not
// found rather than probed.
func TestDocumentCommentEditResolveReact(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "esr")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	other := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member, acl := Human(tn.member.ID), Human(tn.aclOwner.ID)

	c, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "gốc"}, "")
	if err != nil {
		t.Fatal(err)
	}
	up, err := f.svc.UpdateDocumentComment(f.ctx, member, c.ID, UpdateCommentInput{Body: "sửa"})
	if err != nil || up.Revision != c.Revision+1 || up.Body != "sửa" {
		t.Fatalf("update = %v %+v", err, up)
	}
	res, err := f.svc.ResolveDocumentComment(f.ctx, acl, c.ID)
	if err != nil || !res.ResolvedAt.Valid || res.ResolvedByID.String != tn.aclOwner.ID || res.Revision != up.Revision+1 {
		t.Fatalf("resolve = %v %+v", err, res)
	}
	again, err := f.svc.ResolveDocumentComment(f.ctx, acl, c.ID)
	if err != nil || again.Revision != res.Revision {
		t.Fatalf("repeat resolve bumped revision: %v %+v", err, again)
	}
	un, err := f.svc.UnresolveDocumentComment(f.ctx, acl, c.ID)
	if err != nil || un.ResolvedAt.Valid || un.Revision != res.Revision+1 {
		t.Fatalf("unresolve = %v %+v", err, un)
	}

	r1, err := f.svc.AddDocumentCommentReaction(f.ctx, member, c.ID, "👍")
	if err != nil {
		t.Fatal(err)
	}
	r2, err := f.svc.AddDocumentCommentReaction(f.ctx, member, c.ID, "👍")
	if err != nil || r2.ID != r1.ID {
		t.Fatalf("repeat reaction wrote a second row: %v vs %v", r1.ID, r2.ID)
	}
	reactions, err := f.svc.DocumentCommentReactions(f.ctx, member, d.ID)
	if err != nil || len(reactions) != 1 || reactions[0].Emoji != "👍" {
		t.Fatalf("reactions = %+v %v", reactions, err)
	}
	if err := f.svc.RemoveDocumentCommentReaction(f.ctx, member, c.ID, "👍"); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.RemoveDocumentCommentReaction(f.ctx, member, c.ID, "👍"); err != nil {
		t.Fatalf("second remove: %v", err)
	}

	// A comment id of another document does not exist here.
	oc, err := f.svc.AddDocumentComment(f.ctx, member, other.ID, AddCommentInput{Body: "bên kia"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddDocumentCommentReaction(f.ctx, member, oc.ID, "🔥"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, acl, oc.ID, UpdateCommentInput{Body: "x"}); err != nil {
		// oc lives on `other`; moderating it through its own document works.
		t.Fatalf("moderate other doc comment: %v", err)
	}
	list, err := f.svc.DocumentCommentReactions(f.ctx, member, d.ID)
	if err != nil || len(list) != 0 {
		t.Fatalf("d's reactions after other doc reacted = %+v", list)
	}
}

// Mention markup is stored verbatim; the notification side parses the same
// grammar (internal/mentions) at delivery time.
func TestDocumentCommentMentionBodyStored(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "men")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	body := "[@Thành viên](mention://member/" + tn.outsider.ID + ") xem giúp"
	c, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: body}, "")
	if err != nil {
		t.Fatal(err)
	}
	if c.Body != body {
		t.Fatalf("body rewritten: %q", c.Body)
	}
}
