package service

import (
	"errors"
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-1974: a folder is never shared, only documents are, and a shared
// document is never attached to the owner's folder on the reader's side.
// The cases here are red first: every refusal, the no-inheritance rule, the
// recipient views (list, tree, shared-with-me, favorites, detail), Shared by
// me and the clean-up of folders that were shared before the rule.

type folderOffFixture struct {
	f      *docPermFixture
	tn     docTenant
	owner  Actor // workspace member who owns the folders and documents
	viewer Actor // another workspace member
	admin  Actor // workspace admin
}

func newFolderOffFixture(t *testing.T, slug string) *folderOffFixture {
	t.Helper()
	f := newDocPermFixture(t)
	tn := f.tenant(t, slug)
	return &folderOffFixture{f: f, tn: tn, owner: Human(tn.member.ID), viewer: Human(tn.creator.ID), admin: Human(tn.wsAdmin.ID)}
}

func (x *folderOffFixture) folder(t *testing.T, title, parentID string) db.Document {
	t.Helper()
	v, err := x.f.svc.CreatePage(x.f.ctx, x.owner, x.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: title, ParentID: parentID})
	if err != nil {
		t.Fatalf("folder %q: %v", title, err)
	}
	return v.Document
}

func (x *folderOffFixture) page(t *testing.T, title, parentID, visibility string) db.Document {
	t.Helper()
	v, err := x.f.svc.CreatePage(x.f.ctx, x.owner, x.tn.wsA, CreatePageInput{Title: title, ParentID: parentID, Visibility: visibility})
	if err != nil {
		t.Fatalf("page %q: %v", title, err)
	}
	return v.Document
}

// legacyShare makes a folder look the way it did before the rule: workspace
// visible, as the old create toggle left it.
func (x *folderOffFixture) legacyWorkspace(t *testing.T, id string) {
	t.Helper()
	if _, err := x.f.pool.Exec(x.f.ctx, `UPDATE documents SET visibility = 'workspace', workspace_level = 'view' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
}

func (x *folderOffFixture) legacyShare(t *testing.T, docID, principalType, principalID string) {
	t.Helper()
	if _, err := x.f.q.InsertDocumentShare(x.f.ctx, db.InsertDocumentShareParams{
		ID: util.NewID(), OrganizationID: x.tn.orgID, WorkspaceID: x.tn.wsA, DocumentID: docID,
		PrincipalType: principalType, PrincipalID: principalID, Level: string(DocumentLevelView),
		GrantedBy: x.owner.ID, GrantedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
}

func (x *folderOffFixture) get(t *testing.T, id string) db.Document {
	t.Helper()
	d, err := x.f.q.GetDocumentByID(x.f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func wantFolderNotShareable(t *testing.T, err error, what string) {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "folder_not_shareable" || ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("%s: err = %v, want 422 folder_not_shareable", what, err)
	}
}

func fsoCount(t *testing.T, x *folderOffFixture, query string, args ...any) int {
	t.Helper()
	var n int
	if err := x.f.pool.QueryRow(x.f.ctx, query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestFolderCannotBeSharedOrOpened(t *testing.T) {
	x := newFolderOffFixture(t, "fso1")
	f, ctx := x.f, x.f.ctx
	folder := x.folder(t, "Thư mục riêng", "")

	t.Run("create with workspace visibility is refused and writes nothing", func(t *testing.T) {
		before := fsoCount(t, x, `SELECT count(*) FROM documents WHERE workspace_id = $1 AND kind = 'folder'`, x.tn.wsA)
		_, err := f.svc.CreatePage(ctx, x.owner, x.tn.wsA, CreatePageInput{
			Kind: DocumentKindFolder, Title: "Mở cho workspace", Visibility: documentVisibilityWorkspace,
			IdempotencyKey: util.NewID(),
		})
		wantFolderNotShareable(t, err, "create")
		if after := fsoCount(t, x, `SELECT count(*) FROM documents WHERE workspace_id = $1 AND kind = 'folder'`, x.tn.wsA); after != before {
			t.Fatalf("folders %d -> %d, a refused create wrote a row", before, after)
		}
		if n := fsoCount(t, x, `SELECT count(*) FROM idempotency_keys WHERE workspace_id = $1 AND scope = $2`, x.tn.wsA, idempotencyScopeDocumentPageCreate); n != 0 {
			t.Fatalf("idempotency claim rows = %d, the refusal must come before the claim", n)
		}
		if _, err := f.svc.CreatePage(ctx, x.owner, x.tn.wsA, CreatePageInput{
			Kind: DocumentKindFolder, Title: "Riêng rõ ràng", Visibility: documentVisibilityRestricted,
		}); err != nil {
			t.Fatalf("an explicit restricted folder is fine: %v", err)
		}
	})

	t.Run("patch to workspace is refused behind the access gate", func(t *testing.T) {
		_, err := f.svc.UpdateDocument(ctx, x.owner, folder.ID, UpdateDocumentInput{Revision: folder.Revision, Visibility: strPtr(documentVisibilityWorkspace)})
		wantFolderNotShareable(t, err, "patch")
		_, err = f.svc.UpdateDocument(ctx, Human(x.tn.outsider.ID), folder.ID, UpdateDocumentInput{Revision: folder.Revision, Visibility: strPtr(documentVisibilityWorkspace)})
		if err == nil || codedIs(err, "folder_not_shareable") {
			t.Fatalf("a stranger must not learn the rule from the folder: %v", err)
		}
		if got := x.get(t, folder.ID); got.Visibility != documentVisibilityRestricted {
			t.Fatalf("visibility = %q after refused patches", got.Visibility)
		}
	})

	t.Run("every share command is refused for every principal", func(t *testing.T) {
		for name, in := range map[string]DocumentShareInput{
			"user":      {PrincipalType: DocumentPrincipalUser, PrincipalID: x.viewer.ID, Level: DocumentLevelView},
			"org":       {PrincipalType: DocumentPrincipalOrganization, PrincipalID: x.tn.orgID, Level: DocumentLevelView},
			"workspace": {PrincipalType: DocumentPrincipalWorkspace, PrincipalID: x.tn.wsB, Level: DocumentLevelView},
			"home":      {PrincipalType: DocumentPrincipalWorkspace, PrincipalID: x.tn.wsA, Level: DocumentLevelView},
		} {
			_, err := f.svc.ShareDocument(ctx, x.owner, folder.ID, in)
			wantFolderNotShareable(t, err, "share "+name)
		}
		_, err := f.svc.ShareDocumentBatch(ctx, x.owner, folder.ID, []string{x.viewer.ID}, DocumentLevelView)
		wantFolderNotShareable(t, err, "share batch")
		view := DocumentLevelView
		for _, dry := range []bool{true, false} {
			_, err = f.svc.UpdateDocumentAccess(ctx, x.owner, folder.ID, UpdateDocumentAccessInput{DryRun: dry, Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: x.viewer.ID, Level: &view},
			}})
			wantFolderNotShareable(t, err, "access batch")
		}
		_, err = f.svc.UpdateDocumentAccess(ctx, x.owner, folder.ID, UpdateDocumentAccessInput{Items: []DocumentAccessBatchItem{
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: x.tn.wsA, Level: &view},
		}})
		wantFolderNotShareable(t, err, "access batch home workspace")
		if n := fsoCount(t, x, `SELECT count(*) FROM document_shares WHERE document_id = $1`, folder.ID); n != 0 {
			t.Fatalf("share rows on the folder = %d", n)
		}
	})

	t.Run("a link on a folder keeps its own refusal", func(t *testing.T) {
		_, err := f.svc.CreateDocumentLink(ctx, x.owner, folder.ID, 7)
		if !codedIs(err, "folder_not_supported") {
			t.Fatalf("link on a folder: %v, want folder_not_supported", err)
		}
	})

	t.Run("the home-row writer refuses a folder too", func(t *testing.T) {
		tx, err := f.pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		_, err = writeDocumentHomeRow(ctx, f.q.WithTx(tx), x.owner, x.get(t, folder.ID), documentHomeRowMove{
			Visibility: documentVisibilityWorkspace, WorkspaceLevel: string(DocumentLevelView),
		})
		wantFolderNotShareable(t, err, "home row writer")
	})

	t.Run("a legacy folder can still be closed and its shares revoked", func(t *testing.T) {
		old := x.folder(t, "Cũ đã chia sẻ", "")
		x.legacyWorkspace(t, old.ID)
		x.legacyShare(t, old.ID, DocumentPrincipalUser, x.viewer.ID)
		view := DocumentLevelView
		_ = view
		res, err := f.svc.UpdateDocumentAccess(ctx, x.owner, old.ID, UpdateDocumentAccessInput{Items: []DocumentAccessBatchItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: x.viewer.ID},
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: x.tn.wsA},
		}})
		if err != nil {
			t.Fatalf("revoking on a folder: %v (%+v)", err, res)
		}
		if got := x.get(t, old.ID); got.Visibility != documentVisibilityRestricted {
			t.Fatalf("legacy folder visibility = %q, want restricted", got.Visibility)
		}
		if n := fsoCount(t, x, `SELECT count(*) FROM document_shares WHERE document_id = $1 AND revoked_at IS NULL`, old.ID); n != 0 {
			t.Fatalf("live shares left = %d", n)
		}
		// Closing through PATCH is the owner's self-service path too.
		again := x.folder(t, "Cũ hai", "")
		x.legacyWorkspace(t, again.ID)
		cur := x.get(t, again.ID)
		if _, err := f.svc.UpdateDocument(ctx, x.owner, again.ID, UpdateDocumentInput{Revision: cur.Revision, Visibility: strPtr(documentVisibilityRestricted)}); err != nil {
			t.Fatalf("closing a legacy folder by PATCH: %v", err)
		}
	})
}

func TestChildOfFolderNeverInheritsItsVisibility(t *testing.T) {
	x := newFolderOffFixture(t, "fso2")
	legacy := x.folder(t, "Cũ", "")
	x.legacyWorkspace(t, legacy.ID)

	child := x.page(t, "Con", legacy.ID, "")
	if child.Visibility != documentVisibilityRestricted {
		t.Fatalf("child of a (legacy) workspace folder = %q, want restricted", child.Visibility)
	}
	sub := x.folder(t, "Thư mục con", legacy.ID)
	if sub.Visibility != documentVisibilityRestricted {
		t.Fatalf("subfolder = %q, want restricted", sub.Visibility)
	}
	open := x.page(t, "Mở", legacy.ID, documentVisibilityWorkspace)
	if open.Visibility != documentVisibilityWorkspace || open.WorkspaceLevel != string(DocumentLevelView) {
		t.Fatalf("explicit workspace under a folder = %q/%q, want workspace/view", open.Visibility, open.WorkspaceLevel)
	}
	// A page parent still passes its pair on.
	parent := x.page(t, "Trang mở", "", documentVisibilityWorkspace)
	inherited := x.page(t, "Con của trang", parent.ID, "")
	if inherited.Visibility != documentVisibilityWorkspace {
		t.Fatalf("child of a workspace page = %q, want workspace", inherited.Visibility)
	}
}

func fsoByID(page DocumentListPage) map[string]DocumentListItem {
	out := make(map[string]DocumentListItem, len(page.Items))
	for _, it := range page.Items {
		out[it.Document.ID] = it
	}
	return out
}

func TestSharedDocumentIsNotAttachedToTheOwnersFolder(t *testing.T) {
	x := newFolderOffFixture(t, "fso3")
	f, ctx := x.f, x.f.ctx
	root := ""

	folder := x.folder(t, "Thư mục của chủ", "")
	open := x.page(t, "Mở cho workspace", folder.ID, documentVisibilityWorkspace)
	shared := x.page(t, "Chia sẻ cho một người", folder.ID, "")
	hidden := x.page(t, "Riêng tư", folder.ID, "")
	if _, err := f.svc.ShareDocument(ctx, x.owner, shared.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: x.viewer.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}

	t.Run("the root list promotes what the caller may read, for both ways of sharing", func(t *testing.T) {
		page, err := f.svc.ListDocuments(ctx, x.viewer, x.tn.wsA, ListDocumentsInput{ParentID: &root})
		if err != nil {
			t.Fatal(err)
		}
		got := fsoByID(page)
		for _, d := range []db.Document{open, shared} {
			it, ok := got[d.ID]
			if !ok {
				t.Fatalf("%q is missing from the viewer's root list", d.Title)
			}
			if it.Document.ParentID.Valid {
				t.Fatalf("%q still names the owner's folder %s", d.Title, it.Document.ParentID.String)
			}
		}
		if _, ok := got[hidden.ID]; ok {
			t.Fatal("a private document must not surface at the root of another reader")
		}
		if _, ok := got[folder.ID]; ok {
			t.Fatal("the owner's private folder must not be listed for the viewer")
		}
	})

	t.Run("the owner still sees the folder and its documents inside it", func(t *testing.T) {
		rootPage, err := f.svc.ListDocuments(ctx, x.owner, x.tn.wsA, ListDocumentsInput{ParentID: &root})
		if err != nil {
			t.Fatal(err)
		}
		got := fsoByID(rootPage)
		if _, ok := got[folder.ID]; !ok {
			t.Fatal("owner lost the folder at the root")
		}
		if _, ok := got[open.ID]; ok {
			t.Fatal("the owner's root must not double-list a document that is inside their folder")
		}
		inside, err := f.svc.ListDocuments(ctx, x.owner, x.tn.wsA, ListDocumentsInput{ParentID: &folder.ID})
		if err != nil {
			t.Fatal(err)
		}
		it, ok := fsoByID(inside)[open.ID]
		if !ok || it.Document.ParentID.String != folder.ID {
			t.Fatalf("inside the folder: ok=%v parent=%q, want the folder kept", ok, it.Document.ParentID.String)
		}
	})

	t.Run("the flat list and search carry no parent for the viewer", func(t *testing.T) {
		flat, err := f.svc.ListDocuments(ctx, x.viewer, x.tn.wsA, ListDocumentsInput{})
		if err != nil {
			t.Fatal(err)
		}
		search, err := f.svc.ListDocuments(ctx, x.viewer, x.tn.wsA, ListDocumentsInput{Query: "workspace"})
		if err != nil {
			t.Fatal(err)
		}
		for name, page := range map[string]DocumentListPage{"flat": flat, "search": search} {
			it, ok := fsoByID(page)[open.ID]
			if !ok {
				t.Fatalf("%s: %q missing", name, open.Title)
			}
			if it.Document.ParentID.Valid || len(it.Path) != 0 {
				t.Fatalf("%s: parent %q path %v leaked", name, it.Document.ParentID.String, it.Path)
			}
		}
		own, err := f.svc.ListDocuments(ctx, x.owner, x.tn.wsA, ListDocumentsInput{})
		if err != nil {
			t.Fatal(err)
		}
		if it := fsoByID(own)[open.ID]; it.Document.ParentID.String != folder.ID {
			t.Fatalf("the owner's own flat list lost the folder: %q", it.Document.ParentID.String)
		}
		recent, err := f.svc.ListRecentDocuments(ctx, x.viewer, x.tn.wsA, ListDocumentsInput{})
		if err == nil {
			for _, it := range recent.Items {
				if it.Document.ParentID.Valid && it.Document.ParentID.String == folder.ID {
					t.Fatalf("recent names the owner's folder for %q", it.Document.Title)
				}
			}
		}
	})

	t.Run("the tree lists them as roots and never names the folder", func(t *testing.T) {
		nodes, err := f.svc.DocumentTree(ctx, x.viewer, x.tn.wsA, "", false)
		if err != nil {
			t.Fatal(err)
		}
		seen := map[string]DocumentTreeNode{}
		for _, n := range nodes {
			seen[n.ID] = n
		}
		for _, d := range []db.Document{open, shared} {
			n, ok := seen[d.ID]
			if !ok || n.ParentID != "" {
				t.Fatalf("tree root for %q: ok=%v parent=%q", d.Title, ok, n.ParentID)
			}
		}
		if _, ok := seen[folder.ID]; ok {
			t.Fatal("the private folder is in the viewer's tree")
		}
		if _, ok := seen[hidden.ID]; ok {
			t.Fatal("a private document is in the viewer's tree")
		}
		ownerNodes, err := f.svc.DocumentTree(ctx, x.owner, x.tn.wsA, "", false)
		if err != nil {
			t.Fatal(err)
		}
		for _, n := range ownerNodes {
			if n.ID == open.ID {
				t.Fatal("the owner's tree double-lists a document inside their folder")
			}
		}
	})

	t.Run("an administrator does not get every private document at the root", func(t *testing.T) {
		page, err := f.svc.ListDocuments(ctx, x.admin, x.tn.wsA, ListDocumentsInput{ParentID: &root})
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := fsoByID(page)[hidden.ID]; ok {
			t.Fatal("an admin's root holds a private document nobody shared with them")
		}
	})

	t.Run("Shared with me and favorites carry no parent", func(t *testing.T) {
		sw, err := f.svc.ListSharedWithMe(ctx, x.viewer.ID, x.tn.orgID, SharedWithMeQuery{})
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, it := range sw.Items {
			if it.Document.ID == shared.ID {
				found = true
				if it.Document.ParentID.Valid {
					t.Fatalf("Shared with me names the owner's folder %s", it.Document.ParentID.String)
				}
			}
		}
		if !found {
			t.Fatal("the shared document is not in Shared with me")
		}
		if _, err := f.svc.FavoriteDocument(ctx, x.viewer, open.ID); err != nil {
			t.Fatal(err)
		}
		favs, err := f.svc.ListDocumentFavorites(ctx, x.viewer, x.tn.orgID)
		if err != nil {
			t.Fatal(err)
		}
		if len(favs) != 1 || favs[0].Document.ParentID.Valid {
			t.Fatalf("favorites = %d rows, parent leaked = %v", len(favs), len(favs) == 1 && favs[0].Document.ParentID.Valid)
		}
	})

	t.Run("the detail view has no breadcrumb and no parent for the viewer", func(t *testing.T) {
		view, err := f.svc.GetDocument(ctx, x.viewer, open.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(view.Breadcrumbs) != 0 || view.ParentVisible() {
			t.Fatalf("breadcrumbs=%v parentVisible=%v, want none", view.Breadcrumbs, view.ParentVisible())
		}
		own, err := f.svc.GetDocument(ctx, x.owner, open.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(own.Breadcrumbs) != 1 || !own.ParentVisible() {
			t.Fatalf("owner breadcrumbs=%v parentVisible=%v, want the folder", own.Breadcrumbs, own.ParentVisible())
		}
	})
}

func TestSharedByMeNeverListsFolders(t *testing.T) {
	x := newFolderOffFixture(t, "fso4")
	f, ctx := x.f, x.f.ctx
	legacy := x.folder(t, "Cũ đã chia sẻ", "")
	x.legacyWorkspace(t, legacy.ID)
	x.legacyShare(t, legacy.ID, DocumentPrincipalUser, x.viewer.ID)
	doc := x.page(t, "Tài liệu mở", "", documentVisibilityWorkspace)

	page, err := f.svc.ListDocuments(ctx, x.owner, x.tn.wsA, ListDocumentsInput{SharedByMe: true})
	if err != nil {
		t.Fatal(err)
	}
	got := fsoByID(page)
	if _, ok := got[legacy.ID]; ok {
		t.Fatal("Shared by me lists a (legacy) shared folder")
	}
	if _, ok := got[doc.ID]; !ok {
		t.Fatal("Shared by me lost the shared document")
	}
	_, err = f.svc.ListDocuments(ctx, x.owner, x.tn.wsA, ListDocumentsInput{SharedByMe: true, Kind: DocumentKindFolder})
	if !codedIs(err, "invalid_filter") {
		t.Fatalf("shared_by_me with kind=folder: %v, want invalid_filter", err)
	}
	sw, err := f.svc.ListSharedWithMe(ctx, x.viewer.ID, x.tn.orgID, SharedWithMeQuery{})
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range sw.Items {
		if it.Document.ID == legacy.ID {
			t.Fatal("Shared with me lists a legacy folder share")
		}
	}
}

func TestUnshareFoldersCleansLegacyAndKeepsDocuments(t *testing.T) {
	x := newFolderOffFixture(t, "fso5")
	f, ctx := x.f, x.f.ctx

	a := x.folder(t, "A chia sẻ workspace", "")
	x.legacyWorkspace(t, a.ID)
	x.legacyShare(t, a.ID, DocumentPrincipalUser, x.viewer.ID)
	b := x.folder(t, "B chỉ có share", "")
	x.legacyShare(t, b.ID, DocumentPrincipalOrganization, x.tn.orgID)
	x.legacyShare(t, b.ID, DocumentPrincipalWorkspace, x.tn.wsA) // legacy twin of the home row
	c := x.folder(t, "C đã lưu trữ", "")
	x.legacyWorkspace(t, c.ID)
	if _, err := f.pool.Exec(ctx, `UPDATE documents SET archived_at = now(), purge_after = now() + interval '30 days' WHERE id = $1`, c.ID); err != nil {
		t.Fatal(err)
	}
	clean := x.folder(t, "D riêng", "")

	child := x.page(t, "Tài liệu trong A", a.ID, documentVisibilityWorkspace)
	sharedChild := x.page(t, "Tài liệu chia sẻ trong A", a.ID, "")
	if _, err := f.svc.ShareDocument(ctx, x.owner, sharedChild.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: x.viewer.ID, Level: DocumentLevelEdit,
	}); err != nil {
		t.Fatal(err)
	}
	childBefore, sharedBefore := x.get(t, child.ID), x.get(t, sharedChild.ID)
	sharesBefore := fsoCount(t, x, `SELECT count(*) FROM document_shares WHERE document_id = $1 AND revoked_at IS NULL`, sharedChild.ID)

	dry, err := f.svc.UnshareFolders(ctx, true, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !dry.DryRun || dry.Folders != 3 || dry.HomeRows != 3 || dry.Shares != 2 {
		t.Fatalf("dry run = %+v, want 3 folders, 3 home rows (A, B twin, C), 2 shares", dry)
	}
	if got := x.get(t, a.ID); got.Visibility != documentVisibilityWorkspace {
		t.Fatal("a dry run wrote")
	}
	if n := fsoCount(t, x, `SELECT count(*) FROM audit_events WHERE resource_id = $1`, a.ID); n != 1 {
		t.Fatalf("audit rows on A after a dry run = %d, want only its create row", n)
	}

	res, err := f.svc.UnshareFolders(ctx, false, 2)
	if err != nil {
		t.Fatal(err)
	}
	if res.DryRun || res.Folders != 3 || res.Shares != 2 {
		t.Fatalf("run = %+v", res)
	}
	for _, id := range []string{a.ID, b.ID, c.ID, clean.ID} {
		if got := x.get(t, id); got.Visibility != documentVisibilityRestricted {
			t.Fatalf("folder %s visibility = %q", id, got.Visibility)
		}
		if n := fsoCount(t, x, `SELECT count(*) FROM document_shares WHERE document_id = $1 AND revoked_at IS NULL`, id); n != 0 {
			t.Fatalf("folder %s still has %d live shares", id, n)
		}
	}
	if x.get(t, c.ID).ArchivedAt.Valid == false {
		t.Fatal("the archived folder stopped being archived")
	}
	// Audit and frames: one home-row row per folder that was open, one revoke
	// per share (B's twin goes through the home-row writer).
	if n := fsoCount(t, x, `SELECT count(*) FROM audit_events WHERE action = 'document.workspace_access_changed' AND actor_id = 'folder-share-off'`); n != 3 {
		t.Fatalf("workspace_access_changed rows = %d, want 3", n)
	}
	if n := fsoCount(t, x, `SELECT count(*) FROM audit_events WHERE action = 'document.share_revoked' AND actor_id = 'folder-share-off'`); n != 3 {
		t.Fatalf("share_revoked rows = %d, want 3 (A's user, B's org, B's twin)", n)
	}
	if n := fsoCount(t, x, `SELECT count(*) FROM outbox_events WHERE topic = 'document.workspace_access_changed'`); n < 3 {
		t.Fatalf("outbox frames = %d", n)
	}

	// Documents keep their own access.
	childAfter, sharedAfter := x.get(t, child.ID), x.get(t, sharedChild.ID)
	if childAfter.Visibility != childBefore.Visibility || childAfter.WorkspaceLevel != childBefore.WorkspaceLevel || childAfter.Revision != childBefore.Revision {
		t.Fatalf("a document inside changed: %+v -> %+v", childBefore, childAfter)
	}
	if sharedAfter.Visibility != sharedBefore.Visibility || sharedAfter.Revision != sharedBefore.Revision {
		t.Fatal("the shared document changed")
	}
	if n := fsoCount(t, x, `SELECT count(*) FROM document_shares WHERE document_id = $1 AND revoked_at IS NULL`, sharedChild.ID); n != sharesBefore {
		t.Fatalf("the shared document's shares %d -> %d", sharesBefore, n)
	}

	again, err := f.svc.UnshareFolders(ctx, false, 2)
	if err != nil {
		t.Fatal(err)
	}
	if again.Folders != 0 || again.Shares != 0 {
		t.Fatalf("a second pass = %+v, want nothing", again)
	}
	if n := fsoCount(t, x, `SELECT count(*) FROM audit_events WHERE action = 'document.workspace_access_changed' AND actor_id = 'folder-share-off'`); n != 3 {
		t.Fatalf("a second pass wrote audit rows: %d", n)
	}
}
