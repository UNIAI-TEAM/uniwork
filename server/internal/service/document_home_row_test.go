package service

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

// SH-S1 T4 (UNI-1780): the home row has one writer. The PATCH and the share
// routes move it through writeDocumentHomeRow, so a merged legacy grant is
// retracted the same way by both, with the existing share-revoked row.

// TestHomeRowWriteRevokesLegacyHomeWorkspaceShare pins the PATCH half: a live
// share for the document's own workspace (lawful data under the old rules) is
// retired by the first write into the home row, in the same transaction, and
// the member keeps the max of both sources until then.
func TestHomeRowWriteRevokesLegacyHomeWorkspaceShare(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1legacy")

	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	legacy := f.share(t, doc, DocumentPrincipalWorkspace, tn.wsA, DocumentLevelEdit, tn.aclOwner.ID)
	doc = setWorkspaceLevel(t, f, doc, "view")

	// Until the first write into the home row the legacy share still grants
	// its level: the resolver takes the max over the row and every share.
	if got := level(t, f, Human(tn.member.ID), doc); got != DocumentLevelEdit {
		t.Fatalf("before the merge the member reads %q, want the legacy share's edit", got)
	}

	if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), doc.ID, UpdateDocumentInput{
		Revision: doc.Revision, Visibility: strPtr("workspace"),
	}); err != nil {
		t.Fatalf("open the home row: %v", err)
	}

	var revoked bool
	if err := f.pool.QueryRow(f.ctx,
		`SELECT revoked_at IS NOT NULL FROM document_shares WHERE id = $1`, legacy.ID).Scan(&revoked); err != nil {
		t.Fatal(err)
	}
	if !revoked {
		t.Fatal("the first home-row write left the legacy home-workspace share live")
	}
	if n := countAudit(t, f, audit.ActionDocumentShareRevoked, doc.ID); n != 1 {
		t.Fatalf("share-revoked audit rows = %d, want 1", n)
	}
	if n := countOutbox(t, f, "document.share_revoked", doc.ID); n != 1 {
		t.Fatalf("share-revoked frames = %d, want 1", n)
	}
	if n := countAudit(t, f, audit.ActionDocumentWorkspaceAccessChanged, doc.ID); n != 1 {
		t.Fatalf("workspace-access audit rows = %d, want 1", n)
	}

	// The row is on at its stored level and the member reads through it: the
	// legacy edit went with the merge, never back into the row.
	row, err := f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Visibility != documentVisibilityWorkspace || row.WorkspaceLevel != "view" {
		t.Fatalf("home row = %q/%q, want workspace/view", row.Visibility, row.WorkspaceLevel)
	}
	acc, err := f.svc.effectiveLevel(f.ctx, f.q, Human(tn.member.ID), row)
	if err != nil {
		t.Fatal(err)
	}
	if acc.Level != DocumentLevelView || acc.Via != DocumentViaMember {
		t.Fatalf("after the merge the member reads %+v, want view via member", acc)
	}
}
