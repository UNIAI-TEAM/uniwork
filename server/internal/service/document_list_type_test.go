package service

// UNI-2113 (contract A): the repeated ?type= filter of the document lists.
//
//	TY-1 resolveListFilters turns the values into a page flag, the file formats
//	     and the MIME each verified upload of them carries; an unknown, empty or
//	     differently-cased value is 400 invalid_type (no database);
//	TY-2 the flat list answers one type, two formats (OR), page + format (OR),
//	     and no type keeps today's answer; type narrows next to kind=/format=
//	     (AND), it never widens them;
//	TY-3 every list the filter reaches (tree level, recent, favorites, shared by
//	     me, shared with me, shelf, trash) honours it, and a row the caller
//	     cannot read never appears whatever the type.

import (
	"errors"
	"net/http"
	"testing"
)

func TestResolveListFiltersTypes(t *testing.T) {
	t.Run("no type is no constraint", func(t *testing.T) {
		got, err := resolveListFilters("", "", "", false, nil)
		if err != nil {
			t.Fatal(err)
		}
		if got.typePage || len(got.typeFormats) != 0 || len(got.typeMimes) != 0 {
			t.Fatalf("no type resolved to %+v, want the zero constraint", got)
		}
		// pgx writes a nil slice as NULL, which cardinality() reads as NULL: the
		// resolved lists are always non-nil.
		if got.typeFormats == nil || got.typeMimes == nil {
			t.Fatalf("typeFormats=%#v typeMimes=%#v, want non-nil empty slices", got.typeFormats, got.typeMimes)
		}
	})

	t.Run("formats resolve to their MIMEs in order", func(t *testing.T) {
		got, err := resolveListFilters("", "", "", false, []string{"xlsx", "docx"})
		if err != nil {
			t.Fatal(err)
		}
		if got.typePage {
			t.Fatal("two formats set the page leg")
		}
		if len(got.typeFormats) != 2 || got.typeFormats[0] != "xlsx" || got.typeFormats[1] != "docx" {
			t.Fatalf("typeFormats = %v, want [xlsx docx]", got.typeFormats)
		}
		if len(got.typeMimes) != 2 ||
			got.typeMimes[0] != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
			got.typeMimes[1] != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
			t.Fatalf("typeMimes = %v", got.typeMimes)
		}
	})

	t.Run("page is its own leg and a repeat is one value", func(t *testing.T) {
		got, err := resolveListFilters("", "", "", false, []string{"page", "pdf", "pdf", "page"})
		if err != nil {
			t.Fatal(err)
		}
		if !got.typePage {
			t.Fatal("page did not set the page leg")
		}
		if len(got.typeFormats) != 1 || got.typeFormats[0] != "pdf" || len(got.typeMimes) != 1 || got.typeMimes[0] != "application/pdf" {
			t.Fatalf("formats %v mimes %v, want pdf once", got.typeFormats, got.typeMimes)
		}
		only, err := resolveListFilters("", "", "", false, []string{"page"})
		if err != nil {
			t.Fatal(err)
		}
		if !only.typePage || len(only.typeFormats) != 0 {
			t.Fatalf("page alone resolved to %+v", only)
		}
	})

	for _, bad := range [][]string{
		{"bogus"}, {""}, {"DOCX"}, {"doc"}, {"folder"}, {"file"}, {"docx", ""}, {"page", "rtf"},
	} {
		_, err := resolveListFilters("", "", "", false, bad)
		var ce CodedError
		if !errors.As(err, &ce) || ce.Status != http.StatusBadRequest || ce.Code != "invalid_type" {
			t.Errorf("types %q: err = %v, want 400 invalid_type", bad, err)
		}
	}

	t.Run("type sits next to format and kind without a 400 of its own", func(t *testing.T) {
		// format with kind=page stays the 400 invalid_filter it has always been;
		// type adds no new refusal beside kind or format.
		if _, err := resolveListFilters("pdf", "", "", false, []string{"docx"}); err != nil {
			t.Fatalf("type with format: %v", err)
		}
		if _, err := resolveListFilters("", "", "page", false, []string{"docx"}); err != nil {
			t.Fatalf("type with kind: %v", err)
		}
		if _, err := resolveListFilters("pdf", "", "page", false, []string{"docx"}); !codedIs(err, "invalid_filter") {
			t.Fatalf("format with kind=page = %v, want the existing invalid_filter", err)
		}
	})
}

func TestDocumentListTypeFilter(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ty1")
	member := Human(tn.member.ID)

	docx := f.listFilterFile(t, tn, tn.wsA, "hop-dong.docx", listFilterMimes["docx"])
	xlsx := f.listFilterFile(t, tn, tn.wsA, "bang-luong.xlsx", listFilterMimes["xlsx"])
	pptx := f.listFilterFile(t, tn, tn.wsA, "thuyet-trinh.pptx", listFilterMimes["pptx"])
	pdf := f.listFilterFile(t, tn, tn.wsA, "bao-cao.pdf", listFilterMimes["pdf"])
	md := f.listFilterFile(t, tn, tn.wsA, "ghi-chu.md", listFilterMimes["md"])
	// The verified bytes win over a title that names another format; no MIME
	// answers from the title (the format filter's own rule).
	mislabelled := f.listFilterFile(t, tn, tn.wsA, "tam-lai.docx", listFilterMimes["pdf"])
	fallback := f.listFilterFile(t, tn, tn.wsA, "bien-ban.xlsx", "")
	page := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "trang.docx",
	})
	folder := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindFolder, title: "thu-muc",
	})
	// Restricted to someone else: never in the member's answer, whatever the type.
	hidden := f.listFilterRestrict(t, f.listFilterFile(t, tn, tn.wsA, "mat.docx", listFilterMimes["docx"]).ID)

	list := func(in ListDocumentsInput) []string {
		t.Helper()
		in.Limit = 100
		return listFilterIDs(listFilterPages(t, f, member, tn.wsA, in))
	}
	// Folders stay in a file-format answer (they are how one reaches files) and
	// out of a page-only answer, exactly as format= and kind=page behave.
	all := list(ListDocumentsInput{})
	listFilterSameSet(t, "no type", list(ListDocumentsInput{Types: nil}), all)
	if containsID(all, hidden.ID) {
		t.Fatalf("the unfiltered list shows the restricted row %s", hidden.ID)
	}

	listFilterSameSet(t, "type=docx", list(ListDocumentsInput{Types: []string{"docx"}}),
		[]string{docx.ID, folder.ID})
	listFilterSameSet(t, "type=xlsx", list(ListDocumentsInput{Types: []string{"xlsx"}}),
		[]string{xlsx.ID, fallback.ID, folder.ID})
	listFilterSameSet(t, "type=pdf", list(ListDocumentsInput{Types: []string{"pdf"}}),
		[]string{pdf.ID, mislabelled.ID, folder.ID})
	listFilterSameSet(t, "type=docx&type=xlsx (OR)", list(ListDocumentsInput{Types: []string{"docx", "xlsx"}}),
		[]string{docx.ID, xlsx.ID, fallback.ID, folder.ID})
	listFilterSameSet(t, "type=page", list(ListDocumentsInput{Types: []string{"page"}}), []string{page.ID})
	listFilterSameSet(t, "type=page&type=pptx (OR)", list(ListDocumentsInput{Types: []string{"page", "pptx"}}),
		[]string{page.ID, pptx.ID, folder.ID})
	listFilterSameSet(t, "type=md&type=md (dedupe)", list(ListDocumentsInput{Types: []string{"md", "md"}}),
		[]string{md.ID, folder.ID})

	// type narrows like any other filter: AND with kind= and format=.
	listFilterSameSet(t, "type=docx&kind=file", list(ListDocumentsInput{Types: []string{"docx"}, Kind: DocumentKindFile}),
		[]string{docx.ID})
	listFilterSameSet(t, "type=docx&type=pdf&format=pdf", list(ListDocumentsInput{Types: []string{"docx", "pdf"}, Format: "pdf"}),
		[]string{pdf.ID, mislabelled.ID, folder.ID})
	listFilterSameSet(t, "type=docx&format=pdf (disjoint)", list(ListDocumentsInput{Types: []string{"docx"}, Format: "pdf"}),
		[]string{folder.ID})
	listFilterSameSet(t, "type=page&kind=file (disjoint)", list(ListDocumentsInput{Types: []string{"page"}, Kind: DocumentKindFile}),
		nil)
	listFilterSameSet(t, "type=page&kind=page", list(ListDocumentsInput{Types: []string{"page"}, Kind: DocumentKindPage}),
		[]string{page.ID})

	for _, bad := range [][]string{{"bogus"}, {""}, {"docx", "nope"}} {
		_, err := f.svc.ListDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Types: bad})
		if !codedIs(err, "invalid_type") {
			t.Errorf("types %q: err = %v, want invalid_type", bad, err)
		}
	}
}

func TestDocumentListTypeFilterEveryList(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ty2")
	member := Human(tn.member.ID)
	owner := Human(tn.owner.ID)

	mk := func(title, mime string) string {
		return f.listFilterFile(t, tn, tn.wsA, title, mime).ID
	}
	page := func(title string) string {
		return f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: title,
		}).ID
	}

	// Tree level: a folder holds one of each.
	folder := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindFolder, title: "cap-cay",
	})
	childDocx := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindFile, title: "con.docx", parent: folder.ID,
	})
	childPDF := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindFile, title: "con.pdf", parent: folder.ID,
	})
	childPage := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		title: "con-trang", parent: folder.ID,
	})
	parent := folder.ID
	byParent := func(types ...string) []string {
		t.Helper()
		return listFilterIDs(listFilterPages(t, f, member, tn.wsA, ListDocumentsInput{ParentID: &parent, Types: types, Limit: 100}))
	}
	listFilterSameSet(t, "tree level type=docx", byParent("docx"), []string{childDocx.ID})
	listFilterSameSet(t, "tree level type=page&type=pdf", byParent("page", "pdf"), []string{childPage.ID, childPDF.ID})

	// Recent: the member's own edits, one of each; one is in someone else's
	// restricted row, never listed.
	recentDocx, recentPDF, recentPage := mk("gan-day.docx", listFilterMimes["docx"]), mk("gan-day.pdf", listFilterMimes["pdf"]), page("gan-day-trang")
	hiddenRecent := f.listFilterRestrict(t, f.listFilterFile(t, tn, tn.wsA, "gan-day-mat.docx", listFilterMimes["docx"]).ID).ID
	for _, id := range []string{recentDocx, recentPDF, recentPage, hiddenRecent} {
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET updated_by = $1 WHERE id = $2`, tn.member.ID, id); err != nil {
			t.Fatal(err)
		}
	}
	recent := func(types ...string) []string {
		t.Helper()
		return listFilterIDs(listFilterWalk(t, func(in ListDocumentsInput) (DocumentListPage, error) {
			return f.svc.ListRecentDocuments(f.ctx, member, tn.wsA, in)
		}, ListDocumentsInput{Types: types, Limit: 100}))
	}
	listFilterSameSet(t, "recent type=docx", recent("docx"), []string{recentDocx})
	listFilterSameSet(t, "recent type=page&type=pdf", recent("page", "pdf"), []string{recentPage, recentPDF})
	if containsID(recent(), hiddenRecent) {
		t.Fatalf("recent shows the restricted row %s", hiddenRecent)
	}

	// Favorites: the member stars one of each; the restricted row is not theirs
	// to star, and a star on a row they lose access to does not list.
	favDocx, favPDF, favPage := mk("sao.docx", listFilterMimes["docx"]), mk("sao.pdf", listFilterMimes["pdf"]), page("sao-trang")
	for _, id := range []string{favDocx, favPDF, favPage} {
		if _, err := f.svc.FavoriteDocument(f.ctx, member, id); err != nil {
			t.Fatal(err)
		}
	}
	favorites := func(types ...string) []string {
		t.Helper()
		return listFilterIDs(listFilterWalk(t, func(in ListDocumentsInput) (DocumentListPage, error) {
			return f.svc.ListFavoriteDocuments(f.ctx, member, tn.wsA, in)
		}, ListDocumentsInput{Types: types, Limit: 100}))
	}
	listFilterSameSet(t, "favorites type=pdf", favorites("pdf"), []string{favPDF})
	listFilterSameSet(t, "favorites type=docx&type=page", favorites("docx", "page"), []string{favDocx, favPage})
	listFilterSameSet(t, "favorites no type", favorites(), []string{favDocx, favPDF, favPage})
	if _, err := f.svc.ListFavoriteDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Types: []string{"bogus"}}); !codedIs(err, "invalid_type") {
		t.Fatalf("favorites bogus type: %v, want invalid_type", err)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, favDocx); err != nil {
		t.Fatal(err)
	}
	listFilterSameSet(t, "favorites after losing access", favorites("docx"), nil)

	// Shared by me: the member owns the rows and shares them.
	byMeDocx, byMePDF := mk("toi-chia.docx", listFilterMimes["docx"]), mk("toi-chia.pdf", listFilterMimes["pdf"])
	for _, id := range []string{byMeDocx, byMePDF} {
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET acl_owner_id = $1 WHERE id = $2`, tn.member.ID, id); err != nil {
			t.Fatal(err)
		}
		d := f.listFilterReload(t, id)
		f.share(t, d, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.member.ID)
	}
	byMe := func(types ...string) []string {
		t.Helper()
		return listFilterIDs(listFilterWalk(t, func(in ListDocumentsInput) (DocumentListPage, error) {
			return f.svc.ListDocuments(f.ctx, member, tn.wsA, in)
		}, ListDocumentsInput{SharedByMe: true, Types: types, Limit: 100}))
	}
	listFilterSameSet(t, "shared_by_me type=docx", byMe("docx"), []string{byMeDocx})
	listFilterSameSet(t, "shared_by_me type=docx&type=pdf", byMe("docx", "pdf"), []string{byMeDocx, byMePDF})

	// Shared with me: rows in workspace B reaching the member through a share.
	shareToMember := func(d string, level DocumentLevel) {
		doc := f.listFilterRestrict(t, d)
		f.share(t, doc, DocumentPrincipalUser, tn.member.ID, level, tn.owner.ID)
	}
	swmDocx := f.listFilterFile(t, tn, tn.wsB, "toi-nhan.docx", listFilterMimes["docx"]).ID
	swmMD := f.listFilterFile(t, tn, tn.wsB, "toi-nhan.md", listFilterMimes["md"]).ID
	swmPage := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsB, visibility: "restricted", aclOwner: tn.owner.ID, createdBy: tn.owner.ID, title: "toi-nhan-trang",
	}).ID
	swmUnshared := f.listFilterRestrict(t, f.listFilterFile(t, tn, tn.wsB, "khong-chia-se.docx", listFilterMimes["docx"]).ID).ID
	shareToMember(swmDocx, DocumentLevelView)
	shareToMember(swmMD, DocumentLevelEdit)
	f.share(t, f.listFilterReload(t, swmPage), DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.owner.ID)
	shared := func(types ...string) []string {
		t.Helper()
		var out []SharedDocument
		in := SharedWithMeQuery{Types: types, Limit: 100}
		for range 25 {
			page, err := f.svc.ListSharedWithMe(f.ctx, tn.member.ID, tn.orgID, in)
			if err != nil {
				t.Fatalf("ListSharedWithMe(%v): %v", types, err)
			}
			out = append(out, page.Items...)
			if page.NextID == "" {
				break
			}
			in.AfterCreatedAt, in.AfterID = page.NextCreatedAt, page.NextID
		}
		ids := make([]string, 0, len(out))
		for _, it := range out {
			ids = append(ids, it.Document.ID)
		}
		return ids
	}
	listFilterSameSet(t, "shared-with-me type=docx", shared("docx"), []string{swmDocx})
	listFilterSameSet(t, "shared-with-me type=md&type=page", shared("md", "page"), []string{swmMD, swmPage})
	listFilterSameSet(t, "shared-with-me no type", shared(), []string{swmDocx, swmMD, swmPage})
	if containsID(shared("docx", "md", "page", "pdf"), swmUnshared) {
		t.Fatalf("shared-with-me shows %s nobody shared with the member", swmUnshared)
	}
	if _, err := f.svc.ListSharedWithMe(f.ctx, tn.member.ID, tn.orgID, SharedWithMeQuery{Types: []string{"bogus"}}); !codedIs(err, "invalid_type") {
		t.Fatalf("shared-with-me bogus type: %v, want invalid_type", err)
	}

	// Shelf and trash take it too (the same list input).
	shelfDocx, shelfPDF := mk("kho.docx", listFilterMimes["docx"]), mk("kho.pdf", listFilterMimes["pdf"])
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE documents SET shelved_at = now(), shelved_by = $2, shelved_by_kind = 'human', shelve_batch_id = $3 WHERE id = ANY($1)`,
		[]string{shelfDocx, shelfPDF}, tn.owner.ID, "batch-ty2"); err != nil {
		t.Fatal(err)
	}
	shelf := listFilterIDs(listFilterWalk(t, func(in ListDocumentsInput) (DocumentListPage, error) {
		return f.svc.ListDocuments(f.ctx, member, tn.wsA, in)
	}, ListDocumentsInput{Shelved: true, Types: []string{"pdf"}, Limit: 100}))
	listFilterSameSet(t, "shelf type=pdf", shelf, []string{shelfPDF})

	trashDocx, trashPDF := mk("rac.docx", listFilterMimes["docx"]), mk("rac.pdf", listFilterMimes["pdf"])
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE documents SET archived_at = now(), purge_after = now() + interval '30 days' WHERE id = ANY($1)`,
		[]string{trashDocx, trashPDF}); err != nil {
		t.Fatal(err)
	}
	trash := func(actor Actor, types ...string) []string {
		t.Helper()
		return listFilterIDs(listFilterWalk(t, func(in ListDocumentsInput) (DocumentListPage, error) {
			return f.svc.ListDocuments(f.ctx, actor, tn.wsA, in)
		}, ListDocumentsInput{Archived: true, Types: types, Limit: 100}))
	}
	listFilterSameSet(t, "trash type=docx", trash(owner, "docx"), []string{trashDocx})
	listFilterSameSet(t, "trash type=docx&type=pdf", trash(owner, "docx", "pdf"), []string{trashDocx, trashPDF})
}
