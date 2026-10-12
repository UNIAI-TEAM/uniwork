package service

// Review follow-ups on folders (UNI-1305): the archive bound and its
// set-based access check, the move order of access before kind, the
// visibility a move leaves alone, and no public link on a folder.

import (
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDocumentFolderArchiveBound(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	env.svc.archiveMaxNodes = 3

	node := func(t *testing.T, parent, kind, title string) db.Document {
		t.Helper()
		v, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Kind: kind, ParentID: parent, Title: title})
		if err != nil {
			t.Fatalf("create %q: %v", title, err)
		}
		return v.Document
	}

	t.Run("a subtree at the bound archives and restores", func(t *testing.T) {
		root := node(t, "", DocumentKindFolder, "Vừa đủ")
		node(t, root.ID, DocumentKindPage, "Một")
		node(t, root.ID, DocumentKindPage, "Hai")
		res, err := env.svc.ArchiveDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		if err != nil || len(res.Affected) != 3 {
			t.Fatalf("archive at the bound = %v, %v", res.Affected, err)
		}
		// One audit row and one outbox row per node survive the batch write.
		for _, id := range res.Affected {
			if n := env.countAudit(t, "document.archived", id); n != 1 {
				t.Fatalf("%s: %d archive audit rows, want 1", id, n)
			}
			if n := env.countOutbox(t, "document.archived", id); n != 1 {
				t.Fatalf("%s: %d archive outbox rows, want 1", id, n)
			}
		}
		// Restore has no bound: a batch larger than it (a legacy one) can only
		// come back whole, never in parts, so it must not be refused.
		env.svc.archiveMaxNodes = 2
		res, err = env.svc.RestoreDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		if err != nil || len(res.Affected) != 3 {
			t.Fatalf("restore of a batch over the bound = %v, %v", res.Affected, err)
		}
		env.svc.archiveMaxNodes = 3
		for _, id := range res.Affected {
			if n := env.countAudit(t, "document.restored", id); n != 1 {
				t.Fatalf("%s: %d restore audit rows, want 1", id, n)
			}
		}
	})

	t.Run("a subtree over the bound is refused and nothing is archived", func(t *testing.T) {
		root := node(t, "", DocumentKindFolder, "Quá lớn")
		kids := []db.Document{
			node(t, root.ID, DocumentKindPage, "Một"),
			node(t, root.ID, DocumentKindPage, "Hai"),
			node(t, root.ID, DocumentKindPage, "Ba"),
		}
		_, err := env.svc.ArchiveDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		ce := wantCode(t, err, "folder_too_large")
		if ce.Status != 422 {
			t.Fatalf("folder_too_large status = %d, want 422", ce.Status)
		}
		for _, id := range []string{root.ID, kids[0].ID, kids[1].ID, kids[2].ID} {
			env.f.live(t, id)
		}
		// Archiving a part works: the bound is about one command, not the tree.
		if _, err := env.svc.ArchiveDocument(ctx, member, kids[0].ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("archive in parts: %v", err)
		}
	})
}

// The set-based access check keeps the old rule: every live node of the
// subtree must be manageable, whichever path gives the manage.
func TestDocumentFolderArchiveAccess(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	tn := env.tn
	f := env.f

	newFolder := func(t *testing.T) db.Document {
		t.Helper()
		v, err := env.svc.CreatePage(ctx, member, tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục " + util.NewID()})
		if err != nil {
			t.Fatal(err)
		}
		return v.Document
	}
	foreignChild := func(t *testing.T, parent db.Document) db.Document {
		t.Helper()
		return f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID,
			createdBy: tn.aclOwner.ID, parent: parent.ID})
	}

	t.Run("a restricted child the caller does not manage refuses the whole archive", func(t *testing.T) {
		root := newFolder(t)
		child := foreignChild(t, root)
		_, err := env.svc.ArchiveDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("archive over an unmanageable child = %v, want forbidden", err)
		}
		f.live(t, root.ID)
		f.live(t, child.ID)
	})

	// acl_owner_id is NULL for agent/system-created documents. The set-based
	// query must keep such a node in the check set (NULL = actor is not true),
	// so the answer equals effectiveLevel's: a restricted node is unreadable,
	// an edit-only one is not manage.
	t.Run("a restricted child with no ACL owner refuses a folder manager", func(t *testing.T) {
		root := newFolder(t)
		child := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted",
			createdBy: tn.aclOwner.ID, parent: root.ID})
		_, err := env.svc.ArchiveDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("archive over a restricted child with a NULL ACL owner = %v, want forbidden", err)
		}
		f.live(t, root.ID)
		f.live(t, child.ID)
	})

	t.Run("an edit-only workspace child with no ACL owner refuses a folder manager", func(t *testing.T) {
		root := newFolder(t)
		child := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace",
			createdBy: tn.aclOwner.ID, parent: root.ID})
		_, err := env.svc.ArchiveDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("archive over an edit-only child with a NULL ACL owner = %v, want forbidden", err)
		}
		f.live(t, root.ID)
		f.live(t, child.ID)
	})

	t.Run("a workspace admin archives a child with no ACL owner", func(t *testing.T) {
		root := newFolder(t)
		child := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted",
			createdBy: tn.aclOwner.ID, parent: root.ID})
		res, err := env.svc.ArchiveDocument(ctx, human(tn.wsAdmin), root.ID, ArchiveDocumentInput{})
		if err != nil || len(res.Affected) != 2 {
			t.Fatalf("admin archive over a NULL-ACL-owner child = %v, %v", res.Affected, err)
		}
		d, err := f.q.GetDocumentByID(ctx, child.ID)
		if err != nil || !d.ArchivedAt.Valid {
			t.Fatalf("NULL-ACL-owner child not archived: %+v %v", d, err)
		}
	})

	t.Run("a share at edit is not manage", func(t *testing.T) {
		root := newFolder(t)
		child := foreignChild(t, root)
		f.share(t, child, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)
		_, err := env.svc.ArchiveDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("archive with an edit share = %v, want forbidden", err)
		}
	})

	t.Run("a manage share on the child lets the archive through", func(t *testing.T) {
		root := newFolder(t)
		child := foreignChild(t, root)
		f.share(t, child, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.aclOwner.ID)
		res, err := env.svc.ArchiveDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		if err != nil || len(res.Affected) != 2 {
			t.Fatalf("archive with a manage share = %v, %v", res.Affected, err)
		}
		// Restore reads the same rule off the loaded batch.
		if _, err := env.svc.RestoreDocument(ctx, member, root.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("restore with a manage share: %v", err)
		}
	})

	t.Run("a workspace admin manages every node, restricted or not", func(t *testing.T) {
		root := newFolder(t)
		child := foreignChild(t, root)
		res, err := env.svc.ArchiveDocument(ctx, human(tn.wsAdmin), root.ID, ArchiveDocumentInput{})
		if err != nil || len(res.Affected) != 2 {
			t.Fatalf("admin archive = %v, %v", res.Affected, err)
		}
		d, err := f.q.GetDocumentByID(ctx, child.ID)
		if err != nil || !d.ArchivedAt.Valid {
			t.Fatalf("restricted child not archived: %+v %v", d, err)
		}
	})
}

func TestDocumentMoveChecksAccessBeforeKind(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	tn := env.tn

	folder, err := env.svc.CreatePage(ctx, member, tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Cần chuyển"})
	if err != nil {
		t.Fatal(err)
	}
	// A restricted page of someone else: the member cannot read it, so the
	// answer is not found whatever kind the move would break.
	hidden := env.f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	_, err = env.svc.MoveDocument(ctx, member, folder.Document.ID, MoveDocumentInput{ParentID: hidden.ID, Revision: folder.Document.Revision})
	wantNotFound(t, err)

	// A page the member can edit: now the kind rule answers.
	page, err := env.svc.CreatePage(ctx, member, tn.wsA, CreatePageInput{Title: "Trang của tôi"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = env.svc.MoveDocument(ctx, member, folder.Document.ID, MoveDocumentInput{ParentID: page.Document.ID, Revision: folder.Document.Revision})
	wantCode(t, err, "document_parent_kind")
}

// Visibility is inherited when a document is created and never on a move: a
// restricted folder is not a boundary around what is moved into it. The FE
// must not promise otherwise.
func TestDocumentMoveKeepsVisibility(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	restricted, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Hạn chế", Visibility: documentVisibilityRestricted})
	if err != nil {
		t.Fatal(err)
	}
	if restricted.Document.Visibility != documentVisibilityRestricted {
		t.Fatalf("folder visibility = %q", restricted.Document.Visibility)
	}
	page, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Title: "Công khai trong workspace"})
	if err != nil {
		t.Fatal(err)
	}
	moved, err := env.svc.MoveDocument(ctx, member, page.Document.ID, MoveDocumentInput{ParentID: restricted.Document.ID, Revision: page.Document.Revision})
	if err != nil {
		t.Fatal(err)
	}
	if moved.Document.Visibility != documentVisibilityWorkspace {
		t.Fatalf("a move into a restricted folder changed visibility to %q", moved.Document.Visibility)
	}
	// Created inside it, the same page inherits.
	child, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{ParentID: restricted.Document.ID, Title: "Tạo trong thư mục"})
	if err != nil {
		t.Fatal(err)
	}
	if child.Document.Visibility != documentVisibilityRestricted {
		t.Fatalf("a page created in a restricted folder = %q, want it inherited", child.Document.Visibility)
	}
}

func TestDocumentFolderHasNoPublicLink(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "flink")
	f.withLinks(t)
	mgr := Human(tn.aclOwner.ID)
	if _, err := f.svc.SetDocumentPublicLinks(f.ctx, Human(tn.orgAdmin.ID), tn.orgID, true); err != nil {
		t.Fatal(err)
	}
	folder := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, kind: DocumentKindFolder})
	page := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	// Create is refused by name once the caller may manage the folder; a
	// stranger still gets the unknown-id answer.
	_, err := f.svc.CreateDocumentLink(f.ctx, mgr, folder.ID, 0)
	wantCode(t, err, "folder_not_supported")
	_, err = f.svc.CreateDocumentLink(f.ctx, Human(tn.outsider.ID), folder.ID, 0)
	wantNotFound(t, err)

	// Control: a page in the same workspace still gets a link and resolves.
	out, err := f.svc.CreateDocumentLink(f.ctx, mgr, page.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ResolvePublicDocument(f.ctx, out.Token); err != nil {
		t.Fatalf("control page link: %v", err)
	}

	// A link row that already points at a folder (written before the refusal,
	// or by hand) reads as not found, like every other refusal.
	token, err := newDocumentLinkToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.q.InsertDocumentShareLink(f.ctx, db.InsertDocumentShareLinkParams{
		ID: util.NewID(), OrganizationID: folder.OrganizationID, WorkspaceID: folder.WorkspaceID, DocumentID: folder.ID,
		TokenHash: hashDocumentLinkToken(token), ExpiresAt: out.Link.ExpiresAt, CreatedBy: tn.aclOwner.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.ResolvePublicDocument(f.ctx, token)
	wantNotFound(t, err)
	_, err = f.svc.OpenPublicDocument(f.ctx, token)
	wantNotFound(t, err)
}
