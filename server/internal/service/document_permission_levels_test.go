package service

import (
	"reflect"
	"slices"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DOC5-A02 (UNI-1413, UNI-1628): introducing the 'comment' share level is
// rights-neutral for every non-AdminScope viewer on existing view/edit/manage
// shares and discussion threads, while slotting 'comment' strictly between
// 'view' and 'edit' across level comparison, ShareDocument validation,
// FilterDocumentReaders, and shareLevelsFor.
func TestMigrationCommentLevelIsRightsNeutral(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "doc5a02")

	uView := f.user(t, "doc5a02", "uview")
	uEdit := f.user(t, "doc5a02", "uedit")
	uManage := f.user(t, "doc5a02", "umanage")
	uComment := f.user(t, "doc5a02", "ucomment")
	for _, u := range []db.User{uView, uEdit, uManage, uComment} {
		f.orgMember(t, tn.orgID, u.ID, OrgRoleMember)
	}

	wsDoc := f.doc(t, tn, docSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
	})
	resDoc := f.doc(t, tn, docSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
	})

	f.share(t, resDoc, DocumentPrincipalUser, uView.ID, DocumentLevelView, tn.aclOwner.ID)
	f.share(t, resDoc, DocumentPrincipalUser, uEdit.ID, DocumentLevelEdit, tn.aclOwner.ID)
	f.share(t, resDoc, DocumentPrincipalUser, uManage.ID, DocumentLevelManage, tn.aclOwner.ID)

	if _, err := f.svc.AddDocumentComment(f.ctx, Human(tn.aclOwner.ID), resDoc.ID, AddCommentInput{
		Body: "Existing thread before comment-level share",
	}, ""); err != nil {
		t.Fatalf("seed comment: %v", err)
	}

	// 1. Existing non-AdminScope seed principals retain exact effectiveLevel
	// and FilterDocumentReaders behavior.
	seedCases := []permCase{
		{name: "acl owner on restricted", actor: Human(tn.aclOwner.ID), doc: resDoc, level: DocumentLevelManage, via: DocumentViaMember},
		{name: "ws member on workspace doc", actor: Human(tn.member.ID), doc: wsDoc, level: DocumentLevelEdit, via: DocumentViaMember},
		{name: "ws member on restricted doc without share", actor: Human(tn.member.ID), doc: resDoc, level: DocumentLevelNone},
		{name: "view share on restricted doc", actor: Human(uView.ID), doc: resDoc, level: DocumentLevelView, via: DocumentViaShare},
		{name: "edit share on restricted doc", actor: Human(uEdit.ID), doc: resDoc, level: DocumentLevelEdit, via: DocumentViaShare},
		{name: "manage share on restricted doc", actor: Human(uManage.ID), doc: resDoc, level: DocumentLevelManage, via: DocumentViaShare},
		{name: "unshared outsider on restricted doc", actor: Human(tn.outsider.ID), doc: resDoc, level: DocumentLevelNone},
	}
	runPermCases(t, f, seedCases)

	candidates := []string{tn.aclOwner.ID, tn.member.ID, uView.ID, uEdit.ID, uManage.ID, tn.outsider.ID}
	readers, err := f.svc.FilterDocumentReaders(f.ctx, resDoc.ID, candidates)
	if err != nil {
		t.Fatalf("FilterDocumentReaders on seed set: %v", err)
	}
	wantReaders := []string{tn.aclOwner.ID, uView.ID, uEdit.ID, uManage.ID}
	if !reflect.DeepEqual(readers, wantReaders) {
		t.Fatalf("FilterDocumentReaders = %v, want %v", readers, wantReaders)
	}

	// 2. The comment level ranks strictly between view and edit (view 1 < comment 2 < edit 3 < manage 4).
	if DocumentViaBreakGlass != DocumentVia("break_glass") {
		t.Fatalf("DocumentViaBreakGlass = %q, want break_glass", DocumentViaBreakGlass)
	}
	lvlComment := DocumentLevelComment
	if !lvlComment.AtLeast(DocumentLevelView) || !lvlComment.AtLeast(lvlComment) {
		t.Fatalf("comment level must satisfy AtLeast(view) and AtLeast(comment)")
	}
	if lvlComment.AtLeast(DocumentLevelEdit) || DocumentLevelView.AtLeast(lvlComment) {
		t.Fatalf("comment level must rank strictly between view and edit")
	}
	if !DocumentLevelEdit.AtLeast(lvlComment) || !DocumentLevelManage.AtLeast(lvlComment) {
		t.Fatalf("edit and manage must satisfy AtLeast(comment)")
	}

	// 3. ShareDocument accepts level='comment' and grants read + comment-rank share access.
	sh, err := f.svc.ShareDocument(f.ctx, Human(tn.aclOwner.ID), resDoc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser,
		PrincipalID:   uComment.ID,
		Level:         lvlComment,
	})
	if err != nil {
		t.Fatalf("ShareDocument with level=comment: %v", err)
	}
	if DocumentLevel(sh.Level) != lvlComment {
		t.Fatalf("ShareDocument level = %q, want %q", sh.Level, lvlComment)
	}
	gotAccess, err := f.svc.effectiveLevel(f.ctx, f.q, Human(uComment.ID), resDoc)
	if err != nil {
		t.Fatalf("effectiveLevel for comment share: %v", err)
	}
	if gotAccess.Level != lvlComment || gotAccess.Via != DocumentViaShare {
		t.Fatalf("effectiveLevel for comment share = %+v, want level=%q via=%q", gotAccess, lvlComment, DocumentViaShare)
	}

	readersAfter, err := f.svc.FilterDocumentReaders(f.ctx, resDoc.ID, append(candidates, uComment.ID))
	if err != nil {
		t.Fatalf("FilterDocumentReaders with comment recipient: %v", err)
	}
	if !slices.Contains(readersAfter, uComment.ID) {
		t.Fatalf("FilterDocumentReaders %v missing comment recipient %s", readersAfter, uComment.ID)
	}

	// 4. shareLevelsFor includes comment for view and comment thresholds.
	if got := shareLevelsFor(DocumentLevelView); !reflect.DeepEqual(got, []string{"view", "comment", "edit", "manage"}) {
		t.Fatalf("shareLevelsFor(view) = %v, want [view comment edit manage]", got)
	}
	if got := shareLevelsFor(lvlComment); !reflect.DeepEqual(got, []string{"comment", "edit", "manage"}) {
		t.Fatalf("shareLevelsFor(comment) = %v, want [comment edit manage]", got)
	}
}
