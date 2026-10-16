package service

// G8-18 (UNI-1413): what a comment answers about the people it mentioned who
// cannot read the document. A mention never notifies a non-reader and never
// grants access, and a later grant does not notify retroactively.

import (
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
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

// mentions_without_access: an ordinary restricted document and a Work Product
// document each answer the no_access people from what the create stored, never
// an error; a person who reads the document is not listed; an admin with no
// grant on a restricted document is listed too; an id outside the organization
// carries no display name. The can_share matrix has its own test.
func TestMentionsWithoutAccessField(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mnwa")
	acl := Human(tn.aclOwner.ID)
	ordinary := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.share(t, ordinary, DocumentPrincipalUser, tn.creator.ID, DocumentLevelView, tn.aclOwner.ID)
	stranger := f.user(t, "mnwa", "stranger") // in no organization

	body := commentMentionToken(tn.member) + " " + commentMentionToken(tn.creator) + " " +
		commentMentionToken(tn.deact) + " " + commentMentionToken(stranger) + " " + commentMentionToken(tn.wsAdmin)
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
	for name, u := range map[string]string{"member": tn.member.ID, "admin-only target": tn.wsAdmin.ID, "deactivated": tn.deact.ID, "stranger": stranger.ID} {
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

// noAccessRow stores a no_access mention row for the person on the comment
// directly, so a test can ask the answer about any caller / target pair
// without needing the caller to be able to write the comment.
func (f *docPermFixture) noAccessRow(t *testing.T, tn docTenant, d db.Document, commentID, userID string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO document_comment_mentions
		   (id, organization_id, workspace_id, document_id, comment_id, user_id, state, created_by, created_by_kind)
		 VALUES ($1, $2, $3, $4, $5, $6, 'no_access', $7, 'human')`,
		util.NewID(), tn.orgID, d.WorkspaceID, d.ID, commentID, userID, tn.aclOwner.ID); err != nil {
		t.Fatal(err)
	}
}

func canShareOf(t *testing.T, f *docPermFixture, caller Actor, d db.Document, commentID string) map[string]bool {
	t.Helper()
	rows, err := f.svc.CommentMentionsWithoutAccess(f.ctx, caller, d.ID, commentID)
	if err != nil {
		t.Fatalf("CommentMentionsWithoutAccess: %v", err)
	}
	out := make(map[string]bool, len(rows))
	for _, r := range rows {
		out[r.UserID] = r.CanShare
	}
	return out
}

// can_share is true exactly when the caller can administer the document, it is
// not a Work Product document, the mentioned person is an active organization
// member, and (the caller holds manage OR the person is not the caller).
func TestMentionsWithoutAccessCanShareMatrix(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mncs")
	stranger := f.user(t, "mncs", "stranger") // in no organization
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	acl := Human(tn.aclOwner.ID)
	f.share(t, d, DocumentPrincipalUser, tn.creator.ID, DocumentLevelComment, tn.aclOwner.ID) // commenter, no manage
	f.share(t, d, DocumentPrincipalUser, tn.wsAdmin.ID, DocumentLevelComment, tn.aclOwner.ID) // admin with a comment share

	c, err := f.svc.AddDocumentComment(f.ctx, acl, d.ID, AddCommentInput{Body: "gốc", CommentType: "discussion"}, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []string{tn.member.ID, tn.deact.ID, stranger.ID, tn.aclOwner.ID, tn.wsAdmin.ID} {
		f.noAccessRow(t, tn, d, c.ID, u)
	}

	// manage (ACL owner): shares with active organization members only, and
	// with themselves too (manage holds the right).
	got := canShareOf(t, f, acl, d, c.ID)
	for name, c := range map[string]struct {
		id   string
		want bool
	}{
		"active member": {tn.member.ID, true}, "deactivated member": {tn.deact.ID, false},
		"id outside the organization": {stranger.ID, false}, "manager mentioning themselves": {tn.aclOwner.ID, true},
	} {
		if got[c.id] != c.want {
			t.Errorf("manager: %s can_share = %v, want %v", name, got[c.id], c.want)
		}
	}

	// a commenter below manage and without AdminScope may not share at all.
	for id, v := range canShareOf(t, f, Human(tn.creator.ID), d, c.ID) {
		if v {
			t.Errorf("commenter: can_share true for %s", id)
		}
	}

	// an admin with only AdminScope + a comment share may share with others
	// but never with themselves.
	adm := canShareOf(t, f, Human(tn.wsAdmin.ID), d, c.ID)
	if !adm[tn.member.ID] {
		t.Error("admin scope: cannot share with an active member")
	}
	if adm[tn.wsAdmin.ID] {
		t.Error("admin scope: can_share true for themselves (must go through break-glass)")
	}
	if adm[tn.deact.ID] || adm[stranger.ID] {
		t.Error("admin scope: can_share true for a deactivated member or an outside id")
	}

	// a Work Product document refuses shares: can_share is false even for its manager.
	wp := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "01J8X4WPR0N1P2Q3R4S5T6U7V8"})
	f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.aclOwner.ID: DocumentLevelManage})
	wc, err := f.svc.AddDocumentComment(f.ctx, acl, wp.ID, AddCommentInput{Body: "gốc", CommentType: "discussion"}, "")
	if err != nil {
		t.Fatal(err)
	}
	f.noAccessRow(t, tn, wp, wc.ID, tn.member.ID)
	if canShareOf(t, f, acl, wp, wc.ID)[tn.member.ID] {
		t.Error("work product: can_share true")
	}
}

// DOC-05: an admin with no grant cannot read a restricted document, so
// mentioning them stores no_access and lists them in mentions_without_access
// (never a 500); a break-glass grant given later does not make the old row
// active.
func TestMentionOfAdminOnlyTargetOnRestrictedDocument(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mnad")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	acl := Human(tn.aclOwner.ID)

	body := commentMentionToken(tn.wsAdmin) + " " + commentMentionToken(tn.orgAdmin) + " " + commentMentionToken(tn.owner)
	c, err := f.svc.AddDocumentComment(f.ctx, acl, d.ID, AddCommentInput{Body: body, CommentType: "discussion"}, "")
	if err != nil {
		t.Fatalf("mentioning admin-only people must not fail the comment: %v", err)
	}
	got, err := f.svc.CommentMentionsWithoutAccess(f.ctx, acl, d.ID, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("mentions_without_access = %v, want the three admins", got)
	}
	for _, m := range got {
		if !m.CanShare {
			t.Errorf("admin %s: the manager can share view access to an active member", m.UserID)
		}
		if state, notified := mentionRowState(t, f, c.ID, m.UserID); state != "no_access" || notified.Valid {
			t.Errorf("admin %s row = %s/%v, want no_access, never notified", m.UserID, state, notified)
		}
	}

	f.mentionBreakGlass(t, tn, d.ID, d.WorkspaceID, tn.wsAdmin.ID, time.Hour)
	if state, _ := mentionRowState(t, f, c.ID, tn.wsAdmin.ID); state != "no_access" {
		t.Fatalf("a later break-glass grant turned the row %s", state)
	}
	rows, err := f.q.ListClaimableDocumentCommentMentions(f.ctx, dbClaimableParams(d, c.ID))
	if err != nil || len(rows) != 0 {
		t.Fatalf("claimable after the grant = %d, %v; want none", len(rows), err)
	}
}
