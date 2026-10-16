package service

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

func TestEnsureMyFolder(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	owner := human(env.tn.owner)

	// MF-1: first call creates the §1 row with audit + outbox; second call returns the same id with created=false and no second audit/outbox.
	first, created, err := env.svc.EnsureMyFolder(ctx, member, env.tn.wsA)
	if err != nil {
		t.Fatalf("first EnsureMyFolder: %v", err)
	}
	if !created {
		t.Fatal("first EnsureMyFolder: created = false, want true")
	}
	doc := first.Document
	if doc.Kind != DocumentKindFolder || !doc.SystemKind.Valid || doc.SystemKind.String != DocumentSystemKindMyFolder {
		t.Fatalf("unexpected kind/system_kind: kind=%q system_kind=%+v", doc.Kind, doc.SystemKind)
	}
	if doc.ParentID.Valid || doc.OwnerKind.Valid || doc.OwnerID.Valid {
		t.Fatalf("expected root unowned folder, got parent=%+v owner_kind=%+v owner_id=%+v", doc.ParentID, doc.OwnerKind, doc.OwnerID)
	}
	if doc.Visibility != documentVisibilityRestricted || doc.WorkspaceLevel != string(DocumentLevelView) {
		t.Fatalf("visibility=%q workspace_level=%q, want restricted/view", doc.Visibility, doc.WorkspaceLevel)
	}
	if !doc.AclOwnerID.Valid || doc.AclOwnerID.String != member.ID || doc.CreatedBy != member.ID || doc.CreatedByKind != "human" {
		t.Fatalf("unexpected attribution: acl_owner=%+v created_by=%q/%q", doc.AclOwnerID, doc.CreatedBy, doc.CreatedByKind)
	}
	if doc.Title != "My Folder" || doc.OrganizationID != env.tn.orgID || doc.WorkspaceID != env.tn.wsA {
		t.Fatalf("unexpected row fields: title=%q org=%q ws=%q", doc.Title, doc.OrganizationID, doc.WorkspaceID)
	}
	if first.Access.Level != DocumentLevelManage {
		t.Fatalf("owner access level = %q, want manage", first.Access.Level)
	}
	if n := env.countAudit(t, audit.ActionDocumentCreated, doc.ID); n != 1 {
		t.Fatalf("audit rows after first ensure = %d, want 1", n)
	}
	if n := env.countOutbox(t, "document.created", doc.ID); n != 1 {
		t.Fatalf("outbox rows after first ensure = %d, want 1", n)
	}
	var rawMeta []byte
	if err := env.f.pool.QueryRow(ctx,
		`SELECT metadata FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionDocumentCreated, doc.ID).Scan(&rawMeta); err != nil {
		t.Fatal(err)
	}
	var meta map[string]any
	if err := json.Unmarshal(rawMeta, &meta); err != nil {
		t.Fatal(err)
	}
	if meta["system_kind"] != DocumentSystemKindMyFolder {
		t.Fatalf("audit metadata system_kind = %v, want %q", meta["system_kind"], DocumentSystemKindMyFolder)
	}

	second, created2, err := env.svc.EnsureMyFolder(ctx, member, env.tn.wsA)
	if err != nil {
		t.Fatalf("second EnsureMyFolder: %v", err)
	}
	if created2 {
		t.Fatal("second EnsureMyFolder: created = true, want false")
	}
	if second.Document.ID != doc.ID {
		t.Fatalf("second EnsureMyFolder id = %q, want %q", second.Document.ID, doc.ID)
	}
	if n := env.countAudit(t, audit.ActionDocumentCreated, doc.ID); n != 1 {
		t.Fatalf("audit rows after second ensure = %d, want 1", n)
	}
	if n := env.countOutbox(t, "document.created", doc.ID); n != 1 {
		t.Fatalf("outbox rows after second ensure = %d, want 1", n)
	}

	// MF-1 concurrent calls for another member -> one row, one audit.
	const callers = 4
	var wg sync.WaitGroup
	wg.Add(callers)
	ids := make([]string, callers)
	errs := make([]error, callers)
	createdCount := make([]bool, callers)
	for i := 0; i < callers; i++ {
		i := i
		go func() {
			defer wg.Done()
			v, c, e := env.svc.EnsureMyFolder(ctx, owner, env.tn.wsA)
			errs[i] = e
			createdCount[i] = c
			if e == nil {
				ids[i] = v.Document.ID
			}
		}()
	}
	wg.Wait()
	var wins int
	for i := 0; i < callers; i++ {
		if errs[i] != nil {
			t.Fatalf("concurrent EnsureMyFolder[%d]: %v", i, errs[i])
		}
		if ids[i] != ids[0] {
			t.Fatalf("concurrent EnsureMyFolder[%d] id = %q, want %q", i, ids[0], ids[0])
		}
		if createdCount[i] {
			wins++
		}
	}
	if wins != 1 {
		t.Fatalf("concurrent EnsureMyFolder created=true count = %d, want 1", wins)
	}
	if n := env.countAudit(t, audit.ActionDocumentCreated, ids[0]); n != 1 {
		t.Fatalf("concurrent audit rows = %d, want 1", n)
	}

	// MF-5: user-created root folder named "My Folder" coexists with two members' My Folders.
	userFolder, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{
		Kind: DocumentKindFolder, Title: "My Folder",
	})
	if err != nil {
		t.Fatalf("create user root folder named 'My Folder': %v", err)
	}
	if userFolder.Document.SystemKind.Valid {
		t.Fatalf("user folder should have NULL system_kind, got %+v", userFolder.Document.SystemKind)
	}
	// A second user-created root folder named "My Folder" is still refused by folder_name_taken.
	_, err = env.svc.CreatePage(ctx, owner, env.tn.wsA, CreatePageInput{
		Kind: DocumentKindFolder, Title: "my folder",
	})
	wantCode(t, err, "folder_name_taken")

	// MF-2: agent -> ErrForbidden; outsider -> ErrNotFound; deactivated member -> 403 member_deactivated.
	if _, _, err := env.svc.EnsureMyFolder(ctx, agentActor(env.tn.agent), env.tn.wsA); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent EnsureMyFolder = %v, want ErrForbidden", err)
	}
	if _, _, err := env.svc.EnsureMyFolder(ctx, human(env.tn.outsider), env.tn.wsA); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider EnsureMyFolder = %v, want ErrNotFound", err)
	}
	_, _, err = env.svc.EnsureMyFolder(ctx, human(env.tn.deact), env.tn.wsA)
	ce := wantCode(t, err, "member_deactivated")
	if ce.Status != 403 {
		t.Fatalf("deactivated status = %d, want 403", ce.Status)
	}
}

// MF-4: every §3 operation on the My Folder row itself is refused with 409
// my_folder_locked; items inside My Folder can be shared, renamed, moved out
// and back in, and archived normally.
func TestMyFolderLocks(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := env.f.ctx
	member := human(env.tn.member)
	creator := human(env.tn.creator)
	owner := human(env.tn.owner)

	mf, _, err := env.svc.EnsureMyFolder(ctx, member, env.tn.wsA)
	if err != nil {
		t.Fatalf("EnsureMyFolder: %v", err)
	}
	otherFolder, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{
		Kind: DocumentKindFolder, Title: "Other Folder",
	})
	if err != nil {
		t.Fatalf("create other folder: %v", err)
	}

	assertLocked := func(name string, err error) {
		t.Helper()
		ce := wantCode(t, err, "my_folder_locked")
		if ce.Status != 409 {
			t.Fatalf("%s status = %d, want 409", name, ce.Status)
		}
	}

	// 1. Archive / trash and archive-impact on My Folder -> 409 my_folder_locked.
	_, err = env.svc.ArchiveDocument(ctx, member, mf.Document.ID, ArchiveDocumentInput{IdempotencyKey: "arch-mf"})
	assertLocked("ArchiveDocument", err)
	_, err = env.svc.ArchiveImpact(ctx, member, mf.Document.ID)
	assertLocked("ArchiveImpact", err)

	// 2. PATCH title, icon, visibility on My Folder -> 409 my_folder_locked.
	newTitle := "Renamed"
	_, err = env.svc.UpdateDocument(ctx, member, mf.Document.ID, UpdateDocumentInput{
		Title: &newTitle, Revision: mf.Document.Revision,
	})
	assertLocked("UpdateDocument(title)", err)
	newIcon := "📁"
	_, err = env.svc.UpdateDocument(ctx, member, mf.Document.ID, UpdateDocumentInput{
		Icon: &newIcon, Revision: mf.Document.Revision,
	})
	assertLocked("UpdateDocument(icon)", err)
	wsVis := "workspace"
	_, err = env.svc.UpdateDocument(ctx, member, mf.Document.ID, UpdateDocumentInput{
		Visibility: &wsVis, Revision: mf.Document.Revision,
	})
	assertLocked("UpdateDocument(visibility)", err)

	// 3. Share (user, home workspace, batch, revoke), public links, and break-glass -> 409 my_folder_locked.
	_, err = env.svc.ShareDocument(ctx, member, mf.Document.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: env.tn.creator.ID, Level: DocumentLevelView,
	})
	assertLocked("ShareDocument(user)", err)
	_, err = env.svc.ShareDocument(ctx, member, mf.Document.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalWorkspace, PrincipalID: env.tn.wsA, Level: DocumentLevelEdit,
	})
	assertLocked("ShareDocument(home workspace)", err)
	_, err = env.svc.ShareDocumentBatch(ctx, member, mf.Document.ID, []string{env.tn.creator.ID}, DocumentLevelView)
	assertLocked("ShareDocumentBatch", err)
	err = env.svc.RevokeDocumentShare(ctx, member, mf.Document.ID, "01SHARE0000000000000000000")
	assertLocked("RevokeDocumentShare", err)
	_, err = env.svc.CreateDocumentLink(ctx, member, mf.Document.ID, 7)
	assertLocked("CreateDocumentLink", err)
	err = env.svc.RevokeDocumentLink(ctx, member, mf.Document.ID, "01LINK00000000000000000000")
	assertLocked("RevokeDocumentLink", err)
	_, _, err = env.svc.GrantDocumentBreakGlass(ctx, owner, mf.Document.ID, "Emergency audit check on folder")
	assertLocked("GrantDocumentBreakGlass", err)

	// 4. Move My Folder itself or under another folder -> 409 my_folder_locked.
	pos := 10.0
	_, err = env.svc.MoveDocument(ctx, member, mf.Document.ID, MoveDocumentInput{
		ParentID: "", Position: &pos, Revision: mf.Document.Revision, IdempotencyKey: "move-mf-root",
	})
	assertLocked("MoveDocument(self at root)", err)
	_, err = env.svc.MoveDocument(ctx, member, mf.Document.ID, MoveDocumentInput{
		ParentID: otherFolder.Document.ID, Revision: mf.Document.Revision, IdempotencyKey: "move-mf-under-other",
	})
	assertLocked("MoveDocument(under other folder)", err)

	// Non-admin non-owner member still gets ErrNotFound (no existence oracle).
	if _, err := env.svc.ArchiveDocument(ctx, creator, mf.Document.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger ArchiveDocument = %v, want ErrNotFound", err)
	}
	if _, err := env.svc.MoveDocument(ctx, creator, mf.Document.ID, MoveDocumentInput{Revision: 1}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger MoveDocument = %v, want ErrNotFound", err)
	}

	// 5. Items inside My Folder: create (inherits restricted), rename, share, move out/in, archive all work.
	if _, err := env.svc.CreatePage(ctx, creator, env.tn.wsA, CreatePageInput{
		Title: "Intruder", ParentID: mf.Document.ID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other member creating inside My Folder = %v, want ErrNotFound", err)
	}
	child, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{
		Title: "Inside My Folder", ParentID: mf.Document.ID,
	})
	if err != nil {
		t.Fatalf("create child inside My Folder: %v", err)
	}
	if child.Document.Visibility != "restricted" {
		t.Fatalf("child visibility = %q, want restricted", child.Document.Visibility)
	}
	renamedChildTitle := "Renamed Inside My Folder"
	child, err = env.svc.UpdateDocument(ctx, member, child.Document.ID, UpdateDocumentInput{
		Title: &renamedChildTitle, Revision: child.Document.Revision,
	})
	if err != nil {
		t.Fatalf("rename child inside My Folder: %v", err)
	}
	if _, err := env.svc.ShareDocument(ctx, member, child.Document.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: env.tn.creator.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatalf("share child inside My Folder: %v", err)
	}
	child, err = env.svc.MoveDocument(ctx, member, child.Document.ID, MoveDocumentInput{
		ParentID: otherFolder.Document.ID, Revision: child.Document.Revision, IdempotencyKey: "move-child-out",
	})
	if err != nil {
		t.Fatalf("move child out of My Folder: %v", err)
	}
	child, err = env.svc.MoveDocument(ctx, member, child.Document.ID, MoveDocumentInput{
		ParentID: mf.Document.ID, Revision: child.Document.Revision, IdempotencyKey: "move-child-in",
	})
	if err != nil {
		t.Fatalf("move child back into My Folder: %v", err)
	}
	if _, err := env.svc.ArchiveDocument(ctx, member, child.Document.ID, ArchiveDocumentInput{IdempotencyKey: "arch-child"}); err != nil {
		t.Fatalf("archive child inside My Folder: %v", err)
	}
}
