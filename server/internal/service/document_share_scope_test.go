package service

import (
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// SH-S3 (UNI-1782; addendum §6.4, §7, AC08, AC19): every human list row
// (flat list, folder children, search, recent, shared-with-me, and AdminScope
// rows without read level) carries share_scope from one aggregate SQL query per
// page; agent rows omit it (nil).

func wantShareScope(t *testing.T, label string, got *DocumentShareScope, want DocumentShareScope) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s: share_scope is nil, want %+v", label, want)
	}
	if *got != want {
		t.Fatalf("%s: share_scope = %+v, want %+v", label, *got, want)
	}
}

func insertLiveShareLink(t *testing.T, f *docPermFixture, d db.Document, expiresAt time.Time) db.DocumentShareLink {
	t.Helper()
	l, err := f.q.InsertDocumentShareLink(f.ctx, db.InsertDocumentShareLinkParams{
		ID:             util.NewID(),
		OrganizationID: d.OrganizationID,
		WorkspaceID:    d.WorkspaceID,
		DocumentID:     d.ID,
		TokenHash:      util.NewID() + util.NewID(),
		ExpiresAt:      pgtype.Timestamptz{Time: expiresAt, Valid: true},
		CreatedBy:      d.CreatedBy,
		CreatedByKind:  "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	return l
}

// TestDocumentShareScopeAC08RestrictedUnshared pins AC08: a restricted
// document with no home row, no share and no link carries all-false/zero
// share_scope for both the ACL owner and an AdminScope viewer with no read
// level (share_scope is metadata and carries no names).
func TestDocumentShareScopeAC08RestrictedUnshared(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "scope-ac08")
	doc := f.doc(t, tn, docSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
	})
	want := DocumentShareScope{
		HomeWorkspace: false,
		Users:         0,
		Workspaces:    0,
		Organization:  false,
		PublicLink:    false,
	}

	ownerPage, err := f.svc.ListDocuments(f.ctx, Human(tn.aclOwner.ID), tn.wsA, ListDocumentsInput{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	wantShareScope(t, "aclOwner row", lockListRow(t, ownerPage, doc.ID).ShareScope, want)

	// Workspace admin on a restricted document they do not own has AdminScope
	// with Level=none; they still receive share_scope metadata on the row.
	adminPage, err := f.svc.ListDocuments(f.ctx, Human(tn.wsAdmin.ID), tn.wsA, ListDocumentsInput{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	row := lockListRow(t, adminPage, doc.ID)
	if !row.Access.AdminScope || row.Access.Level != DocumentLevelNone {
		t.Fatalf("wsAdmin access = %+v, want AdminScope with Level=none", row.Access)
	}
	wantShareScope(t, "AdminScope row", row.ShareScope, want)
}

// TestDocumentShareScopeAC19CountsAcrossSurfaces pins AC19 across flat list,
// folder children, search, recent and shared-with-me: home_workspace=true,
// 2 user shares, 1 other-workspace share, public_link=true (and organization
// share when granted).
func TestDocumentShareScopeAC19CountsAcrossSurfaces(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "scope-ac19")

	folder := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindFolder, title: "Thư mục AC19",
	})
	doc := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindPage, parent: folder.ID, title: "Kế hoạch AC19",
		searchText: documentSearchText("Kế hoạch AC19", "noi dung tim kiem ac19"),
	})

	f.share(t, doc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
	f.share(t, doc, DocumentPrincipalUser, tn.bMember.ID, DocumentLevelEdit, tn.aclOwner.ID)
	f.share(t, doc, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelComment, tn.aclOwner.ID)
	insertLiveShareLink(t, f, doc, time.Now().Add(24*time.Hour))

	want := DocumentShareScope{
		HomeWorkspace: true,
		Users:         2,
		Workspaces:    1,
		Organization:  false,
		PublicLink:    true,
	}

	// 1. Flat list
	flat, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	wantShareScope(t, "flat list", lockListRow(t, flat, doc.ID).ShareScope, want)

	// 2. Folder children (parent_id)
	parentID := folder.ID
	children, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{ParentID: &parentID, Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	wantShareScope(t, "folder children", lockListRow(t, children, doc.ID).ShareScope, want)

	// 3. Search (q)
	search, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Query: "ke hoach ac19", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	wantShareScope(t, "search", lockListRow(t, search, doc.ID).ShareScope, want)

	// 4. Recent documents
	recent, err := f.svc.ListRecentDocuments(f.ctx, Human(tn.aclOwner.ID), tn.wsA, ListDocumentsInput{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	wantShareScope(t, "recent", lockListRow(t, recent, doc.ID).ShareScope, want)

	// 5. Shared-with-me (for outsider who is not in wsA)
	shared, err := f.svc.ListSharedWithMe(f.ctx, tn.outsider.ID, tn.orgID, SharedWithMeQuery{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	var sharedRow *SharedDocument
	for i := range shared.Items {
		if shared.Items[i].Document.ID == doc.ID {
			sharedRow = &shared.Items[i]
		}
	}
	if sharedRow == nil {
		t.Fatalf("shared-with-me missing document %s", doc.ID)
	}
	wantShareScope(t, "shared-with-me", sharedRow.ShareScope, want)

	// 6. Adding an organization share flips Organization to true.
	f.share(t, doc, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID)
	wantWithOrg := want
	wantWithOrg.Organization = true
	afterOrg, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	wantShareScope(t, "with organization share", lockListRow(t, afterOrg, doc.ID).ShareScope, wantWithOrg)
}

// TestDocumentShareScopeLegacyHomeWorkspaceShare verifies that a legacy live
// document_shares row naming the document's own workspace counts as
// home_workspace=true and never increments workspaces.
func TestDocumentShareScopeLegacyHomeWorkspaceShare(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "scope-legacy")

	restrictedWithLegacy := f.doc(t, tn, docSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
	})
	f.share(t, restrictedWithLegacy, DocumentPrincipalWorkspace, tn.wsA, DocumentLevelView, tn.aclOwner.ID)

	wsWithLegacy := f.doc(t, tn, docSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
	})
	f.share(t, wsWithLegacy, DocumentPrincipalWorkspace, tn.wsA, DocumentLevelEdit, tn.aclOwner.ID)

	page, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	want := DocumentShareScope{HomeWorkspace: true, Users: 0, Workspaces: 0, Organization: false, PublicLink: false}
	wantShareScope(t, "restricted with legacy home-ws share", lockListRow(t, page, restrictedWithLegacy.ID).ShareScope, want)
	wantShareScope(t, "workspace-visible with legacy home-ws share", lockListRow(t, page, wsWithLegacy.ID).ShareScope, want)
}

// TestDocumentShareScopeRevokedAndExpiredIgnored verifies that revoked shares
// and revoked or expired public links do not count toward share_scope.
func TestDocumentShareScopeRevokedAndExpiredIgnored(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "scope-revoked")

	doc := f.doc(t, tn, docSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
	})
	shUser := f.share(t, doc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
	shWS := f.share(t, doc, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelView, tn.aclOwner.ID)
	shOrg := f.share(t, doc, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID)
	f.revoke(t, shUser, tn.aclOwner.ID)
	f.revoke(t, shWS, tn.aclOwner.ID)
	f.revoke(t, shOrg, tn.aclOwner.ID)

	// One expired link and one revoked link.
	insertLiveShareLink(t, f, doc, time.Now().Add(-time.Minute))
	revokedLink := insertLiveShareLink(t, f, doc, time.Now().Add(24*time.Hour))
	if _, err := f.q.RevokeDocumentShareLink(f.ctx, db.RevokeDocumentShareLinkParams{
		ID:             revokedLink.ID,
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
		RevokedBy:      nullText(tn.aclOwner.ID),
	}); err != nil {
		t.Fatal(err)
	}

	page, err := f.svc.ListDocuments(f.ctx, Human(tn.aclOwner.ID), tn.wsA, ListDocumentsInput{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	wantShareScope(t, "all revoked/expired", lockListRow(t, page, doc.ID).ShareScope, DocumentShareScope{})
}

// TestDocumentShareScopeOneQueryPerPageNoNPlusOne proves share_scope adds one
// batch query per page rather than one query per document row.
func TestDocumentShareScopeOneQueryPerPageNoNPlusOne(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "scope-batch")

	for i := 0; i < 25; i++ {
		d := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: fmt.Sprintf("Tài liệu phạm vi %02d", i),
		})
		f.share(t, d, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
	}

	cPool, counter := countingPool(t, f.pool)
	tracedSvc := newDocumentServiceForTest(cPool, db.New(cPool))

	counter.n.Store(0)
	page5, err := tracedSvc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	q5 := counter.n.Load()
	if len(page5.Items) != 5 {
		t.Fatalf("page5 len = %d, want 5", len(page5.Items))
	}
	for _, it := range page5.Items {
		wantShareScope(t, it.Document.ID, it.ShareScope, DocumentShareScope{HomeWorkspace: true, Users: 1})
	}

	counter.n.Store(0)
	page25, err := tracedSvc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	q25 := counter.n.Load()
	if len(page25.Items) != 25 {
		t.Fatalf("page25 len = %d, want 25", len(page25.Items))
	}
	for _, it := range page25.Items {
		wantShareScope(t, it.Document.ID, it.ShareScope, DocumentShareScope{HomeWorkspace: true, Users: 1})
	}
	if q25 != q5 {
		t.Fatalf("query count grew with page size: 5 items = %d queries, 25 items = %d queries", q5, q25)
	}
}

// TestDocumentShareScopeAbsentForAgent proves C-01 §4: agent actors do not
// receive share_scope on list rows.
func TestDocumentShareScopeAbsentForAgent(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "scope-agent")
	doc := f.doc(t, tn, docSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
	})
	f.share(t, doc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)

	page, err := f.svc.ListDocuments(f.ctx, agentActor(tn.agent), tn.wsA, ListDocumentsInput{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	row := lockListRow(t, page, doc.ID)
	if row.ShareScope != nil {
		t.Fatalf("agent row carries share_scope %+v, want nil", *row.ShareScope)
	}
}
