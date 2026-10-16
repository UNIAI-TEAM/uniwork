package service

// G1-04b (UNI-678) list/search tests: the permission filter sits inside the
// query before the limit, cursors are stable, and owner-service documents
// never appear in free listings.

import (
	"errors"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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

	t.Run("an insert between pages does not shift the cursor", func(t *testing.T) {
		// Keyset property OFFSET cannot give: a row inserted ahead of the
		// cursor belongs to a page the reader already passed, so the next
		// page still answers the row that was next in line - never a repeat.
		// The query scopes the listing to this subtest's own documents.
		base := time.Now().Add(-3 * time.Hour)
		spec := func(at time.Time) treeDocSpec {
			return treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
				searchText: "cursor-shift", updatedAt: at}
		}
		d1 := f.treeDoc(t, tn, spec(base.Add(2*time.Minute)))
		d2 := f.treeDoc(t, tn, spec(base.Add(time.Minute)))
		d3 := f.treeDoc(t, tn, spec(base))
		member := Human(tn.member.ID)

		p1, err := f.svc.ListDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Query: "cursor-shift", Limit: 1})
		if err != nil {
			t.Fatal(err)
		}
		if ids := listIDs(p1); len(ids) != 1 || ids[0] != d1.ID {
			t.Fatalf("page 1 = %v, want [%s]", ids, d1.ID)
		}
		// The insert sorts ahead of the cursor (newest updated_at).
		f.treeDoc(t, tn, spec(base.Add(3*time.Minute)))
		p2, err := f.svc.ListDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Query: "cursor-shift", Limit: 1, Cursor: p1.NextCursor})
		if err != nil {
			t.Fatal(err)
		}
		if ids := listIDs(p2); len(ids) != 1 || ids[0] != d2.ID {
			t.Fatalf("page 2 after insert = %v, want [%s] - the inserted row must not shift or repeat", ids, d2.ID)
		}
		p3, err := f.svc.ListDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Query: "cursor-shift", Limit: 1, Cursor: p2.NextCursor})
		if err != nil {
			t.Fatal(err)
		}
		if ids := listIDs(p3); len(ids) != 1 || ids[0] != d3.ID {
			t.Fatalf("page 3 = %v, want [%s]", ids, d3.ID)
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

	t.Run("an agent never reaches a restricted document through a share", func(t *testing.T) {
		// Organization share: a member-visible human sees it through the
		// principal; the agent does not - shares are human-only (R1-01).
		orgShared := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, orgShared, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID)
		// A user share naming the agent's id itself still grants nothing.
		userShared := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, userShared, DocumentPrincipalUser, tn.agent, DocumentLevelView, tn.aclOwner.ID)
		// A workspace share to a workspace the agent sits in: same answer.
		wsShared := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, wsShared, DocumentPrincipalWorkspace, tn.wsA, DocumentLevelView, tn.aclOwner.ID)

		page, err := f.svc.ListDocuments(f.ctx, agentActor(tn.agent), tn.wsA, ListDocumentsInput{Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range []db.Document{orgShared, userShared, wsShared} {
			if containsID(listIDs(page), d.ID) {
				t.Fatalf("agent read restricted doc %s through a share", d.ID)
			}
		}
		// Control: a human member sees the organization and workspace shares.
		page, err = f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		ids := listIDs(page)
		if !containsID(ids, orgShared.ID) || !containsID(ids, wsShared.ID) {
			t.Fatalf("member missed shared docs: %v", ids)
		}
		// The tree hides them from the agent as well.
		tree, err := f.svc.DocumentTree(f.ctx, agentActor(tn.agent), tn.wsA, "", false)
		if err != nil {
			t.Fatal(err)
		}
		var treeIds []string
		treeIDs(tree, &treeIds)
		for _, d := range []db.Document{orgShared, userShared, wsShared} {
			if containsID(treeIds, d.ID) {
				t.Fatalf("agent's tree contains restricted doc %s", d.ID)
			}
		}
	})

	t.Run("the ACL owner finds their own document in the trash", func(t *testing.T) {
		// aclOwner is a plain workspace member (not admin): see_all is false
		// and only the ACL-owner leg admits them to the trash view (R1-03).
		own := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.ArchiveDocument(f.ctx, Human(tn.aclOwner.ID), own.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		trash, err := f.svc.ListDocuments(f.ctx, Human(tn.aclOwner.ID), tn.wsA, ListDocumentsInput{Archived: true, Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if !containsID(listIDs(trash), own.ID) {
			t.Fatal("ACL owner cannot see their own archived document")
		}
		// A co-member without manage still cannot.
		asMember, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Archived: true, Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if containsID(listIDs(asMember), own.ID) {
			t.Fatal("plain member read another's restricted doc in the trash")
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

func TestDocumentListSharedByMe(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "sbm")

	base := time.Now().UTC().Truncate(time.Microsecond).Add(-time.Hour)

	// Included:
	// 1. User share on caller's restricted document.
	userShared := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "User Shared", updatedAt: base.Add(6 * time.Minute),
	})
	f.share(t, userShared, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)

	// 2. Group share (workspace) on caller's restricted document.
	wsGroupShared := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "WS Group Shared", updatedAt: base.Add(5 * time.Minute),
	})
	f.share(t, wsGroupShared, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelComment, tn.aclOwner.ID)

	// 3. Group share (organization) on caller's restricted document.
	orgGroupShared := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "Org Group Shared", updatedAt: base.Add(4 * time.Minute),
	})
	f.share(t, orgGroupShared, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID)

	// 4. Workspace visibility at any workspace_level (view, comment, edit), even with no document_shares rows.
	wsVisView := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "WS Vis View", updatedAt: base.Add(3 * time.Minute),
	})
	setWorkspaceLevel(t, f, wsVisView, "view")

	wsVisComment := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "WS Vis Comment", updatedAt: base.Add(2 * time.Minute),
	})
	setWorkspaceLevel(t, f, wsVisComment, "comment")

	wsVisEdit := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "WS Vis Edit", updatedAt: base.Add(1 * time.Minute),
	})
	setWorkspaceLevel(t, f, wsVisEdit, "edit")

	// Excluded:
	// 1. Restricted with no shares (private).
	privateDoc := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "Private Doc", updatedAt: base.Add(10 * time.Minute),
	})

	// 2. Link-only (restricted with a live document_share_links row, no document_shares row).
	linkOnlyDoc := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "Link Only Doc", updatedAt: base.Add(9 * time.Minute),
	})
	f.arLink(t, linkOnlyDoc, tn.aclOwner.ID, time.Time{})

	// 3. Archived (even if workspace-visible and shared).
	archivedDoc := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "Archived Shared", archived: true, updatedAt: base.Add(8 * time.Minute),
	})
	f.share(t, archivedDoc, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)

	// 4. Work-Result-owned (owner_id IS NOT NULL), even if caller is acl_owner_id and shared/workspace-visible.
	workResultDoc := f.doc(t, tn, docSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		ownerID: "01WPSBM0000000000000000000",
	})
	f.share(t, workResultDoc, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)

	// 5. Someone else's document (acl_owner_id != caller), even if workspace-visible and shared with caller at manage.
	someoneElsesDoc := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.owner.ID, createdBy: tn.owner.ID,
		title: "Someone Elses Doc", updatedAt: base.Add(7 * time.Minute),
	})
	f.share(t, someoneElsesDoc, DocumentPrincipalUser, tn.aclOwner.ID, DocumentLevelManage, tn.owner.ID)

	// 6. A share that was revoked (revoked_at IS NOT NULL) on a restricted document with no other live share.
	revokedShareDoc := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "Revoked Share Doc", updatedAt: base.Add(11 * time.Minute),
	})
	revShare := f.share(t, revokedShareDoc, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
	f.revoke(t, revShare, tn.aclOwner.ID)

	// 7. An expired break-glass grant on a restricted document with no live document_shares row.
	expiredGrantDoc := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "Expired Grant Doc", updatedAt: base.Add(12 * time.Minute),
	})
	f.breakGlass(t, tn, expiredGrantDoc.ID, tn.owner.ID, time.Now().Add(-time.Minute), false)

	page, err := f.svc.ListDocuments(f.ctx, Human(tn.aclOwner.ID), tn.wsA, ListDocumentsInput{
		SharedByMe: true,
		Limit:      100,
	})
	if err != nil {
		t.Fatalf("ListDocuments SharedByMe: %v", err)
	}
	wantOrder := []string{
		userShared.ID,
		wsGroupShared.ID,
		orgGroupShared.ID,
		wsVisView.ID,
		wsVisComment.ID,
		wsVisEdit.ID,
	}
	gotIDs := listIDs(page)
	if len(gotIDs) != len(wantOrder) {
		t.Fatalf("SharedByMe ids = %v, want %v (excluded: private=%s linkOnly=%s archived=%s workResult=%s someoneElses=%s revoked=%s expiredGrant=%s)",
			gotIDs, wantOrder, privateDoc.ID, linkOnlyDoc.ID, archivedDoc.ID, workResultDoc.ID, someoneElsesDoc.ID, revokedShareDoc.ID, expiredGrantDoc.ID)
	}
	for i, wantID := range wantOrder {
		if gotIDs[i] != wantID {
			t.Fatalf("SharedByMe[%d] = %s, want %s (full=%v)", i, gotIDs[i], wantID, gotIDs)
		}
		item := page.Items[i]
		if item.Access.Level != DocumentLevelManage || item.Access.Via != DocumentViaMember {
			t.Fatalf("SharedByMe[%d] access = %+v, want {manage member}", i, item.Access)
		}
		if item.Facts.Origin != "created" {
			t.Fatalf("SharedByMe[%d] facts.origin = %q, want %q", i, item.Facts.Origin, "created")
		}
	}

	// Workspace owner (see_all=true) with SharedByMe=true only sees their own shared rows (someoneElsesDoc), not tn.aclOwner's rows.
	ownerPage, err := f.svc.ListDocuments(f.ctx, Human(tn.owner.ID), tn.wsA, ListDocumentsInput{
		SharedByMe: true,
		Limit:      100,
	})
	if err != nil {
		t.Fatalf("ListDocuments SharedByMe as owner: %v", err)
	}
	ownerIDs := listIDs(ownerPage)
	if len(ownerIDs) != 1 || ownerIDs[0] != someoneElsesDoc.ID {
		t.Fatalf("owner SharedByMe ids = %v, want [%s]", ownerIDs, someoneElsesDoc.ID)
	}

	// Cursor pagination with SharedByMe=true walks all 6 rows in order without duplicates.
	var walked []string
	cursor := ""
	for i := 0; i < 10; i++ {
		p, err := f.svc.ListDocuments(f.ctx, Human(tn.aclOwner.ID), tn.wsA, ListDocumentsInput{
			SharedByMe: true,
			Limit:      2,
			Cursor:     cursor,
		})
		if err != nil {
			t.Fatalf("SharedByMe cursor page %d: %v", i, err)
		}
		walked = append(walked, listIDs(p)...)
		if p.NextCursor == "" {
			break
		}
		cursor = p.NextCursor
	}
	if len(walked) != len(wantOrder) {
		t.Fatalf("SharedByMe cursor walk = %v, want %v", walked, wantOrder)
	}
	for i, wantID := range wantOrder {
		if walked[i] != wantID {
			t.Fatalf("SharedByMe cursor walk[%d] = %s, want %s", i, walked[i], wantID)
		}
	}

	// SharedByMe=true with ParentID returns 400 invalid_filter.
	emptyParent := ""
	for _, parent := range []*string{&emptyParent, &userShared.ID} {
		_, err := f.svc.ListDocuments(f.ctx, Human(tn.aclOwner.ID), tn.wsA, ListDocumentsInput{
			SharedByMe: true,
			ParentID:   parent,
		})
		var ce CodedError
		if err == nil || !errors.As(err, &ce) || ce.Status != 400 || ce.Code != "invalid_filter" {
			t.Fatalf("SharedByMe with ParentID=%q: err=%v, want 400 invalid_filter", *parent, err)
		}
	}
}
