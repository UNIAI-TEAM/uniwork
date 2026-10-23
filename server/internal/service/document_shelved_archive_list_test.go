package service

// ARCHIVE-01 (UNI-1845) SH-5, shelf half: GET .../documents?shelved=true pages
// the shelved rows a caller can view (not only managers), keyset
// shelved_at DESC, id DESC, combinable with the LISTFILTER format/access pair;
// shelved together with archived is 400 invalid_filter, and a
// trashed-and-shelved row shows only in the trash.

import (
	"testing"
	"time"
)

func TestShelvedDocumentArchiveList(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "sharch")
	owner := Human(tn.owner.ID)
	member := Human(tn.member.ID)

	base := time.Now().Add(-time.Hour)

	t.Run("SH-5: the shelf lists what each caller can view, newest shelved first", func(t *testing.T) {
		wsDoc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Workspace sống"})
		hidden := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Hạn chế giấu"})
		sharedDoc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Hạn chế chia sẻ"})
		f.share(t, sharedDoc, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
		// shelve order: sharedDoc newest, wsDoc middle, hidden oldest.
		shelveAt(t, f, hidden.ID, tn.aclOwner.ID, base)
		shelveAt(t, f, wsDoc.ID, tn.owner.ID, base.Add(time.Minute))
		shelveAt(t, f, sharedDoc.ID, tn.aclOwner.ID, base.Add(2*time.Minute))

		ownerPage := listFilterPages(t, f, owner, tn.wsA, ListDocumentsInput{Shelved: true})
		if ids := listFilterIDs(ownerPage); len(ids) != 3 || ids[0] != sharedDoc.ID || ids[1] != wsDoc.ID || ids[2] != hidden.ID {
			t.Fatalf("owner shelf order = %v, want [shared ws hidden]", ids)
		}

		// A plain member sees the workspace row and the row shared with them,
		// never the restricted row they hold nothing on - the shelf is for
		// every viewer, not only managers.
		memberPage := listFilterPages(t, f, member, tn.wsA, ListDocumentsInput{Shelved: true})
		if got := listFilterIDs(memberPage); len(got) != 2 || got[0] != sharedDoc.ID || got[1] != wsDoc.ID {
			t.Fatalf("member shelf = %v, want [shared ws]", got)
		}

		// A non-member of the workspace still sees the shelved row shared with
		// them (the share legs answer without a membership row).
		outPage := listFilterPages(t, f, Human(tn.outsider.ID), tn.wsA, ListDocumentsInput{Shelved: true})
		if got := listFilterIDs(outPage); len(got) != 0 {
			t.Fatalf("outsider shelf = %v, want empty (no share)", got)
		}
		f.share(t, hidden, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
		outPage = listFilterPages(t, f, Human(tn.outsider.ID), tn.wsA, ListDocumentsInput{Shelved: true})
		if got := listFilterIDs(outPage); len(got) != 1 || got[0] != hidden.ID {
			t.Fatalf("outsider shelf after share = %v, want [hidden]", got)
		}
	})

	t.Run("SH-5: shelved+archived is 400 invalid_filter", func(t *testing.T) {
		_, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Shelved: true, Archived: true})
		if err == nil || !codedIs(err, "invalid_filter") {
			t.Fatalf("shelved+archived = %v, want 400 invalid_filter", err)
		}
	})

	t.Run("SH-5: a trashed-and-shelved row shows only in the trash", func(t *testing.T) {
		both := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Vừa lưu vừa xóa"})
		shelveAt(t, f, both.ID, tn.owner.ID, base.Add(3*time.Minute))
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE documents SET archived_at = now(), archived_by = $2, purge_after = now() + interval '30 days' WHERE id = $1`,
			both.ID, tn.owner.ID); err != nil {
			t.Fatal(err)
		}

		shelf := listFilterPages(t, f, owner, tn.wsA, ListDocumentsInput{Shelved: true})
		if listDocIDs(shelf)[both.ID] {
			t.Fatalf("shelf contains trashed-and-shelved %s: %v", both.ID, listFilterIDs(shelf))
		}
		trash := listFilterPages(t, f, owner, tn.wsA, ListDocumentsInput{Archived: true})
		if got := listDocIDs(trash); !got[both.ID] {
			t.Fatalf("trash missing trashed-and-shelved %s: %v", both.ID, got)
		}
		for _, it := range trash {
			if it.Document.ID == both.ID && !it.Document.ShelvedAt.Valid {
				t.Fatalf("trash row for %s lost shelved_at (Q-UI3)", both.ID)
			}
		}
	})

	t.Run("SH-5: the shelf takes format and access (LISTFILTER)", func(t *testing.T) {
		ws := f.tenant(t, "sharch-fmt")
		shelfDocx := f.listFilterFile(t, ws, ws.wsA, "Đã lưu.docx", listFilterMimes["docx"])
		shelfXlsx := f.listFilterFile(t, ws, ws.wsA, "Đã lưu.xlsx", listFilterMimes["xlsx"])
		shelfPage := f.treeDoc(t, ws, treeDocSpec{ws: ws.wsA, visibility: "workspace", aclOwner: ws.aclOwner.ID, createdBy: ws.aclOwner.ID, title: "Trang đã lưu"})
		shelveAt(t, f, shelfDocx.ID, ws.owner.ID, base.Add(4*time.Minute))
		shelveAt(t, f, shelfXlsx.ID, ws.owner.ID, base.Add(5*time.Minute))
		shelveAt(t, f, shelfPage.ID, ws.owner.ID, base.Add(6*time.Minute))

		docxOnly := listFilterPages(t, f, Human(ws.owner.ID), ws.wsA, ListDocumentsInput{Shelved: true, Format: "docx"})
		if ids := listFilterIDs(docxOnly); len(ids) != 1 || ids[0] != shelfDocx.ID {
			t.Fatalf("shelf format=docx = %v, want [%s]", ids, shelfDocx.ID)
		}

		// access: a member holds manage on none of them; the ACL owner does.
		memberManage := listFilterPages(t, f, Human(ws.member.ID), ws.wsA, ListDocumentsInput{Shelved: true, Access: DocumentAccessManage})
		if got := listDocIDs(memberManage); len(got) != 0 {
			t.Fatalf("member shelf access=manage = %v, want empty", got)
		}
		aclManage := listFilterPages(t, f, Human(ws.aclOwner.ID), ws.wsA, ListDocumentsInput{Shelved: true, Access: DocumentAccessManage})
		if got := listDocIDs(aclManage); !got[shelfDocx.ID] || !got[shelfXlsx.ID] || !got[shelfPage.ID] {
			t.Fatalf("aclOwner shelf access=manage = %v, want all three", got)
		}

		// restricted: the member sees only a restricted shelved row shared to
		// them.
		f.listFilterRestrict(t, shelfXlsx.ID)
		restrictedOnly := listFilterPages(t, f, Human(ws.member.ID), ws.wsA, ListDocumentsInput{Shelved: true, Access: DocumentAccessRestricted})
		if got := listDocIDs(restrictedOnly); len(got) != 0 {
			t.Fatalf("member shelf access=restricted before share = %v, want empty", got)
		}
		f.share(t, shelfXlsx, DocumentPrincipalUser, ws.member.ID, DocumentLevelView, ws.aclOwner.ID)
		restrictedOnly = listFilterPages(t, f, Human(ws.member.ID), ws.wsA, ListDocumentsInput{Shelved: true, Access: DocumentAccessRestricted})
		if got := listFilterIDs(restrictedOnly); len(got) != 1 || got[0] != shelfXlsx.ID {
			t.Fatalf("member shelf access=restricted after share = %v, want [%s]", got, shelfXlsx.ID)
		}
	})

	t.Run("SH-5: the shelf keysets by shelved_at across pages", func(t *testing.T) {
		ws := f.tenant(t, "sharch-page")
		var want []string
		for i := 3; i >= 1; i-- {
			d := f.treeDoc(t, ws, treeDocSpec{ws: ws.wsA, visibility: "workspace", aclOwner: ws.aclOwner.ID, createdBy: ws.aclOwner.ID})
			shelveAt(t, f, d.ID, ws.owner.ID, base.Add(time.Duration(i)*time.Minute))
			// newest shelved_at first: the loop shelves newest to oldest.
			want = append(want, d.ID)
		}
		page, err := f.svc.ListDocuments(f.ctx, Human(ws.owner.ID), ws.wsA, ListDocumentsInput{Shelved: true, Limit: 2})
		if err != nil {
			t.Fatal(err)
		}
		if page.NextCursor == "" || len(page.Items) != 2 {
			t.Fatalf("first shelf page = %d items cursor %q, want 2 + cursor", len(page.Items), page.NextCursor)
		}
		got := []string{page.Items[0].Document.ID, page.Items[1].Document.ID}
		rest := listFilterWalk(t, func(in ListDocumentsInput) (DocumentListPage, error) {
			in.Cursor = page.NextCursor
			return f.svc.ListDocuments(f.ctx, Human(ws.owner.ID), ws.wsA, in)
		}, ListDocumentsInput{Shelved: true})
		for _, it := range rest {
			got = append(got, it.Document.ID)
		}
		if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
			t.Fatalf("shelf pages = %v, want %v", got, want)
		}
	})
}
