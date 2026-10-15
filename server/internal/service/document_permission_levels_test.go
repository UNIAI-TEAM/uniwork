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

// DOC5-A01 (UNI-1413): four-level matrix (view < comment < edit < manage) across
// document reads, comment write/edit/delete/reaction, thread root-author vs
// reply-author resolve/reopen, body edits, ACL management, and list/tree/search
// visibility for 'comment' shares.
func TestDocumentLevelMatrix(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "doc5a01")

	uView := f.user(t, "doc5a01", "uview")
	uCommentRoot := f.user(t, "doc5a01", "ucommentroot")
	uCommentReply := f.user(t, "doc5a01", "ucommentreply")
	uEdit := f.user(t, "doc5a01", "uedit")
	uManage := f.user(t, "doc5a01", "umanage")
	uTarget := f.user(t, "doc5a01", "utarget")
	for _, u := range []db.User{uView, uCommentRoot, uCommentReply, uEdit, uManage, uTarget} {
		f.orgMember(t, tn.orgID, u.ID, OrgRoleMember)
		f.wsMember(t, tn.wsA, u.ID, "member")
	}

	resDoc := f.doc(t, tn, docSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
	})

	f.share(t, resDoc, DocumentPrincipalUser, uView.ID, DocumentLevelView, tn.aclOwner.ID)
	f.share(t, resDoc, DocumentPrincipalUser, uCommentRoot.ID, DocumentLevelComment, tn.aclOwner.ID)
	f.share(t, resDoc, DocumentPrincipalUser, uCommentReply.ID, DocumentLevelComment, tn.aclOwner.ID)
	f.share(t, resDoc, DocumentPrincipalUser, uEdit.ID, DocumentLevelEdit, tn.aclOwner.ID)
	f.share(t, resDoc, DocumentPrincipalUser, uManage.ID, DocumentLevelManage, tn.aclOwner.ID)

	// 1. Every level >= view reads document & comments.
	for _, u := range []db.User{uView, uCommentRoot, uEdit, uManage} {
		if _, err := f.svc.GetDocument(f.ctx, Human(u.ID), resDoc.ID); err != nil {
			t.Fatalf("GetDocument(%s): %v", u.DisplayName, err)
		}
		if _, err := f.svc.DocumentComments(f.ctx, Human(u.ID), resDoc.ID, DocumentCommentListInput{}); err != nil {
			t.Fatalf("DocumentComments(%s): %v", u.DisplayName, err)
		}
	}

	// 2. Writing comments and reactions requires comment+: view is refused, comment/edit/manage succeed.
	if _, err := f.svc.AddDocumentComment(f.ctx, Human(uView.ID), resDoc.ID, AddCommentInput{Body: "view cannot write"}, ""); err != ErrForbidden {
		t.Fatalf("view AddDocumentComment = %v, want ErrForbidden", err)
	}
	rootThread, err := f.svc.AddDocumentComment(f.ctx, Human(uCommentRoot.ID), resDoc.ID, AddCommentInput{Body: "root by comment user"}, "")
	if err != nil {
		t.Fatalf("comment user AddDocumentComment (root): %v", err)
	}
	replyComment, err := f.svc.AddDocumentComment(f.ctx, Human(uCommentReply.ID), resDoc.ID, AddCommentInput{
		Body:     "reply by second comment user",
		ParentID: &rootThread.ID,
	}, "")
	if err != nil {
		t.Fatalf("comment user AddDocumentComment (reply): %v", err)
	}
	editThread, err := f.svc.AddDocumentComment(f.ctx, Human(uEdit.ID), resDoc.ID, AddCommentInput{Body: "root by edit user"}, "")
	if err != nil {
		t.Fatalf("edit user AddDocumentComment: %v", err)
	}

	// Reactions: view refused, comment allowed.
	if _, err := f.svc.AddDocumentCommentReaction(f.ctx, Human(uView.ID), rootThread.ID, "👍"); err != ErrForbidden {
		t.Fatalf("view AddDocumentCommentReaction = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.AddDocumentCommentReaction(f.ctx, Human(uCommentReply.ID), rootThread.ID, "👍"); err != nil {
		t.Fatalf("comment AddDocumentCommentReaction: %v", err)
	}
	if err := f.svc.RemoveDocumentCommentReaction(f.ctx, Human(uCommentReply.ID), rootThread.ID, "👍"); err != nil {
		t.Fatalf("comment RemoveDocumentCommentReaction: %v", err)
	}

	// 3. Edit/delete own comment at comment+; edit/delete others' comment requires manage.
	if _, err := f.svc.UpdateDocumentComment(f.ctx, Human(uCommentRoot.ID), rootThread.ID, UpdateCommentInput{Body: "root updated by author"}); err != nil {
		t.Fatalf("comment author UpdateDocumentComment own: %v", err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, Human(uCommentReply.ID), rootThread.ID, UpdateCommentInput{Body: "hijack"}); err != ErrForbidden {
		t.Fatalf("comment peer UpdateDocumentComment other = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, Human(uEdit.ID), rootThread.ID, UpdateCommentInput{Body: "hijack by edit"}); err != ErrForbidden {
		t.Fatalf("edit peer UpdateDocumentComment other = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, Human(uManage.ID), rootThread.ID, UpdateCommentInput{Body: "moderated by manage"}); err != nil {
		t.Fatalf("manage UpdateDocumentComment other: %v", err)
	}

	// 4. Resolve / Unresolve thread:
	// - view cannot resolve
	// - comment-level reply author (uCommentReply) who is NOT root author cannot resolve rootThread or replyComment
	// - comment-level root author (uCommentRoot) CAN resolve and unresolve their own thread
	// - edit and manage CAN resolve and unresolve any thread
	if _, err := f.svc.ResolveDocumentComment(f.ctx, Human(uView.ID), rootThread.ID); err != ErrForbidden {
		t.Fatalf("view ResolveDocumentComment = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.ResolveDocumentComment(f.ctx, Human(uCommentReply.ID), rootThread.ID); err != ErrForbidden {
		t.Fatalf("comment reply-author ResolveDocumentComment(root) = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.ResolveDocumentComment(f.ctx, Human(uCommentReply.ID), replyComment.ID); err != ErrForbidden {
		t.Fatalf("comment reply-author ResolveDocumentComment(reply) = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.ResolveDocumentComment(f.ctx, Human(uCommentRoot.ID), editThread.ID); err != ErrForbidden {
		t.Fatalf("comment user ResolveDocumentComment(other's thread) = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.ResolveDocumentComment(f.ctx, Human(uCommentRoot.ID), rootThread.ID); err != nil {
		t.Fatalf("comment root-author ResolveDocumentComment(own thread): %v", err)
	}
	if _, err := f.svc.UnresolveDocumentComment(f.ctx, Human(uCommentRoot.ID), rootThread.ID); err != nil {
		t.Fatalf("comment root-author UnresolveDocumentComment(own thread): %v", err)
	}
	if _, err := f.svc.ResolveDocumentComment(f.ctx, Human(uEdit.ID), rootThread.ID); err != nil {
		t.Fatalf("edit ResolveDocumentComment(other's thread): %v", err)
	}
	if _, err := f.svc.UnresolveDocumentComment(f.ctx, Human(uManage.ID), rootThread.ID); err != nil {
		t.Fatalf("manage UnresolveDocumentComment(other's thread): %v", err)
	}

	// Comment author deletes own comment; cannot delete others'.
	ownTemp, err := f.svc.AddDocumentComment(f.ctx, Human(uCommentReply.ID), resDoc.ID, AddCommentInput{Body: "temp own comment"}, "")
	if err != nil {
		t.Fatalf("AddDocumentComment temp: %v", err)
	}
	if _, err := f.svc.DeleteDocumentComment(f.ctx, Human(uCommentReply.ID), rootThread.ID); err != ErrForbidden {
		t.Fatalf("comment DeleteDocumentComment other = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.DeleteDocumentComment(f.ctx, Human(uCommentReply.ID), ownTemp.ID); err != nil {
		t.Fatalf("comment DeleteDocumentComment own: %v", err)
	}

	// 5. Document body/title edit requires edit+; ACL share requires manage.
	newTitle := "Renamed by comment"
	if _, err := f.svc.UpdateDocument(f.ctx, Human(uCommentRoot.ID), resDoc.ID, UpdateDocumentInput{
		Revision: resDoc.Revision,
		Title:    &newTitle,
	}); err != ErrForbidden {
		t.Fatalf("comment UpdateDocument = %v, want ErrForbidden", err)
	}
	newTitleEdit := "Renamed by edit Matrix Spec Alpha"
	updatedView, err := f.svc.UpdateDocument(f.ctx, Human(uEdit.ID), resDoc.ID, UpdateDocumentInput{
		Revision: resDoc.Revision,
		Title:    &newTitleEdit,
	})
	if err != nil {
		t.Fatalf("edit UpdateDocument: %v", err)
	}
	if _, err := f.svc.ShareDocument(f.ctx, Human(uEdit.ID), resDoc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser,
		PrincipalID:   uTarget.ID,
		Level:         DocumentLevelView,
	}); err != ErrForbidden {
		t.Fatalf("edit ShareDocument = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.ShareDocument(f.ctx, Human(uManage.ID), resDoc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser,
		PrincipalID:   uTarget.ID,
		Level:         DocumentLevelView,
	}); err != nil {
		t.Fatalf("manage ShareDocument: %v", err)
	}

	// 6. A 'comment' share makes the restricted document visible in flat list,
	// root tree listing, and search with Access.Level == DocumentLevelComment.
	listPage, err := f.svc.ListDocuments(f.ctx, Human(uCommentRoot.ID), tn.wsA, ListDocumentsInput{})
	if err != nil {
		t.Fatalf("ListDocuments for comment share: %v", err)
	}
	var foundInList bool
	for _, it := range listPage.Items {
		if it.Document.ID == updatedView.Document.ID {
			foundInList = true
			if it.Access.Level != DocumentLevelComment {
				t.Fatalf("ListDocuments Access.Level = %q, want %q", it.Access.Level, DocumentLevelComment)
			}
		}
	}
	if !foundInList {
		t.Fatalf("ListDocuments for comment share did not include %s", resDoc.ID)
	}

	rootParent := ""
	treePage, err := f.svc.ListDocuments(f.ctx, Human(uCommentRoot.ID), tn.wsA, ListDocumentsInput{ParentID: &rootParent})
	if err != nil {
		t.Fatalf("ListDocuments (tree root) for comment share: %v", err)
	}
	var foundInTree bool
	for _, it := range treePage.Items {
		if it.Document.ID == resDoc.ID {
			foundInTree = true
			if it.Access.Level != DocumentLevelComment {
				t.Fatalf("ListDocuments (tree root) Access.Level = %q, want %q", it.Access.Level, DocumentLevelComment)
			}
		}
	}
	if !foundInTree {
		t.Fatalf("ListDocuments (tree root) for comment share did not include %s", resDoc.ID)
	}

	// The sidebar tree (DocumentTree) admits the row through any live share.
	forest, err := f.svc.DocumentTree(f.ctx, Human(uCommentRoot.ID), tn.wsA, "", false)
	if err != nil {
		t.Fatalf("DocumentTree for comment share: %v", err)
	}
	var foundInForest bool
	for _, n := range forest {
		foundInForest = foundInForest || n.ID == resDoc.ID
	}
	if !foundInForest {
		t.Fatalf("DocumentTree for comment share did not include %s", resDoc.ID)
	}

	searchPage, err := f.svc.ListDocuments(f.ctx, Human(uCommentRoot.ID), tn.wsA, ListDocumentsInput{
		Query: "Alpha",
	})
	if err != nil {
		t.Fatalf("ListDocuments (search) for comment share: %v", err)
	}
	var foundInSearch bool
	for _, h := range searchPage.Items {
		if h.Document.ID == resDoc.ID {
			foundInSearch = true
			if h.Access.Level != DocumentLevelComment {
				t.Fatalf("ListDocuments (search) Access.Level = %q, want %q", h.Access.Level, DocumentLevelComment)
			}
		}
	}
	if !foundInSearch {
		t.Fatalf("ListDocuments (search) for comment share did not include %s", resDoc.ID)
	}
}
