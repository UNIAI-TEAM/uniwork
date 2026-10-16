package service

// UNI-1868 (LISTFILTER-01): the server-side type and access filters of the
// document lists (contract-listfilter-v0.2.md §1, §2, §5).
//
//	LF-1 each format on the flat list answers exactly the files of that format
//	     plus folders, across a page boundary (51+ rows, page size 50);
//	LF-2 the access predicate agrees with the my_level the same row reports -
//	     owner, share levels, the home row's workspace_level, an AdminScope row
//	     and folders, on one mixed fixture;
//	LF-3 an unknown format/access, format with kind=page, and manage/edit on
//	     the trash are 400 invalid_filter;
//	LF-4 recent, shared-with-me, the trash and shared_by_me take the filters,
//	     and on each the filtered answer is exactly the unfiltered rows whose
//	     own my_level + visibility satisfy it (LF-2's rule per sibling list);
//	LF-5 a file_version_id pointing at a version of another workspace's
//	     document answers no format from that version (the title's extension
//	     still applies).
//
// The mimes below are the wire contract (what an upload stores), written out
// rather than read from the server table so a typo in the table cannot make
// both sides agree on the wrong value.

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var listFilterMimes = map[string]string{
	"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"pdf":  "application/pdf",
	"md":   "text/markdown",
	"html": "text/html",
}

// listFilterFile inserts a file document whose current version carries mime
// ("" leaves the column NULL: the title's extension is then the only answer).
func (f *docPermFixture) listFilterFile(t *testing.T, tn docTenant, ws, title, mime string) db.Document {
	t.Helper()
	d := f.treeDoc(t, tn, treeDocSpec{
		ws: ws, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindFile, title: title,
	})
	versionID := util.NewID()
	version := map[string]any{
		"id": versionID, "organization_id": tn.orgID, "workspace_id": ws,
		"document_id": d.ID, "version": 1, "kind": "file", "reason": "upload",
		"file_id": "file-" + d.ID, "size_bytes": 1024,
		"created_by": d.CreatedBy, "created_by_kind": "human",
	}
	if mime != "" {
		version["mime_type"] = mime
	}
	insertRow(t, f.ctx, f.pool, "document_versions", version)
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE documents SET file_version_id = $1, current_version = 1 WHERE id = $2`,
		versionID, d.ID); err != nil {
		t.Fatal(err)
	}
	return f.listFilterReload(t, d.ID)
}

// listFilterRestrict flips one row to restricted, the shape a careful owner
// shares by hand.
func (f *docPermFixture) listFilterRestrict(t *testing.T, id string) db.Document {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	return f.listFilterReload(t, id)
}

func (f *docPermFixture) listFilterReload(t *testing.T, id string) db.Document {
	t.Helper()
	doc, err := f.q.GetDocumentByID(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

// listFilterSetLevel sets the home row's workspace level (SH-S1).
func (f *docPermFixture) listFilterSetLevel(t *testing.T, id, level string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET workspace_level = $1 WHERE id = $2`, level, id); err != nil {
		t.Fatal(err)
	}
}

// listFilterPages walks one filtered list to its last page, returning the rows
// of every page in order.
func listFilterPages(t *testing.T, f *docPermFixture, actor Actor, ws string, in ListDocumentsInput) []DocumentListItem {
	t.Helper()
	var out []DocumentListItem
	cursor := ""
	for range 25 {
		in.Cursor = cursor
		page, err := f.svc.ListDocuments(f.ctx, actor, ws, in)
		if err != nil {
			t.Fatalf("ListDocuments(%+v): %v", in, err)
		}
		out = append(out, page.Items...)
		if page.NextCursor == "" {
			return out
		}
		cursor = page.NextCursor
	}
	t.Fatalf("ListDocuments(%+v) did not end after 25 pages", in)
	return nil
}

func listFilterIDs(items []DocumentListItem) []string {
	ids := make([]string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.Document.ID)
	}
	return ids
}

func listFilterSameSet(t *testing.T, what string, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: %d rows %v, want %d %v", what, len(got), got, len(want), want)
	}
	for _, id := range want {
		if !containsID(got, id) {
			t.Fatalf("%s: missing %s in %v", what, id, got)
		}
	}
}

func TestDocumentListFormatFilter(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "lf1")
	member := Human(tn.member.ID)

	// 52 docx files cross the 50-row page, so the second page proves the
	// filter holds the cursor's set rather than a full first page.
	var docx []string
	for i := range 52 {
		d := f.listFilterFile(t, tn, tn.wsA, fmt.Sprintf("hop-dong-%02d.docx", i), listFilterMimes["docx"])
		docx = append(docx, d.ID)
	}
	byFormat := map[string]string{}
	for _, format := range []string{"xlsx", "pptx", "pdf", "md", "html"} {
		byFormat[format] = f.listFilterFile(t, tn, tn.wsA, "tep."+format, listFilterMimes[format]).ID
	}
	// The verified bytes win over a title that names another format.
	mislabelled := f.listFilterFile(t, tn, tn.wsA, "bao-cao.docx", listFilterMimes["pdf"])
	// No stored mime and a mime that names no format both answer from the title.
	fallback := f.listFilterFile(t, tn, tn.wsA, "ghi-chu.md", "")
	generic := f.listFilterFile(t, tn, tn.wsA, "bien-ban.html", "application/octet-stream")
	// A page and folders named like a docx are never format matches, and the
	// folders stay in every format's answer.
	page := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "trang.docx",
	})
	folders := make([]string, 0, 3)
	for i := range 3 {
		folders = append(folders, f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindFolder, title: fmt.Sprintf("thu-muc-%d", i),
		}).ID)
	}

	docxWant := append(append([]string{}, docx...), folders...)
	first, err := f.svc.ListDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Format: "docx", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 50 || first.NextCursor == "" {
		t.Fatalf("format=docx page 1 = %d rows next=%q, want a full 50-row page with a cursor", len(first.Items), first.NextCursor)
	}
	second, err := f.svc.ListDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Format: "docx", Limit: 50, Cursor: first.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 5 || second.NextCursor != "" {
		t.Fatalf("format=docx page 2 = %d rows next=%q, want the remaining 5 and no cursor", len(second.Items), second.NextCursor)
	}
	walked := append(listFilterIDs(first.Items), listFilterIDs(second.Items)...)
	listFilterSameSet(t, "format=docx across the page boundary", walked, docxWant)
	for _, it := range append(append([]DocumentListItem{}, first.Items...), second.Items...) {
		if it.Document.Kind == DocumentKindFolder {
			if it.Facts.Format != "" {
				t.Fatalf("folder %s reports format %q, want none", it.Document.ID, it.Facts.Format)
			}
			continue
		}
		if it.Facts.Format != "docx" {
			t.Fatalf("docx row %s reports format %q", it.Document.ID, it.Facts.Format)
		}
	}

	// Each other format answers exactly its own files plus the folders.
	for _, format := range []string{"xlsx", "pptx", "pdf", "md", "html"} {
		want := append([]string{byFormat[format]}, folders...)
		switch format {
		case "pdf":
			want = append(want, mislabelled.ID)
		case "md":
			want = append(want, fallback.ID)
		case "html":
			want = append(want, generic.ID)
		}
		got := listFilterPages(t, f, member, tn.wsA, ListDocumentsInput{Format: format, Limit: 50})
		listFilterSameSet(t, "format="+format, listFilterIDs(got), want)
	}
	// The page named like a docx is in no format's answer.
	for _, format := range []string{"docx", "pdf"} {
		if containsID(listFilterIDs(listFilterPages(t, f, member, tn.wsA, ListDocumentsInput{Format: format})), page.ID) {
			t.Fatalf("format=%s returned the page %s", format, page.ID)
		}
	}
}

// TestDocumentListFormatFilterForeignVersion is BE-LF-1's case: a
// file_version_id pointing at a version of ANOTHER document in another
// workspace of the same organization must not lend that version's MIME to
// the row - not to the format= predicate, not to the format the row reports.
// The title's own extension still answers.
func TestDocumentListFormatFilterForeignVersion(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "lf5")
	member := Human(tn.member.ID)

	// A pdf version of a document in wsB - foreign to the row below on both
	// halves the join now adds: workspace_id and document_id.
	foreign := f.listFilterFile(t, tn, tn.wsB, "ngoai.pdf", listFilterMimes["pdf"])
	poisoned := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindFile, title: "tam-lai.md",
	})
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE documents SET file_version_id = $1, current_version = 1 WHERE id = $2`,
		foreign.FileVersionID.String, poisoned.ID); err != nil {
		t.Fatal(err)
	}

	// format= on the foreign version's MIME does not match the row...
	for _, it := range listFilterPages(t, f, member, tn.wsA, ListDocumentsInput{Format: "pdf", Limit: 100}) {
		if it.Document.ID == poisoned.ID {
			t.Fatalf("format=pdf matched %s through another document's version", poisoned.ID)
		}
	}
	// ...while the title's extension still does.
	found := false
	for _, it := range listFilterPages(t, f, member, tn.wsA, ListDocumentsInput{Format: "md", Limit: 100}) {
		if it.Document.ID != poisoned.ID {
			continue
		}
		found = true
		if it.Facts.Format != "md" {
			t.Fatalf("row reports format %q, want the title's md", it.Facts.Format)
		}
	}
	if !found {
		t.Fatalf("format=md lost the row %s whose title names md", poisoned.ID)
	}
	// The reported format answers the title too - never the foreign MIME.
	for _, it := range listFilterPages(t, f, member, tn.wsA, ListDocumentsInput{Limit: 100}) {
		if it.Document.ID == poisoned.ID && it.Facts.Format != "md" {
			t.Fatalf("unfiltered row reports format %q, want md from the title", it.Facts.Format)
		}
	}
}

// accessMatchesFilter is the client rule the filter must reproduce
// (views/documents/library-rows.ts matchesAccess) read off the row's own
// my_level: manage is exactly manage, edit accepts edit or manage, and
// restricted is the row's visibility.
func accessMatchesFilter(level DocumentLevel, visibility, filter string) bool {
	switch filter {
	case "manage":
		return level == DocumentLevelManage
	case "edit":
		return level == DocumentLevelEdit || level == DocumentLevelManage
	case "restricted":
		return visibility == documentVisibilityRestricted
	default:
		return true
	}
}

func TestDocumentListAccessFilterMatchesMyLevel(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "lf2")
	open := func(title, visibility, level string) db.Document {
		d := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: visibility, aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: title,
		})
		if level != "" {
			f.listFilterSetLevel(t, d.ID, level)
		}
		return d
	}
	// The mixed fixture: every leg my_level resolves, all in the one
	// workspace the flat list is scoped to.
	homeEdit := open("nhap-viec", "workspace", "edit")
	homeView := open("chi-xem", "workspace", "view")
	homeComment := open("binh-luan", "workspace", "comment")
	restrictedOwned := open("rieng-cua-acl", "restricted", "")
	restrictedShared := open("rieng-duoc-chia-se", "restricted", "")
	f.share(t, restrictedShared, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)
	orgShared := open("chia-cho-to-chuc", "restricted", "")
	f.share(t, orgShared, DocumentPrincipalOrganization, tn.orgID, DocumentLevelComment, tn.aclOwner.ID)
	locked := open("khoa-admin-scope", "restricted", "")
	f.breakGlass(t, tn, locked.ID, tn.wsAdmin.ID, time.Now().Add(time.Hour), false)
	// A restricted folder the member only views through a share: it drops out
	// under manage and edit like any other row.
	folder := f.listFilterRestrict(t, f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindFolder, title: "thu-muc-rieng",
	}).ID)
	f.share(t, folder, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
	// A workspace-principal share: it reaches the member of that workspace,
	// who is not a member of this one.
	wsShare := open("chia-cho-workspace", "workspace", "")
	f.share(t, wsShare, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelManage, tn.owner.ID)

	actors := []struct {
		name  string
		actor Actor
	}{
		{"org owner", Human(tn.owner.ID)},
		{"org admin", Human(tn.orgAdmin.ID)},
		{"ws admin", Human(tn.wsAdmin.ID)},
		{"acl owner", Human(tn.aclOwner.ID)},
		{"member", Human(tn.member.ID)},
		{"outsider", Human(tn.outsider.ID)},
		{"member of the share's workspace", Human(tn.bMember.ID)},
		{"agent", agentActor(tn.agent)},
	}
	for _, a := range actors {
		all := listFilterPages(t, f, a.actor, tn.wsA, ListDocumentsInput{Limit: 100})
		if len(all) == 0 {
			t.Fatalf("%s: the unfiltered list is empty; the fixture is not visible to this actor", a.name)
		}
		for _, filter := range []string{"manage", "edit", "restricted"} {
			want := make([]string, 0, len(all))
			for _, it := range all {
				if accessMatchesFilter(it.Access.Level, it.Document.Visibility, filter) {
					want = append(want, it.Document.ID)
				}
			}
			got := listFilterPages(t, f, a.actor, tn.wsA, ListDocumentsInput{Access: filter, Limit: 100})
			listFilterSameSet(t, a.name+" access="+filter, listFilterIDs(got), want)
			// The filter never changes the level the row reports.
			for _, it := range got {
				if !accessMatchesFilter(it.Access.Level, it.Document.Visibility, filter) {
					t.Fatalf("%s access=%s returned %s with my_level %q visibility %q",
						a.name, filter, it.Document.ID, it.Access.Level, it.Document.Visibility)
				}
			}
		}
		edit := listFilterIDs(listFilterPages(t, f, a.actor, tn.wsA, ListDocumentsInput{Access: "edit", Limit: 100}))
		if a.name == "member" {
			// Home rows answer by their own level: the edit and the
			// workspace-shared rows are in, the view and comment rows are
			// out (a comment is below edit), and no leg gives the member
			// manage.
			for _, in := range []db.Document{homeEdit, restrictedShared, wsShare} {
				if !containsID(edit, in.ID) {
					t.Fatalf("member access=edit missing %s: %v", in.ID, edit)
				}
			}
			for _, out := range []db.Document{homeView, homeComment, restrictedOwned, orgShared, locked, folder} {
				if containsID(edit, out.ID) {
					t.Fatalf("member access=edit returned %s: %v", out.ID, edit)
				}
			}
			manage := listFilterIDs(listFilterPages(t, f, a.actor, tn.wsA, ListDocumentsInput{Access: "manage", Limit: 100}))
			if len(manage) != 0 {
				t.Fatalf("member access=manage returned %v, want none", manage)
			}
			restricted := listFilterIDs(listFilterPages(t, f, a.actor, tn.wsA, ListDocumentsInput{Access: "restricted", Limit: 100}))
			listFilterSameSet(t, "member access=restricted", restricted,
				[]string{restrictedShared.ID, orgShared.ID, folder.ID})
		}
		if a.name == "ws admin" {
			// A workspace admin sees a restricted row they do not own without
			// holding a level on it (AdminScope): not manage, only the level
			// a live share or a break-glass grant gives.
			manage := listFilterIDs(listFilterPages(t, f, a.actor, tn.wsA, ListDocumentsInput{Access: "manage", Limit: 100}))
			for _, want := range []db.Document{homeEdit, homeView, homeComment, wsShare} {
				if !containsID(manage, want.ID) {
					t.Fatalf("ws admin access=manage missing %s: %v", want.ID, manage)
				}
			}
			for _, out := range []db.Document{restrictedOwned, locked, folder} {
				if containsID(manage, out.ID) {
					t.Fatalf("ws admin access=manage returned the AdminScope row %s: %v", out.ID, manage)
				}
			}
			if containsID(edit, locked.ID) {
				t.Fatalf("ws admin access=edit returned the break-glass row %s, whose level is view: %v", locked.ID, edit)
			}
		}
		if a.name == "acl owner" {
			manage := listFilterIDs(listFilterPages(t, f, a.actor, tn.wsA, ListDocumentsInput{Access: "manage", Limit: 100}))
			for _, want := range []db.Document{restrictedOwned, restrictedShared, orgShared, locked, folder} {
				if !containsID(manage, want.ID) {
					t.Fatalf("acl owner access=manage missing the row it owns %s: %v", want.ID, manage)
				}
			}
		}
		if a.name == "agent" {
			// An agent reads view on every workspace-visible row, so neither
			// manage nor edit answers anything, and a restricted row is not
			// even visible.
			for _, filter := range []string{"manage", "edit", "restricted"} {
				ids := listFilterIDs(listFilterPages(t, f, a.actor, tn.wsA, ListDocumentsInput{Access: filter, Limit: 100}))
				if len(ids) != 0 {
					t.Fatalf("agent access=%s returned %v, want none", filter, ids)
				}
			}
		}
	}
}

func TestDocumentListFilterValidation(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "lf3")
	member := Human(tn.member.ID)

	badFilter := func(name string, err error) {
		t.Helper()
		var ce CodedError
		if err == nil || !errors.As(err, &ce) || ce.Status != 400 || ce.Code != "invalid_filter" {
			t.Fatalf("%s: err=%v, want 400 invalid_filter", name, err)
		}
	}

	for _, c := range []struct {
		name string
		in   ListDocumentsInput
	}{
		{"unknown format", ListDocumentsInput{Format: "exe"}},
		{"page as a format", ListDocumentsInput{Format: "page"}},
		{"format with kind=page", ListDocumentsInput{Format: "docx", Kind: DocumentKindPage}},
		{"unknown access", ListDocumentsInput{Access: "view"}},
		{"blank access", ListDocumentsInput{Access: " "}},
		{"access=manage on the trash", ListDocumentsInput{Access: "manage", Archived: true}},
		{"access=edit on the trash", ListDocumentsInput{Access: "edit", Archived: true}},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := f.svc.ListDocuments(f.ctx, member, tn.wsA, c.in)
			badFilter(c.name, err)
		})
	}
	// The same strictness answers the other two routes.
	t.Run("recent", func(t *testing.T) {
		_, err := f.svc.ListRecentDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Format: "exe"})
		badFilter("recent unknown format", err)
		_, err = f.svc.ListRecentDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Access: "owner"})
		badFilter("recent unknown access", err)
	})
	t.Run("shared-with-me", func(t *testing.T) {
		_, err := f.svc.ListSharedWithMe(f.ctx, tn.member.ID, tn.orgID, SharedWithMeQuery{Format: "exe"})
		badFilter("shared-with-me unknown format", err)
		_, err = f.svc.ListSharedWithMe(f.ctx, tn.member.ID, tn.orgID, SharedWithMeQuery{Access: "nope"})
		badFilter("shared-with-me unknown access", err)
	})

	// Accepted: the trash takes format and access=restricted only, the folder
	// view takes a format, and shared_by_me takes both filters.
	t.Run("accepted", func(t *testing.T) {
		for _, in := range []ListDocumentsInput{
			{Format: "pdf"},
			{Format: "docx", Kind: DocumentKindFolder},
			{Access: "restricted"},
			{Format: "md", Archived: true},
			{Access: "restricted", Archived: true},
			{Access: "manage", SharedByMe: true},
			{Format: "pdf", SharedByMe: true},
		} {
			if _, err := f.svc.ListDocuments(f.ctx, member, tn.wsA, in); err != nil {
				t.Fatalf("ListDocuments(%+v): %v", in, err)
			}
		}
	})
}

func TestDocumentListFiltersOnEveryList(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "lf4")
	member := Human(tn.member.ID)

	// Recent: the member last edited both. Neither is one the member owns, so
	// the shared-by-me list below stays its own two rows.
	recentPDF := f.listFilterFile(t, tn, tn.wsA, "bien-ban.pdf", listFilterMimes["pdf"])
	recentPage := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "ghi-chu-gan-day",
	})
	for _, id := range []string{recentPDF.ID, recentPage.ID} {
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET updated_by = $1 WHERE id = $2`, tn.member.ID, id); err != nil {
			t.Fatal(err)
		}
	}

	// Shared by me: the member owns both and shared them.
	byMePDF := f.listFilterFile(t, tn, tn.wsA, "cua-toi.pdf", listFilterMimes["pdf"])
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET acl_owner_id = $1 WHERE id = $2`, tn.member.ID, byMePDF.ID); err != nil {
		t.Fatal(err)
	}
	f.share(t, byMePDF, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.member.ID)
	// Updated by someone else, so it never enters the member's recent list.
	byMePage := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.aclOwner.ID, title: "cua-toi-page",
	})

	// Shared with me: restricted rows of another workspace reaching the member
	// through a share (a workspace-visible row of the member's own workspace
	// answers via=member and never enters this list).
	sharedMD := f.listFilterRestrict(t, f.listFilterFile(t, tn, tn.wsB, "chia-se.md", listFilterMimes["md"]).ID)
	f.share(t, sharedMD, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.owner.ID)
	sharedPage := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsB, visibility: "restricted", aclOwner: tn.owner.ID, createdBy: tn.owner.ID, title: "chia-se-page",
	})
	f.share(t, sharedPage, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.owner.ID)

	recent, err := f.svc.ListRecentDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Format: "pdf", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	listFilterSameSet(t, "recent format=pdf", listIDs(recent), []string{recentPDF.ID})
	recent, err = f.svc.ListRecentDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Access: "restricted", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(recent.Items) != 0 {
		t.Fatalf("recent access=restricted = %v, want none", listIDs(recent))
	}
	recent, err = f.svc.ListRecentDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{Access: "edit", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	listFilterSameSet(t, "recent access=edit", listIDs(recent), []string{recentPDF.ID, recentPage.ID})

	byMe, err := f.svc.ListDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{SharedByMe: true, Format: "pdf", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	listFilterSameSet(t, "shared_by_me format=pdf", listIDs(byMe), []string{byMePDF.ID})
	byMe, err = f.svc.ListDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{SharedByMe: true, Access: "manage", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	listFilterSameSet(t, "shared_by_me access=manage", listIDs(byMe), []string{byMePDF.ID, byMePage.ID})
	byMe, err = f.svc.ListDocuments(f.ctx, member, tn.wsA, ListDocumentsInput{SharedByMe: true, Access: "restricted", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(byMe.Items) != 0 {
		t.Fatalf("shared_by_me access=restricted = %v, want none", listIDs(byMe))
	}

	shared := func(in SharedWithMeQuery) []string {
		t.Helper()
		page, err := f.svc.ListSharedWithMe(f.ctx, tn.member.ID, tn.orgID, in)
		if err != nil {
			t.Fatalf("ListSharedWithMe(%+v): %v", in, err)
		}
		ids := make([]string, 0, len(page.Items))
		for _, it := range page.Items {
			ids = append(ids, it.Document.ID)
		}
		return ids
	}
	listFilterSameSet(t, "shared-with-me format=md", shared(SharedWithMeQuery{Format: "md", Limit: 50}), []string{sharedMD.ID})
	listFilterSameSet(t, "shared-with-me access=edit", shared(SharedWithMeQuery{Access: "edit", Limit: 50}), []string{sharedMD.ID})
	listFilterSameSet(t, "shared-with-me access=restricted", shared(SharedWithMeQuery{Access: "restricted", Limit: 50}),
		[]string{sharedMD.ID, sharedPage.ID})

	// Trash: archived rows are manage-only, so it takes format and
	// access=restricted only.
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE documents SET archived_at = now(), purge_after = now() + interval '30 days' WHERE id = $1`, recentPDF.ID); err != nil {
		t.Fatal(err)
	}
	owner := Human(tn.owner.ID)
	trash, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Archived: true, Format: "pdf", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	listFilterSameSet(t, "trash format=pdf", listIDs(trash), []string{recentPDF.ID})
	trash, err = f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Archived: true, Access: "restricted", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(trash.Items) != 0 {
		t.Fatalf("trash access=restricted = %v, want none", listIDs(trash))
	}
	trash, err = f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Archived: true, Format: "md", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(trash.Items) != 0 {
		t.Fatalf("trash format=md = %v, want none", listIDs(trash))
	}
}
