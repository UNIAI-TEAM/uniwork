package service

import (
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// SH-S1 T4 (UNI-1780) item 2: a share whose principal is the document's own
// workspace is not a document_shares row. It merges into the home row through
// the one writer, so the member reads it as membership, manage is refused
// (Q-S1), and an AdminScope-only caller cannot widen a private document
// (DOC-05, the self-share rule).

// TestShareHomeWorkspaceMergesIntoHomeRow is the happy path: no row, the home
// row on at the requested level, one workspace-access audit row and its frame
// - and no document.shared row, because no grant exists.
func TestShareHomeWorkspaceMergesIntoHomeRow(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1merge")

	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	sh, err := f.svc.ShareDocument(f.ctx, Human(tn.aclOwner.ID), doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelView,
	})
	if err != nil {
		t.Fatalf("share the home workspace: %v", err)
	}
	// The answer describes the home-row grant: right principal, right level,
	// no row id and no created_at.
	if sh.PrincipalType != DocumentPrincipalWorkspace || sh.PrincipalID != tn.wsA ||
		sh.Level != string(DocumentLevelView) || sh.ID != "" || sh.CreatedAt.Valid {
		t.Fatalf("merged share answer = %+v, want the home-row grant with no row id", sh)
	}

	var rows int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM document_shares WHERE document_id = $1`, doc.ID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatalf("a share for the home workspace wrote %d document_shares rows, want 0", rows)
	}
	row, err := f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Visibility != documentVisibilityWorkspace || row.WorkspaceLevel != string(DocumentLevelView) {
		t.Fatalf("home row = %q/%q, want workspace/view", row.Visibility, row.WorkspaceLevel)
	}
	// The merge is an access change like any other, so it bumps the document
	// revision by exactly one (C-01 §9.1 item 3).
	if row.Revision != doc.Revision+1 {
		t.Fatalf("merged home row revision = %d, want exactly one bump from %d", row.Revision, doc.Revision)
	}
	if n := countAudit(t, f, audit.ActionDocumentWorkspaceAccessChanged, doc.ID); n != 1 {
		t.Fatalf("workspace-access audit rows = %d, want 1", n)
	}
	if n := countOutbox(t, f, "document.workspace_access_changed", doc.ID); n != 1 {
		t.Fatalf("workspace-access frames = %d, want 1", n)
	}
	if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 0 {
		t.Fatalf("document.shared rows = %d, want none: the merge writes no grant", n)
	}
	// The member reads it as membership, never as a share.
	if got := level(t, f, Human(tn.member.ID), row); got != DocumentLevelView {
		t.Fatalf("member level after the merge = %q, want view", got)
	}

	// A new level moves the row; the same level again writes nothing.
	if _, err := f.svc.ShareDocument(f.ctx, Human(tn.aclOwner.ID), doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelComment,
	}); err != nil {
		t.Fatalf("re-level the home row: %v", err)
	}
	if _, err := f.svc.ShareDocument(f.ctx, Human(tn.aclOwner.ID), doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelComment,
	}); err != nil {
		t.Fatalf("same level again: %v", err)
	}
	row, err = f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.WorkspaceLevel != string(DocumentLevelComment) {
		t.Fatalf("home row level = %q, want comment", row.WorkspaceLevel)
	}
	// The re-level bumped the revision once more, and the same level again
	// after it left that second bump where it was: two writes, two bumps.
	if row.Revision != doc.Revision+2 {
		t.Fatalf("re-levelled home row revision = %d, want exactly two bumps from %d", row.Revision, doc.Revision)
	}
	if n := countAudit(t, f, audit.ActionDocumentWorkspaceAccessChanged, doc.ID); n != 2 {
		t.Fatalf("workspace-access audit rows = %d, want 2: the same level again is a no-op", n)
	}
}

// TestShareHomeWorkspaceRetiresALegacyShare covers the share-route half of the
// merge: the level the command carries is the one the home row takes, and the
// legacy live share for the same workspace is revoked with its own audit row.
func TestShareHomeWorkspaceRetiresALegacyShare(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1mergeold")

	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	legacy := f.share(t, doc, DocumentPrincipalWorkspace, tn.wsA, DocumentLevelView, tn.aclOwner.ID)
	if got := level(t, f, Human(tn.member.ID), doc); got != DocumentLevelView {
		t.Fatalf("before the merge the member reads the legacy share as %q, want view", got)
	}

	if _, err := f.svc.ShareDocument(f.ctx, Human(tn.aclOwner.ID), doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelEdit,
	}); err != nil {
		t.Fatalf("merge the share: %v", err)
	}

	var revoked bool
	if err := f.pool.QueryRow(f.ctx,
		`SELECT revoked_at IS NOT NULL FROM document_shares WHERE id = $1`, legacy.ID).Scan(&revoked); err != nil {
		t.Fatal(err)
	}
	if !revoked {
		t.Fatal("the merge left the legacy home-workspace share live")
	}
	if n := countAudit(t, f, audit.ActionDocumentShareRevoked, doc.ID); n != 1 {
		t.Fatalf("share-revoked audit rows = %d, want 1", n)
	}
	if n := countOutbox(t, f, "document.share_revoked", doc.ID); n != 1 {
		t.Fatalf("share-revoked frames = %d, want 1", n)
	}
	row, err := f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Visibility != documentVisibilityWorkspace || row.WorkspaceLevel != string(DocumentLevelEdit) {
		t.Fatalf("home row = %q/%q, want workspace/edit", row.Visibility, row.WorkspaceLevel)
	}
	if got := level(t, f, Human(tn.member.ID), row); got != DocumentLevelEdit {
		t.Fatalf("member level after the merge = %q, want the row's edit", got)
	}
}

// TestMergeHomeWorkspaceShareRefusesAdminScopeWidening is DOC-05 on the merge
// path: an AdminScope-only caller cannot open a restricted document to its
// workspace, exactly as the PATCH refuses it; the ACL owner (manage) can.
func TestMergeHomeWorkspaceShareRefusesAdminScopeWidening(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1mergeadmin")
	H := Human

	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	_, err := f.svc.ShareDocument(f.ctx, H(tn.wsAdmin.ID), doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelView,
	})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "break_glass_required" || ce.Status != 403 {
		t.Fatalf("AdminScope widening = %v, want 403 break_glass_required", err)
	}
	var rows int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_shares WHERE document_id = $1`, doc.ID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	row, err := f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rows != 0 || row.Visibility != "restricted" {
		t.Fatalf("a refused widening wrote shares=%d visibility=%q, want 0/restricted", rows, row.Visibility)
	}
	if n := countAudit(t, f, audit.ActionDocumentWorkspaceAccessChanged, doc.ID); n != 0 {
		t.Fatalf("a refused widening wrote %d workspace-access rows, want 0", n)
	}

	// Control: manage (the ACL owner) widens the same document.
	if _, err := f.svc.ShareDocument(f.ctx, H(tn.aclOwner.ID), doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelView,
	}); err != nil {
		t.Fatalf("ACL owner widening: %v", err)
	}
	row, err = f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Visibility != documentVisibilityWorkspace || row.WorkspaceLevel != string(DocumentLevelView) {
		t.Fatalf("widened home row = %q/%q, want workspace/view", row.Visibility, row.WorkspaceLevel)
	}
}

// TestShareHomeWorkspaceRefusesManage is Q-S1: the home row tops out at edit,
// and the refusal writes nothing.
func TestShareHomeWorkspaceRefusesManage(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1mergemg")

	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	setWorkspaceLevel(t, f, doc, "comment")

	_, err := f.svc.ShareDocument(f.ctx, Human(tn.aclOwner.ID), doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelManage,
	})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "level_not_allowed" || ce.Status != 422 {
		t.Fatalf("manage for the home workspace = %v, want 422 level_not_allowed", err)
	}
	if ce.Fields["max"] != string(DocumentLevelEdit) {
		t.Fatalf("level_not_allowed fields = %v, want max=edit", ce.Fields)
	}
	row, err := f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.WorkspaceLevel != string(DocumentLevelComment) {
		t.Fatalf("refused manage moved the home row to %q, want comment", row.WorkspaceLevel)
	}
	if n := countAudit(t, f, audit.ActionDocumentWorkspaceAccessChanged, doc.ID); n != 0 {
		t.Fatalf("refused manage wrote %d workspace-access rows, want 0", n)
	}
}

// TestOtherPrincipalsKeepTheirShareRows is the control for the merge: only the
// document's own workspace changes shape. Another workspace still gets a
// document_shares row at manage, and the organization gets a document_shares
// row up to edit (while manage on organization is refused with 422
// level_not_allowed per Q-S1 / D3, SH-S2).
func TestOtherPrincipalsKeepTheirShareRows(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1mergeother")
	H := Human

	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	setWorkspaceLevel(t, f, doc, "view")

	if _, err := f.svc.ShareDocument(f.ctx, H(tn.aclOwner.ID), doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: DocumentLevelManage,
	}); !codedIs(err, "level_not_allowed") {
		t.Fatalf("ShareDocument(organization, manage) = %v, want 422 level_not_allowed (Q-S1 / D3)", err)
	}

	for _, in := range []DocumentShareInput{
		{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: DocumentLevelManage},
		{PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: DocumentLevelEdit},
		{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
	} {
		sh, err := f.svc.ShareDocument(f.ctx, H(tn.aclOwner.ID), doc.ID, in)
		if err != nil {
			t.Fatalf("%+v: %v", in, err)
		}
		if sh.ID == "" {
			t.Fatalf("%+v merged into the home row, want a real share row", in)
		}
	}
	row, err := f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Visibility != "restricted" || row.WorkspaceLevel != "view" {
		t.Fatalf("other principals moved the home row to %q/%q", row.Visibility, row.WorkspaceLevel)
	}
	if n := countAudit(t, f, audit.ActionDocumentWorkspaceAccessChanged, doc.ID); n != 0 {
		t.Fatalf("other principals wrote %d workspace-access rows, want 0", n)
	}
	if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 3 {
		t.Fatalf("document.shared rows = %d, want 3", n)
	}
}

// TestApplyDocumentShareMergesHomeWorkspaceInAList pins the shared helper the
// batch route and SH-S2's PUT /access drive: inside one transaction, a list
// that carries the home workspace among other principals merges that one and
// writes rows for the rest.
func TestApplyDocumentShareMergesHomeWorkspaceInAList(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1mergelist")

	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	var got []db.DocumentShare
	err := f.svc.withDocumentViewOrAdministerMutationLocked(f.ctx, Human(tn.aclOwner.ID), doc.ID, "", shelveWriteRefused,
		func(q *db.Queries, doc db.Document, access DocumentAccess) error {
			for _, in := range []DocumentShareInput{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelComment},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: DocumentLevelEdit},
			} {
				sh, err := f.svc.applyDocumentShare(f.ctx, q, Human(tn.aclOwner.ID), doc, access, in)
				if err != nil {
					return err
				}
				got = append(got, sh)
			}
			return nil
		})
	if err != nil {
		t.Fatalf("apply the list: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("answers = %d, want 3", len(got))
	}
	if got[0].ID == "" || got[2].ID == "" {
		t.Fatalf("the user grants must be real rows: %+v", got)
	}
	if got[1].ID != "" || got[1].PrincipalID != tn.wsA || got[1].Level != string(DocumentLevelComment) {
		t.Fatalf("the home-workspace grant = %+v, want the merged answer", got[1])
	}
	var forWorkspace, forUsers int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FILTER (WHERE principal_type = 'workspace'), count(*) FILTER (WHERE principal_type = 'user')
		 FROM document_shares WHERE document_id = $1 AND revoked_at IS NULL`, doc.ID).Scan(&forWorkspace, &forUsers); err != nil {
		t.Fatal(err)
	}
	if forWorkspace != 0 || forUsers != 2 {
		t.Fatalf("live rows = %d workspace/%d user, want 0/2", forWorkspace, forUsers)
	}
	row, err := f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Visibility != documentVisibilityWorkspace || row.WorkspaceLevel != string(DocumentLevelComment) {
		t.Fatalf("home row = %q/%q, want workspace/comment", row.Visibility, row.WorkspaceLevel)
	}
	// Only the one merged grant is an access change on the document row, so
	// the revision moved exactly once for the whole list, not once per
	// principal (C-01 §9.1 item 3).
	if row.Revision != doc.Revision+1 {
		t.Fatalf("list merge revision = %d, want exactly one bump from %d", row.Revision, doc.Revision)
	}
	if got := level(t, f, Human(tn.member.ID), row); got != DocumentLevelComment {
		t.Fatalf("member level = %q, want the merged comment", got)
	}
}
