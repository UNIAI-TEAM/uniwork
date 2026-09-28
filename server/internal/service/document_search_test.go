package service

// G1-04b (UNI-678) list/search tests: the permission filter sits inside the
// query before the limit, cursors are stable, and owner-service documents
// never appear in free listings.

import (
	"testing"
	"time"
)

func listIDs(page DocumentListPage) []string {
	ids := make([]string, 0, len(page.Items))
	for _, it := range page.Items {
		ids = append(ids, it.Document.ID)
	}
	return ids
}

func containsID(ids []string, id string) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

func TestDocumentSearch(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "srch")

	t.Run("permission filter runs before the limit", func(t *testing.T) {
		// Two restricted pages sort ahead of the visible one (newer
		// updated_at). A fetch-50-filter-later list asked for 1 row would
		// answer empty; the in-query filter answers the member's page.
		base := time.Now().Add(-time.Hour)
		hidden1 := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, updatedAt: base.Add(2 * time.Minute)})
		hidden2 := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, updatedAt: base.Add(time.Minute)})
		open := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, updatedAt: base})
		page, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Limit: 1})
		if err != nil {
			t.Fatal(err)
		}
		ids := listIDs(page)
		if len(ids) != 1 || ids[0] != open.ID {
			t.Fatalf("page = %v, want only %s (not %s/%s)", ids, open.ID, hidden1.ID, hidden2.ID)
		}
	})

	t.Run("the cursor is stable and never repeats a row", func(t *testing.T) {
		at := time.Now().Add(-2 * time.Hour)
		var docs []string
		for i := 0; i < 3; i++ {
			d := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Con trỏ", searchText: "con tro", updatedAt: at})
			docs = append(docs, d.ID)
		}
		member := Human(tn.member.ID)
		var seen []string
		cursor := ""
		for i := 0; i < len(docs)+2; i++ {
			page, err := f.svc.ListDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Query: "con tro", Limit: 1, Cursor: cursor})
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range listIDs(page) {
				if containsID(seen, id) {
					t.Fatalf("cursor repeated %s (seen %v)", id, seen)
				}
				seen = append(seen, id)
			}
			if page.NextCursor == "" {
				break
			}
			cursor = page.NextCursor
		}
		if len(seen) != len(docs) {
			t.Fatalf("walked %v, want all %d docs", seen, len(docs))
		}
		for _, id := range docs {
			if !containsID(seen, id) {
				t.Fatalf("doc %s missing from cursor walk %v", id, seen)
			}
		}
	})

	t.Run("owner-service documents never appear in free listings", func(t *testing.T) {
		owned := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "wp-search", title: "Sản phẩm sở hữu", searchText: "san pham so huu"})
		for _, in := range []ListDocumentsInput{
			{},
			{Query: "san pham so huu"},
			{Archived: true},
		} {
			// The org owner sees everything member-visible; an owned doc is
			// still out of scope (§13.6).
			page, err := f.svc.ListDocuments(f.ctx, Human(tn.owner.ID), tn.wsA, in)
			if err != nil {
				t.Fatal(err)
			}
			if containsID(listIDs(page), owned.ID) {
				t.Fatalf("owned document leaked into listing %+v", in)
			}
		}
		recent, err := f.svc.ListRecentDocuments(f.ctx, Human(tn.owner.ID), tn.wsA, ListDocumentsInput{})
		if err != nil {
			t.Fatal(err)
		}
		if containsID(listIDs(recent), owned.ID) {
			t.Fatal("owned document leaked into recents")
		}
	})

	t.Run("folded text matches Vietnamese typing without diacritics", func(t *testing.T) {
		d := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Báo cáo", searchText: foldForSearch("Báo cáo tài chính")})
		page, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Query: "tai chinh"})
		if err != nil {
			t.Fatal(err)
		}
		if !containsID(listIDs(page), d.ID) {
			t.Fatalf("folded query missed %s", d.ID)
		}
	})

	t.Run("archived docs leave the live list and enter the trash view", func(t *testing.T) {
		dead := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, archived: true})
		live, err := f.svc.ListDocuments(f.ctx, Human(tn.owner.ID), tn.wsA, ListDocumentsInput{Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if containsID(listIDs(live), dead.ID) {
			t.Fatal("archived doc in the live list")
		}
		trash, err := f.svc.ListDocuments(f.ctx, Human(tn.owner.ID), tn.wsA, ListDocumentsInput{Archived: true, Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if !containsID(listIDs(trash), dead.ID) {
			t.Fatal("archived doc missing from the trash view")
		}
		// The trash is manage-only: a plain member's manage-less set is empty for it.
		asMember, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Archived: true, Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if containsID(listIDs(asMember), dead.ID) {
			t.Fatal("member read the trash view")
		}
	})

	t.Run("a non-member still sees documents shared with them", func(t *testing.T) {
		shared := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, shared, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
		page, err := f.svc.ListDocuments(f.ctx, Human(tn.outsider.ID), tn.wsA, ListDocumentsInput{Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if !containsID(listIDs(page), shared.ID) {
			t.Fatal("user share did not reach a workspace non-member")
		}
		// ...and a workspace share reaches its members through membership.
		wsShared := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, wsShared, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelView, tn.aclOwner.ID)
		page, err = f.svc.ListDocuments(f.ctx, Human(tn.bMember.ID), tn.wsA, ListDocumentsInput{Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if !containsID(listIDs(page), wsShared.ID) {
			t.Fatal("workspace share did not reach a B member")
		}
	})

	t.Run("filters apply inside the page", func(t *testing.T) {
		pageDoc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Lọc kind", searchText: "loc kind"})
		fileDoc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, kind: "file", title: "Lọc kind", searchText: "loc kind"})
		page, err := f.svc.ListDocuments(f.ctx, Human(tn.owner.ID), tn.wsA, ListDocumentsInput{Query: "loc kind", Kind: DocumentKindFile})
		if err != nil {
			t.Fatal(err)
		}
		ids := listIDs(page)
		if !containsID(ids, fileDoc.ID) || containsID(ids, pageDoc.ID) {
			t.Fatalf("kind filter = %v, want only the file", ids)
		}
	})

	t.Run("children list is position-ordered and parent-scoped", func(t *testing.T) {
		root := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		second := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: root.ID, position: 2})
		first := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: root.ID, position: 1})
		page, err := f.svc.ListDocuments(f.ctx, Human(tn.owner.ID), tn.wsA, ListDocumentsInput{ParentID: &root.ID, Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		ids := listIDs(page)
		if len(ids) != 2 || ids[0] != first.ID || ids[1] != second.ID {
			t.Fatalf("children = %v, want [%s %s] by position", ids, first.ID, second.ID)
		}
	})
}
