package service

// G8-18 (UNI-1413): what a comment answers about the people it mentioned who
// cannot read the document. A mention never notifies a non-reader and never
// grants access, and a later grant does not notify retroactively.

import (
	"errors"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func dbClaimableParams(doc db.Document, commentID string) db.ListClaimableDocumentCommentMentionsParams {
	return db.ListClaimableDocumentCommentMentionsParams{
		CommentID: commentID, DocumentID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	}
}

// A mention of someone who cannot read the document is stored no_access, never
// claimable for a notification, never a share - and a later grant does not
// turn it active, so nobody is notified retroactively.
func TestMentionNoAccessNeverNotifiesOrGrants(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mnng")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	acl := Human(tn.aclOwner.ID)

	c, err := f.svc.AddDocumentComment(f.ctx, acl, doc.ID,
		AddCommentInput{Body: "xem " + commentMentionToken(tn.member), CommentType: "discussion"}, "")
	if err != nil {
		t.Fatal(err)
	}
	claimable := func() int {
		rows, err := f.q.ListClaimableDocumentCommentMentions(f.ctx, dbClaimableParams(doc, c.ID))
		if err != nil {
			t.Fatal(err)
		}
		return len(rows)
	}
	shares := func() int {
		var n int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM document_shares WHERE document_id = $1 AND principal_id = $2`, doc.ID, tn.member.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if state, notified := mentionRowState(t, f, c.ID, tn.member.ID); state != "no_access" || notified.Valid {
		t.Fatalf("row = %s/%v, want no_access, never notified", state, notified)
	}
	if n := claimable(); n != 0 {
		t.Fatalf("%d claimable rows for a non-reader, want 0", n)
	}
	if n := shares(); n != 0 {
		t.Fatalf("the mention created %d share rows", n)
	}

	// The grant arrives later, by an explicit share: the old row stays
	// no_access and is still not claimable.
	f.share(t, doc, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
	if state, notified := mentionRowState(t, f, c.ID, tn.member.ID); state != "no_access" || notified.Valid {
		t.Fatalf("after the grant the row = %s/%v, want it still no_access", state, notified)
	}
	if n := claimable(); n != 0 {
		t.Fatalf("a later grant made %d rows claimable (retroactive notification)", n)
	}
	// An edit that keeps the token does not reactivate it either.
	if _, err := f.svc.UpdateDocumentComment(f.ctx, acl, c.ID, UpdateCommentInput{Body: "xem lại " + commentMentionToken(tn.member)}); err != nil {
		t.Fatal(err)
	}
	if state, _ := mentionRowState(t, f, c.ID, tn.member.ID); state != "no_access" {
		t.Fatalf("an edit turned the row %s", state)
	}
}

// mentions_without_access: an ordinary restricted document, a Work Product
// document each answer the no_access people from what the create stored, never an error; a person who
// reads the document is not listed; an id outside the organization carries no
// display name. can_share stays false in phase A (see the report); the admin-only target
// case lands with phase B, once DOC-05's admin scope exists.
func TestMentionsWithoutAccessField(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mnwa")
	acl := Human(tn.aclOwner.ID)
	ordinary := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.share(t, ordinary, DocumentPrincipalUser, tn.creator.ID, DocumentLevelView, tn.aclOwner.ID)
	stranger := f.user(t, "mnwa", "stranger") // in no organization

	body := commentMentionToken(tn.member) + " " + commentMentionToken(tn.creator) + " " +
		commentMentionToken(tn.deact) + " " + commentMentionToken(stranger)
	c, err := f.svc.AddDocumentComment(f.ctx, acl, ordinary.ID, AddCommentInput{Body: body, CommentType: "discussion"}, "")
	if err != nil {
		t.Fatalf("a mention of non-readers must not fail the comment: %v", err)
	}
	got, err := f.svc.CommentMentionsWithoutAccess(f.ctx, acl, ordinary.ID, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]MentionWithoutAccess{}
	for _, m := range got {
		byID[m.UserID] = m
	}
	if _, ok := byID[tn.creator.ID]; ok {
		t.Error("a share reader is reported as without access")
	}
	for name, u := range map[string]string{"member": tn.member.ID, "deactivated": tn.deact.ID, "stranger": stranger.ID} {
		if _, ok := byID[u]; !ok {
			t.Errorf("%s is missing from mentions_without_access", name)
		}
	}
	if byID[tn.member.ID].DisplayName != tn.member.DisplayName {
		t.Errorf("member display_name = %q", byID[tn.member.ID].DisplayName)
	}
	if byID[stranger.ID].DisplayName != "" {
		t.Errorf("an id outside the organization carries the name %q", byID[stranger.ID].DisplayName)
	}

	// A comment naming only readers reports nobody.
	ok1, err := f.svc.AddDocumentComment(f.ctx, acl, ordinary.ID, AddCommentInput{Body: commentMentionToken(tn.creator), CommentType: "discussion"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if none, err := f.svc.CommentMentionsWithoutAccess(f.ctx, acl, ordinary.ID, ok1.ID); err != nil || len(none) != 0 {
		t.Fatalf("readers only = %v, %v; want empty", none, err)
	}

	// A Work Product document: the resolver decides, the answer is the same.
	wp := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "01J8X4WPR0N1P2Q3R4S5T6U7V8"})
	f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.aclOwner.ID: DocumentLevelEdit, tn.creator.ID: DocumentLevelView})
	wc, err := f.svc.AddDocumentComment(f.ctx, acl, wp.ID, AddCommentInput{Body: commentMentionToken(tn.member) + " " + commentMentionToken(tn.creator), CommentType: "discussion"}, "")
	if err != nil {
		t.Fatal(err)
	}
	wgot, err := f.svc.CommentMentionsWithoutAccess(f.ctx, acl, wp.ID, wc.ID)
	if err != nil || len(wgot) != 1 || wgot[0].UserID != tn.member.ID {
		t.Fatalf("work product mentions_without_access = %v, %v; want only the ungranted member", wgot, err)
	}

	// The reader of the answer must still be allowed to comment on it.
	if _, err := f.svc.CommentMentionsWithoutAccess(f.ctx, Human(tn.bMember.ID), ordinary.ID, c.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("an outsider reading the list = %v, want ErrNotFound", err)
	}
}
