package service

import (
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DOC5-A03 (UNI-1628), list / feed / search half: a workspace admin still
// lists a restricted document (see_all) but the row carries level none +
// AdminScope (view via break_glass with a live grant, the share's level with
// a share), a search never returns its snippet and never matches a keyword
// only its body holds, and the change feed does not count it readable.
func TestAdminScopeCannotReadRestrictedList(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "doc5list")
	admin := Human(tn.wsAdmin.ID)

	docR := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	docW := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	for _, d := range []db.Document{docR, docW} {
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET title = 'Quarterly zeta', content_text = 'secret body xylophone',
			search_text = 'quarterly zeta secret body xylophone' WHERE id = $1`, d.ID); err != nil {
			t.Fatal(err)
		}
	}

	rowOf := func(t *testing.T, actor Actor, in ListDocumentsInput, id string) (DocumentListItem, bool) {
		t.Helper()
		page, err := f.svc.ListDocuments(f.ctx, actor, tn.wsA, in)
		if err != nil {
			t.Fatal(err)
		}
		for _, it := range page.Items {
			if it.Document.ID == id {
				return it, true
			}
		}
		return DocumentListItem{}, false
	}

	// Flat list and tree level: the row is there, locked.
	root := ""
	for _, in := range []ListDocumentsInput{{}, {ParentID: &root}} {
		it, ok := rowOf(t, admin, in, docR.ID)
		if !ok || it.Access.Level != DocumentLevelNone || !it.Access.AdminScope {
			t.Fatalf("admin list row (%+v) = %+v, found %v; want level none + AdminScope", in, it.Access, ok)
		}
		it, ok = rowOf(t, admin, in, docW.ID)
		if !ok || it.Access.Level != DocumentLevelManage || it.Access.AdminScope {
			t.Fatalf("admin workspace row = %+v; want manage", it.Access)
		}
	}

	// Search: a body-only keyword finds the workspace document (with its
	// snippet) but not the restricted one; a title keyword finds the
	// restricted one with an empty snippet.
	if _, ok := rowOf(t, admin, ListDocumentsInput{Query: "xylophone"}, docR.ID); ok {
		t.Fatal("admin body-keyword search matched the restricted document")
	}
	it, ok := rowOf(t, admin, ListDocumentsInput{Query: "xylophone"}, docW.ID)
	if !ok || it.Snippet == "" {
		t.Fatalf("admin body-keyword search on the workspace doc = %+v, %v; want a snippet", it, ok)
	}
	it, ok = rowOf(t, admin, ListDocumentsInput{Query: "zeta"}, docR.ID)
	if !ok || it.Snippet != "" || !it.Access.AdminScope {
		t.Fatalf("admin title search on restricted = snippet %q access %+v found %v; want empty snippet", it.Snippet, it.Access, ok)
	}
	// The ACL owner reads it: snippet and body match.
	it, ok = rowOf(t, Human(tn.aclOwner.ID), ListDocumentsInput{Query: "xylophone"}, docR.ID)
	if !ok || it.Snippet == "" {
		t.Fatalf("ACL owner body search = %+v, %v; want a snippet", it, ok)
	}

	// The change feed level: none for the locked row, readable for the other.
	scope, err := f.svc.documentListScope(f.ctx, admin, tn.wsA)
	if err != nil {
		t.Fatal(err)
	}
	if lvl := feedRowLevel(scope, docR, nil); lvl != DocumentLevelNone {
		t.Fatalf("feedRowLevel(restricted) = %q, want none", lvl)
	}
	if lvl := feedRowLevel(scope, docW, nil); lvl != DocumentLevelManage {
		t.Fatalf("feedRowLevel(workspace) = %q, want manage", lvl)
	}

	// A live break-glass grant: view via break_glass, the body matches and
	// the snippet comes back.
	f.breakGlass(t, tn, docR.ID, tn.wsAdmin.ID, time.Now().Add(time.Hour), false)
	it, ok = rowOf(t, admin, ListDocumentsInput{}, docR.ID)
	if !ok || it.Access.Level != DocumentLevelView || it.Access.Via != DocumentViaBreakGlass || !it.Access.AdminScope {
		t.Fatalf("admin row with grant = %+v; want view via break_glass + AdminScope", it.Access)
	}
	it, ok = rowOf(t, admin, ListDocumentsInput{Query: "xylophone"}, docR.ID)
	if !ok || it.Snippet == "" {
		t.Fatalf("admin body search with grant = %+v, %v; want match + snippet", it, ok)
	}
	// The grant is the admin's own: the org owner still sees a locked row.
	it, ok = rowOf(t, Human(tn.owner.ID), ListDocumentsInput{}, docR.ID)
	if !ok || it.Access.Level != DocumentLevelNone || !it.Access.AdminScope {
		t.Fatalf("org owner row = %+v; want level none + AdminScope", it.Access)
	}
	// A comment share gives the org owner its level, and a readable search.
	f.share(t, docR, DocumentPrincipalUser, tn.owner.ID, DocumentLevelComment, tn.aclOwner.ID)
	it, ok = rowOf(t, Human(tn.owner.ID), ListDocumentsInput{Query: "xylophone"}, docR.ID)
	if !ok || it.Snippet == "" || it.Access.Level != DocumentLevelComment || !it.Access.AdminScope {
		t.Fatalf("org owner with share = %+v snippet %q found %v; want comment + snippet", it.Access, it.Snippet, ok)
	}
}

// listRowAccess's DOC-05 rows without a database.
func TestListRowAccessAdminScope(t *testing.T) {
	restricted := db.Document{ID: "r", OrganizationID: "org", Visibility: documentVisibilityRestricted}
	mine := restricted
	mine.AclOwnerID = nullText("me")
	admin := documentListScope{organizationID: "org", actorID: "me", seeAll: true, allowShares: true}
	viewShare := []db.ListLiveSharesForDocumentsRow{{PrincipalType: "user", PrincipalID: "me", Level: "view"}}
	for _, c := range []struct {
		name       string
		doc        db.Document
		shares     []db.ListLiveSharesForDocumentsRow
		breakGlass bool
		want       DocumentAccess
	}{
		{"locked", restricted, nil, false, DocumentAccess{AdminScope: true}},
		{"break-glass", restricted, nil, true, DocumentAccess{Level: DocumentLevelView, Via: DocumentViaBreakGlass, AdminScope: true}},
		{"share wins over break-glass", restricted, viewShare, true, DocumentAccess{Level: DocumentLevelView, Via: DocumentViaShare, AdminScope: true}},
		{"ACL owner manages", mine, nil, false, DocumentAccess{Level: DocumentLevelManage, Via: DocumentViaMember}},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := listRowAccess(admin, false, c.doc, c.shares, c.breakGlass); got != c.want {
				t.Fatalf("listRowAccess = %+v, want %+v", got, c.want)
			}
		})
	}
}
