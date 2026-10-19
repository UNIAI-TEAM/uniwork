package service

import (
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestBatchNotifyDecisionsPinsDirectLevelBoundaries is N-01: the two
// boundaries of the R2-02 exclusion in batchNotifyDecisions. The consumer
// path cannot observe the equal row — applyAccessBatchItem returns Unchanged
// for view→view and never writes a document.shared event — so this same-
// package test calls the decision function directly.
//
// (a) existing direct view raised to edit while a group item in the same
// batch also changes → exactly one decision, on the user item, at edit.
// (b) existing direct view left at view while a group item raises the
// recipient's effective level to manage → no decision (the equal row is
// skipped). Both item orders.
func TestBatchNotifyDecisionsPinsDirectLevelBoundaries(t *testing.T) {
	type tc struct {
		name       string
		userLevel  DocumentLevel
		groupLevel DocumentLevel
		wantNotify bool
		userFirst  bool
	}
	cases := []tc{
		{name: "direct view raised to edit, group also changes / user first", userLevel: DocumentLevelEdit, groupLevel: DocumentLevelView, wantNotify: true, userFirst: true},
		{name: "direct view raised to edit, group also changes / group first", userLevel: DocumentLevelEdit, groupLevel: DocumentLevelView, wantNotify: true, userFirst: false},
		{name: "equal direct view, group raises to manage / user first", userLevel: DocumentLevelView, groupLevel: DocumentLevelManage, wantNotify: false, userFirst: true},
		{name: "equal direct view, group raises to manage / group first", userLevel: DocumentLevelView, groupLevel: DocumentLevelManage, wantNotify: false, userFirst: false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newDocPermFixture(t)
			tn := f.tenant(t, "n01bnd")
			doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
			f.share(t, doc, DocumentPrincipalUser, tn.bMember.ID, DocumentLevelView, tn.aclOwner.ID)

			items := []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: docLevelPtr(c.groupLevel)},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: docLevelPtr(c.userLevel)},
			}
			if c.userFirst {
				items[0], items[1] = items[1], items[0]
			}

			sharesBefore, err := f.q.ListDocumentShares(f.ctx, db.ListDocumentSharesParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
			})
			if err != nil {
				t.Fatal(err)
			}
			docAfter, sharesAfter := simulateAccessBatchState(doc, sharesBefore, items)

			before, err := f.svc.resolveLevelInTenantWithShares(f.ctx, f.q, Human(tn.bMember.ID), doc, sharesBefore)
			if err != nil {
				t.Fatal(err)
			}
			if before.Level != DocumentLevelView {
				t.Fatalf("effective before = %s, want view", before.Level)
			}
			after, err := f.svc.resolveLevelInTenantWithShares(f.ctx, f.q, Human(tn.bMember.ID), docAfter, sharesAfter)
			if err != nil {
				t.Fatal(err)
			}
			if !c.wantNotify && after.Level != DocumentLevelManage {
				t.Fatalf("effective after = %s, want manage (group rise so the equal row is the only reason to skip)", after.Level)
			}
			if c.wantNotify && after.Level != DocumentLevelEdit {
				t.Fatalf("effective after = %s, want edit", after.Level)
			}

			got, err := f.svc.batchNotifyDecisions(f.ctx, f.q, Human(tn.aclOwner.ID), doc, sharesBefore, docAfter, sharesAfter, items)
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != len(items) {
				t.Fatalf("decisions = %d, want %d", len(got), len(items))
			}

			var stamped []int
			for i, uid := range got {
				if uid == "" {
					continue
				}
				if uid != tn.bMember.ID {
					t.Fatalf("decisions[%d] = %q, want recipient %s", i, uid, tn.bMember.ID)
				}
				stamped = append(stamped, i)
			}
			if c.wantNotify {
				if len(stamped) != 1 {
					t.Fatalf("decisions = %v, want exactly one notify for the user item", got)
				}
				it := items[stamped[0]]
				if it.PrincipalType != DocumentPrincipalUser || it.Level == nil || *it.Level != DocumentLevelEdit {
					t.Fatalf("stamped item = %+v, want user edit", it)
				}
			} else if len(stamped) != 0 {
				t.Fatalf("equal direct view skipped: decisions = %v, want none", got)
			}
		})
	}
}
