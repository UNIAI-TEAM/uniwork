package service

import (
	"errors"
	"io"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// MYFOLDER-01 (UNI-1891) fix2: one assertion per admin listing, each in its
// own subtest so a Fatal on one query cannot hide another. Neutering
// uw_my_folder_foreign_ids must fail every exclusion row and leave the
// controls green.
func TestAdminListingsHideForeignMyFolderSubtree(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := env.f.ctx
	memberA := human(env.tn.member)
	admin := human(env.tn.owner)

	mfA, _, err := env.svc.EnsureMyFolder(ctx, memberA, env.tn.wsA)
	if err != nil {
		t.Fatalf("EnsureMyFolder(memberA): %v", err)
	}
	privateChild, err := env.svc.CreatePage(ctx, memberA, env.tn.wsA, CreatePageInput{
		Title: "Secret Inside My Folder", Destination: DocumentSystemKindMyFolder,
	})
	if err != nil {
		t.Fatalf("CreatePage(privateChild): %v", err)
	}
	privateFolder, err := env.svc.CreatePage(ctx, memberA, env.tn.wsA, CreatePageInput{
		Title: "Secret Folder", Destination: DocumentSystemKindMyFolder, Kind: DocumentKindFolder,
	})
	if err != nil {
		t.Fatalf("CreatePage(privateFolder): %v", err)
	}
	deepChild, err := env.svc.CreatePage(ctx, memberA, env.tn.wsA, CreatePageInput{
		Title: "mfs-secret", ParentID: privateFolder.Document.ID,
	})
	if err != nil {
		t.Fatalf("CreatePage(deepChild): %v", err)
	}
	trashedChild, err := env.svc.CreatePage(ctx, memberA, env.tn.wsA, CreatePageInput{
		Title: "Trashed Inside My Folder", Destination: DocumentSystemKindMyFolder,
	})
	if err != nil {
		t.Fatalf("CreatePage(trashedChild): %v", err)
	}
	if _, err := env.svc.ArchiveDocument(ctx, memberA, trashedChild.Document.ID, ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
		t.Fatalf("ArchiveDocument(trashedChild): %v", err)
	}
	insertRow(t, ctx, env.f.pool, "document_access_logs", map[string]any{
		"id": util.NewID(), "organization_id": env.tn.orgID, "workspace_id": env.tn.wsA,
		"document_id": deepChild.Document.ID, "actor_id": admin.ID, "actor_kind": "human",
		"action": "view", "via": "member", "correlation_id": util.NewID(),
	})

	manageShared, err := env.svc.CreatePage(ctx, memberA, env.tn.wsA, CreatePageInput{
		Title: "Manage Shared Inside My Folder", Destination: DocumentSystemKindMyFolder,
	})
	if err != nil {
		t.Fatalf("CreatePage(manageShared): %v", err)
	}
	if _, err := env.svc.ShareDocument(ctx, memberA, manageShared.Document.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: admin.ID, Level: DocumentLevelManage,
	}); err != nil {
		t.Fatalf("ShareDocument(manageShared -> admin): %v", err)
	}

	wsVisible, err := env.svc.CreatePage(ctx, memberA, env.tn.wsA, CreatePageInput{
		Title: "Workspace Visible Inside My Folder", Destination: DocumentSystemKindMyFolder,
		Visibility: documentVisibilityWorkspace,
	})
	if err != nil {
		t.Fatalf("CreatePage(wsVisible): %v", err)
	}

	// BE-MFS-8 (a folder inside A's My Folder opened to the admin through a live
	// manage share) cannot be built any more: a folder is never shared
	// (UNI-1974), and TestUnshareFoldersCleansLegacyAndKeepsDocuments covers the
	// rows that were shared before.

	// BE-MFS-9: an archived workspace-visible page at workspace_level = 'view'
	// inside A's My Folder. The trash admits workspace-visible rows only at the
	// edit levels its member predicate uses, so the admin's see_all leg must not
	// add it back.
	archivedView, err := env.svc.CreatePage(ctx, memberA, env.tn.wsA, CreatePageInput{
		Title: "Archived Workspace View Inside My Folder", Destination: DocumentSystemKindMyFolder,
		Visibility: documentVisibilityWorkspace,
	})
	if err != nil {
		t.Fatalf("CreatePage(archivedView): %v", err)
	}
	if _, err := env.svc.ArchiveDocument(ctx, memberA, archivedView.Document.ID, ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
		t.Fatalf("ArchiveDocument(archivedView): %v", err)
	}

	adminOwned, err := env.svc.CreatePage(ctx, admin, env.tn.wsA, CreatePageInput{
		Title: "Admin ACL Owned Moved In", Visibility: documentVisibilityRestricted,
	})
	if err != nil {
		t.Fatalf("CreatePage(adminOwned): %v", err)
	}
	if _, err := env.svc.ShareDocument(ctx, admin, adminOwned.Document.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: memberA.ID, Level: DocumentLevelManage,
	}); err != nil {
		t.Fatalf("ShareDocument(adminOwned -> memberA): %v", err)
	}
	cur, err := env.svc.GetDocument(ctx, memberA, adminOwned.Document.ID)
	if err != nil {
		t.Fatalf("GetDocument(adminOwned) by memberA: %v", err)
	}
	adminOwned, err = env.svc.MoveDocument(ctx, memberA, adminOwned.Document.ID, MoveDocumentInput{
		ParentID: mfA.Document.ID, Revision: cur.Document.Revision, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatalf("MoveDocument(adminOwned into My Folder): %v", err)
	}

	ordinary, err := env.svc.CreatePage(ctx, memberA, env.tn.wsA, CreatePageInput{
		Title: "Ordinary Restricted Folder", Kind: DocumentKindFolder, Visibility: documentVisibilityRestricted,
	})
	if err != nil {
		t.Fatalf("CreatePage(ordinary): %v", err)
	}

	containsListID := func(page DocumentListPage, wantID string) bool {
		for i := range page.Items {
			if page.Items[i].Document.ID == wantID {
				return true
			}
		}
		return false
	}
	reportHas := func(page DocumentAccessReportPage, wantID string) *DocumentAccessReportItem {
		for i := range page.Items {
			if page.Items[i].Item.Document.ID == wantID {
				return &page.Items[i]
			}
		}
		return nil
	}
	hidden := []struct{ name, id string }{
		{"My Folder", mfA.Document.ID},
		{"private child", privateChild.Document.ID},
		{"private folder", privateFolder.Document.ID},
		{"deep child", deepChild.Document.ID},
	}

	t.Run("flat list", func(t *testing.T) {
		page, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{})
		if err != nil {
			t.Fatalf("ListDocuments: %v", err)
		}
		for _, h := range hidden {
			if containsListID(page, h.id) {
				t.Errorf("admin flat list leaked %s", h.name)
			}
		}
	})
	t.Run("search", func(t *testing.T) {
		page, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{Query: "mfs-secret"})
		if err != nil {
			t.Fatalf("ListDocuments(search): %v", err)
		}
		if containsListID(page, deepChild.Document.ID) {
			t.Error("admin search leaked the page under A's private folder")
		}
	})
	t.Run("children under foreign My Folder", func(t *testing.T) {
		parent := mfA.Document.ID
		page, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{ParentID: &parent})
		if err != nil {
			t.Fatalf("ListDocuments(parent=mfA): %v", err)
		}
		for _, h := range []struct{ name, id string }{
			{"private child", privateChild.Document.ID},
			{"private folder", privateFolder.Document.ID},
		} {
			if containsListID(page, h.id) {
				t.Errorf("admin children of foreign My Folder leaked %s", h.name)
			}
		}
	})
	t.Run("children under private folder", func(t *testing.T) {
		parent := privateFolder.Document.ID
		page, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{ParentID: &parent})
		if err != nil {
			t.Fatalf("ListDocuments(parent=privateFolder): %v", err)
		}
		if containsListID(page, deepChild.Document.ID) {
			t.Error("admin children of the private folder leaked the deep page")
		}
	})
	t.Run("tree explicit foreign root", func(t *testing.T) {
		_, err := env.svc.DocumentTree(ctx, admin, env.tn.wsA, privateFolder.Document.ID, false)
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("DocumentTree(privateFolder) = %v, want not found (root is not in the visible set, same as a restricted parent the caller cannot read)", err)
		}
	})
	t.Run("trash", func(t *testing.T) {
		page, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{Archived: true})
		if err != nil {
			t.Fatalf("ListDocuments(archived): %v", err)
		}
		if containsListID(page, trashedChild.Document.ID) {
			t.Error("admin trash leaked a document inside A's My Folder")
		}
	})
	t.Run("recent with admin access log", func(t *testing.T) {
		page, err := env.svc.ListRecentDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{})
		if err != nil {
			t.Fatalf("ListRecentDocuments: %v", err)
		}
		if containsListID(page, deepChild.Document.ID) {
			t.Error("admin recent list leaked a document inside A's My Folder")
		}
	})
	t.Run("access report workspace", func(t *testing.T) {
		page, err := env.svc.DocumentAccessReport(ctx, admin, env.tn.wsA, DocumentAccessReportQuery{})
		if err != nil {
			t.Fatalf("DocumentAccessReport: %v", err)
		}
		for _, h := range hidden {
			if reportHas(page, h.id) != nil {
				t.Errorf("admin access report leaked %s", h.name)
			}
		}
	})
	t.Run("folder-scoped report on foreign folder", func(t *testing.T) {
		page, err := env.svc.DocumentAccessReport(ctx, admin, env.tn.wsA, DocumentAccessReportQuery{FolderID: privateFolder.Document.ID})
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("folder-scoped report = %+v err=%v, want not found (no title, no id)", page, err)
		}
	})
	t.Run("folder-scoped export on foreign folder", func(t *testing.T) {
		_, err := env.svc.ExportDocumentAccessReport(ctx, admin, env.tn.wsA, DocumentAccessReportQuery{FolderID: privateFolder.Document.ID}, AccessReportFormatCSV, io.Discard)
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("folder-scoped export err=%v, want not found", err)
		}
	})
	t.Run("ordinary restricted folder report", func(t *testing.T) {
		page, err := env.svc.DocumentAccessReport(ctx, admin, env.tn.wsA, DocumentAccessReportQuery{FolderID: ordinary.Document.ID})
		if err != nil {
			t.Fatalf("ordinary restricted folder report: %v", err)
		}
		if page.FolderID != ordinary.Document.ID || page.FolderTitle != ordinary.Document.Title {
			t.Errorf("ordinary restricted folder scope = %q %q, want id+title", page.FolderID, page.FolderTitle)
		}
	})

	t.Run("control manage share list", func(t *testing.T) {
		page, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{})
		if err != nil {
			t.Fatalf("ListDocuments: %v", err)
		}
		if !containsListID(page, manageShared.Document.ID) {
			t.Error("admin flat list missing the manage-shared foreign descendant")
		}
		parent := mfA.Document.ID
		kids, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{ParentID: &parent})
		if err != nil {
			t.Fatalf("ListDocuments(parent=mfA): %v", err)
		}
		if !containsListID(kids, manageShared.Document.ID) {
			t.Error("admin children of foreign My Folder missing the manage-shared descendant")
		}
	})
	t.Run("control manage share report", func(t *testing.T) {
		page, err := env.svc.DocumentAccessReport(ctx, admin, env.tn.wsA, DocumentAccessReportQuery{})
		if err != nil {
			t.Fatalf("DocumentAccessReport: %v", err)
		}
		it := reportHas(page, manageShared.Document.ID)
		if it == nil {
			t.Fatal("admin access report missing the manage-shared foreign descendant")
		}
		if it.Item.Access.Level != DocumentLevelManage {
			t.Errorf("manage-shared report level = %q, want manage", it.Item.Access.Level)
		}
	})
	t.Run("control admin ACL-owned moved in", func(t *testing.T) {
		page, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{})
		if err != nil {
			t.Fatalf("ListDocuments: %v", err)
		}
		if !containsListID(page, adminOwned.Document.ID) {
			t.Error("admin flat list missing their own ACL-owned page moved into the member's My Folder")
		}
		if _, err := env.svc.DocumentTree(ctx, admin, env.tn.wsA, adminOwned.Document.ID, false); errors.Is(err, ErrNotFound) {
			t.Error("admin tree does not admit their own ACL-owned page as a root")
		} else if err != nil {
			t.Fatalf("DocumentTree(adminOwned): %v", err)
		}
		report, err := env.svc.DocumentAccessReport(ctx, admin, env.tn.wsA, DocumentAccessReportQuery{})
		if err != nil {
			t.Fatalf("DocumentAccessReport: %v", err)
		}
		if reportHas(report, adminOwned.Document.ID) == nil {
			t.Error("admin access report missing their own ACL-owned page moved into the member's My Folder")
		}
	})
	t.Run("control workspace-visible inside", func(t *testing.T) {
		page, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{})
		if err != nil {
			t.Fatalf("ListDocuments: %v", err)
		}
		if !containsListID(page, wsVisible.Document.ID) {
			t.Error("admin flat list missing a workspace-visible page inside the member's My Folder")
		}
		if _, err := env.svc.DocumentTree(ctx, admin, env.tn.wsA, wsVisible.Document.ID, false); errors.Is(err, ErrNotFound) {
			t.Error("admin tree does not admit the workspace-visible page as a root")
		} else if err != nil {
			t.Fatalf("DocumentTree(wsVisible): %v", err)
		}
		report, err := env.svc.DocumentAccessReport(ctx, admin, env.tn.wsA, DocumentAccessReportQuery{})
		if err != nil {
			t.Fatalf("DocumentAccessReport: %v", err)
		}
		if reportHas(report, wsVisible.Document.ID) == nil {
			t.Error("admin access report missing a workspace-visible page inside the member's My Folder")
		}
	})

	// BE-MFS-9: the trash admits workspace-visible rows only at the edit levels
	// its member predicate uses (shareLevelsFor(DocumentLevelEdit)); a
	// workspace-visible page archived inside A's My Folder at workspace_level
	// = 'view' must not come back through the admin's see_all leg.
	t.Run("trash omits a workspace-visible view page inside a foreign My Folder", func(t *testing.T) {
		page, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{Archived: true})
		if err != nil {
			t.Fatalf("ListDocuments(archived): %v", err)
		}
		if containsListID(page, archivedView.Document.ID) {
			t.Error("admin trash leaked an archived workspace-visible view page inside A's My Folder")
		}
	})

	// BE-MFS-10: the access-report candidate share EXISTS must admit a share
	// below manage. A foreign-My-Folder descendant shared to the admin at view
	// is a candidate (Candidates +1 vs before it existed) and the admin's real
	// share covers it, so it is listed, not admin-scope-only. Narrowing the
	// share levels to manage drops it from both.
	t.Run("workspace report admits a view-shared foreign descendant", func(t *testing.T) {
		before, err := env.svc.DocumentAccessReport(ctx, admin, env.tn.wsA, DocumentAccessReportQuery{})
		if err != nil {
			t.Fatalf("DocumentAccessReport(before): %v", err)
		}
		viewShared, err := env.svc.CreatePage(ctx, memberA, env.tn.wsA, CreatePageInput{
			Title: "View Shared Inside My Folder", Destination: DocumentSystemKindMyFolder,
		})
		if err != nil {
			t.Fatalf("CreatePage(viewShared): %v", err)
		}
		if _, err := env.svc.ShareDocument(ctx, memberA, viewShared.Document.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: admin.ID, Level: DocumentLevelView,
		}); err != nil {
			t.Fatalf("ShareDocument(viewShared -> admin): %v", err)
		}
		after, err := env.svc.DocumentAccessReport(ctx, admin, env.tn.wsA, DocumentAccessReportQuery{})
		if err != nil {
			t.Fatalf("DocumentAccessReport(after): %v", err)
		}
		if after.Candidates != before.Candidates+1 {
			t.Errorf("candidates = %d after adding the view-shared foreign descendant, want %d (the candidate share EXISTS must admit a view level)", after.Candidates, before.Candidates+1)
		}
		it := reportHas(after, viewShared.Document.ID)
		if it == nil {
			t.Fatal("workspace report dropped a foreign descendant shared to the admin at view")
		}
		if it.Item.Access.Level != DocumentLevelView || it.Item.Access.Via != DocumentViaShare {
			t.Errorf("view-shared descendant access = %+v, want a real view share (not admin scope alone)", it.Item.Access)
		}
	})
}
