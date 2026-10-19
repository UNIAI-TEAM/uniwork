package service

import "testing"

// UNI-1973: Shared by me shows only the topmost shared item. A row whose
// sharing is just the workspace visibility copied from its parent at create
// time is hidden when that parent is a live row of the same owner shared the
// same way; anything with its own share, its own level, or an unshared parent
// still shows.
func TestSharedByMeShowsOnlyTheTopmostSharedItem(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "sbmtop")
	member := Human(tn.member.ID)

	mk := func(title, kind, parent, visibility string) string {
		return f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: visibility, aclOwner: tn.member.ID, createdBy: tn.member.ID,
			title: title, kind: kind, parent: parent,
		}).ID
	}

	top := mk("goc", DocumentKindFolder, "", "workspace")
	inheritedPage := mk("trang-ke-thua", "", top, "workspace")
	inheritedSub := mk("thu-muc-con", DocumentKindFolder, top, "workspace")
	grandchild := mk("chau", "", inheritedSub, "workspace")
	sharedChild := mk("con-chia-se", "", top, "workspace")
	f.share(t, f.listFilterReload(t, sharedChild), DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.member.ID)
	leveledChild := mk("con-doi-quyen", "", top, "workspace")
	f.listFilterSetLevel(t, leveledChild, "view")

	restricted := mk("rieng", DocumentKindFolder, "", "restricted")
	movedIn := mk("chuyen-vao", "", restricted, "workspace")

	list := func(in ListDocumentsInput) (DocumentListPage, error) {
		return f.svc.ListDocuments(f.ctx, member, tn.wsA, in)
	}
	got := listFilterIDs(listFilterWalk(t, list, ListDocumentsInput{SharedByMe: true, Limit: 100}))
	listFilterSameSet(t, "shared_by_me top", got, []string{top, sharedChild, leveledChild, movedIn})
	for _, hidden := range []string{inheritedPage, inheritedSub, grandchild} {
		if containsID(got, hidden) {
			t.Fatalf("shared_by_me listed inherited row %s in %v", hidden, got)
		}
	}
}
