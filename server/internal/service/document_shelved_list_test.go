package service

// ARCHIVE-01 (UNI-1845) SH-5 coverage: shelved rows leave every normal list
// (flat, tree level, workspace tree, recent, shared-with-me, shared_by_me, My
// Folder contents) while q= still finds them and the shelf view
// (?shelved=true) pages them by shelved_at for every caller who can view them.

import (
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// shelveAt stamps the shelved_* four on one row directly: the list tests need
// the state at a chosen instant, not the shelve command's batch walk.
func shelveAt(t *testing.T, f *docPermFixture, id, by string, at time.Time) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE documents
		 SET shelved_at = $3, shelved_by = $2, shelved_by_kind = 'human', shelve_batch_id = $4
		 WHERE id = $1`,
		id, by, at, util.NewID()); err != nil {
		t.Fatal(err)
	}
}

func listDocIDs(items []DocumentListItem) map[string]bool {
	out := make(map[string]bool, len(items))
	for _, it := range items {
		out[it.Document.ID] = true
	}
	return out
}

func TestShelvedDocumentListHiding(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shlist")
	member := Human(tn.member.ID)

	t.Run("SH-5: the flat list and one tree level hide shelved rows; q= finds them with shelved_at", func(t *testing.T) {
		live := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Kế hoạch", searchText: "ke hoach"})
		shelf := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Kế hoạch cũ", searchText: "ke hoach"})
		shelveAt(t, f, shelf.ID, tn.owner.ID, time.Now())

		flat := listFilterPages(t, f, member, tn.wsA, ListDocumentsInput{})
		if got := listDocIDs(flat); !got[live.ID] || got[shelf.ID] {
			t.Fatalf("flat list = %v, want live %s in and shelved %s out", got, live.ID, shelf.ID)
		}

		found := listFilterPages(t, f, member, tn.wsA, ListDocumentsInput{Query: "ke hoach"})
		got := listDocIDs(found)
		if !got[live.ID] || !got[shelf.ID] {
			t.Fatalf("search = %v, want live %s and shelved %s", got, live.ID, shelf.ID)
		}
		for _, it := range found {
			if it.Document.ID == shelf.ID && !it.Document.ShelvedAt.Valid {
				t.Fatalf("shelved search row has no shelved_at: %+v", it.Document.ShelvedAt)
			}
		}

		// One tree level (parent_id): a shelved child under a live parent is
		// the partial-unshelve shape; it must not appear.
		root := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, kind: DocumentKindFolder, title: "Thư mục"})
		childLive := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: root.ID})
		childShelf := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: root.ID})
		shelveAt(t, f, childShelf.ID, tn.owner.ID, time.Now())
		kids := listFilterPages(t, f, member, tn.wsA, ListDocumentsInput{ParentID: &root.ID})
		if got := listDocIDs(kids); !got[childLive.ID] || got[childShelf.ID] {
			t.Fatalf("children of %s = %v, want live %s in and shelved %s out", root.ID, got, childLive.ID, childShelf.ID)
		}
	})

	t.Run("SH-5: the workspace tree hides shelved nodes", func(t *testing.T) {
		live := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Cây sống"})
		shelf := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Cây lưu"})
		shelveAt(t, f, shelf.ID, tn.owner.ID, time.Now())
		nodes, err := f.svc.DocumentTree(f.ctx, member, tn.wsA, "", false)
		if err != nil {
			t.Fatal(err)
		}
		var ids []string
		treeIDs(nodes, &ids)
		if !containsID(ids, live.ID) || containsID(ids, shelf.ID) {
			t.Fatalf("tree ids = %v, want %s in and %s out", ids, live.ID, shelf.ID)
		}
	})

	t.Run("SH-5: recent hides a shelved document the member edited", func(t *testing.T) {
		live := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		shelf := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET updated_by = $1 WHERE id = ANY($2::text[])`,
			tn.member.ID, []string{live.ID, shelf.ID}); err != nil {
			t.Fatal(err)
		}
		shelveAt(t, f, shelf.ID, tn.owner.ID, time.Now())
		recent, err := f.svc.ListRecentDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Limit: 50})
		if err != nil {
			t.Fatal(err)
		}
		if got := listDocIDs(recent.Items); !got[live.ID] || got[shelf.ID] {
			t.Fatalf("recent = %v, want %s in and shelved %s out", got, live.ID, shelf.ID)
		}
	})

	t.Run("SH-5: shared-with-me and shared_by_me hide shelved rows", func(t *testing.T) {
		shared := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		sharedShelf := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, shared, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
		f.share(t, sharedShelf, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
		shelveAt(t, f, sharedShelf.ID, tn.aclOwner.ID, time.Now())

		page, err := f.svc.ListSharedWithMe(f.ctx, tn.member.ID, tn.orgID, SharedWithMeQuery{Limit: 50})
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]bool{}
		for _, it := range page.Items {
			got[it.Document.ID] = true
		}
		if !got[shared.ID] || got[sharedShelf.ID] {
			t.Fatalf("shared-with-me = %v, want %s in and shelved %s out", got, shared.ID, sharedShelf.ID)
		}

		// shared_by_me on the flat list: the shelved share disappears too.
		mine := listFilterPages(t, f, Human(tn.aclOwner.ID), tn.wsA, ListDocumentsInput{SharedByMe: true})
		if got := listDocIDs(mine); !got[shared.ID] || got[sharedShelf.ID] {
			t.Fatalf("shared_by_me = %v, want %s in and shelved %s out", got, shared.ID, sharedShelf.ID)
		}
	})

	t.Run("SH-5: the My Folder listing hides a shelved child", func(t *testing.T) {
		mf, _, err := f.svc.EnsureMyFolder(f.ctx, member, tn.wsA)
		if err != nil {
			t.Fatal(err)
		}
		parent := mf.Document.ID
		live := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.member.ID, createdBy: tn.member.ID, parent: parent})
		shelf := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.member.ID, createdBy: tn.member.ID, parent: parent})
		shelveAt(t, f, shelf.ID, tn.member.ID, time.Now())
		kids := listFilterPages(t, f, member, tn.wsA, ListDocumentsInput{ParentID: &parent})
		if got := listDocIDs(kids); !got[live.ID] || got[shelf.ID] {
			t.Fatalf("my folder children = %v, want %s in and shelved %s out", got, live.ID, shelf.ID)
		}
	})

	t.Run("SH-5: direct GET still answers a shelved document with shelved_at", func(t *testing.T) {
		shelf := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		shelveAt(t, f, shelf.ID, tn.owner.ID, time.Now())
		view, err := f.svc.GetDocument(f.ctx, member, shelf.ID)
		if err != nil {
			t.Fatalf("GetDocument on shelved doc = %v, want 200", err)
		}
		if !view.Document.ShelvedAt.Valid || view.Document.ShelvedBy.String != tn.owner.ID {
			t.Fatalf("shelved fields = at %v by %v, want set by %s", view.Document.ShelvedAt, view.Document.ShelvedBy, tn.owner.ID)
		}
	})
}
