package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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

// MF-3: destination="my_folder" on CreatePage (page and folder), CreateFileDocument,
// and CreateBlankFile lazily creates the caller's My Folder in the same tx, places
// the child inside it with inherited restricted visibility, rolls back My Folder
// if child creation fails, validates mutual exclusion with parent_id and allowlist,
// and includes destination in the idempotency fingerprint.
func TestCreateWithMyFolderDestination(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := env.f.ctx
	member := human(env.tn.member)
	creator := human(env.tn.creator)
	owner := human(env.tn.owner)
	office := NewDocumentOfficeService(DocumentOfficeOptions{
		Pool: env.f.pool, Queries: env.f.q, Files: env.fs, Documents: env.svc,
	})

	// 1. Validation: unknown destination or destination="my_folder" + parent_id -> 400 invalid_destination.
	for _, tc := range []struct {
		name        string
		destination string
		parentID    string
	}{
		{"unknown destination", "root", ""},
		{"both parent_id and destination", "my_folder", "01J8X4DOC0N1P2Q3R4S5T6U7"},
	} {
		_, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{
			Title: "Bad", Destination: tc.destination, ParentID: tc.parentID,
		})
		if ce := wantCode(t, err, "invalid_destination"); ce.Status != 400 {
			t.Fatalf("CreatePage(%s) status = %d, want 400", tc.name, ce.Status)
		}
		_, err = env.svc.CreateFileDocument(ctx, member, env.tn.wsA, CreateFileDocumentInput{
			Title: "Bad", Filename: "bad.pdf", Body: bytes.NewReader(pdfBody("bad")),
			Destination: tc.destination, ParentID: tc.parentID,
		})
		if ce := wantCode(t, err, "invalid_destination"); ce.Status != 400 {
			t.Fatalf("CreateFileDocument(%s) status = %d, want 400", tc.name, ce.Status)
		}
		_, err = office.CreateBlankFile(ctx, member, env.tn.wsA, BlankFileInput{
			Format: "docx", Title: "Bad", Destination: tc.destination, ParentID: tc.parentID,
		})
		if ce := wantCode(t, err, "invalid_destination"); ce.Status != 400 {
			t.Fatalf("CreateBlankFile(%s) status = %d, want 400", tc.name, ce.Status)
		}
	}

	// 2. Rollback atomicity: if child creation fails inside the transaction (e.g. quota exceeded),
	// the newly-created My Folder rolls back with it.
	env.setStorageLimit(t, 1)
	_, err := env.svc.CreateFileDocument(ctx, member, env.tn.wsA, CreateFileDocumentInput{
		Title: "Over Quota", Filename: "over.pdf", Body: bytes.NewReader(pdfBody("over-quota")),
		Destination: DocumentSystemKindMyFolder,
	})
	wantCode(t, err, "quota_exceeded")
	if _, err := env.f.q.GetMyFolder(ctx, db.GetMyFolderParams{
		OrganizationID: env.tn.orgID, WorkspaceID: env.tn.wsA, AclOwnerID: pgtype.Text{String: member.ID, Valid: true},
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("expected My Folder to roll back when child create failed, got err=%v", err)
	}
	env.setStorageLimit(t, 1<<40)

	// 3. CreatePage (page + folder) with destination="my_folder" when member has no My Folder yet:
	// lazily creates My Folder, places page inside it, defaults visibility=restricted, includes My Folder in breadcrumbs,
	// and writes two document.created audit + outbox rows on first create and one on subsequent creates.
	pageKey := "mf-page-" + util.NewID()
	pageView, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{
		Title: "Draft Page", Destination: DocumentSystemKindMyFolder, IdempotencyKey: pageKey,
	})
	if err != nil {
		t.Fatalf("CreatePage(destination=my_folder): %v", err)
	}
	mf, err := env.f.q.GetMyFolder(ctx, db.GetMyFolderParams{
		OrganizationID: env.tn.orgID, WorkspaceID: env.tn.wsA, AclOwnerID: pgtype.Text{String: member.ID, Valid: true},
	})
	if err != nil {
		t.Fatalf("GetMyFolder after CreatePage: %v", err)
	}
	if !pageView.Document.ParentID.Valid || pageView.Document.ParentID.String != mf.ID {
		t.Fatalf("page parent_id = %+v, want %q", pageView.Document.ParentID, mf.ID)
	}
	if pageView.Document.Visibility != documentVisibilityRestricted {
		t.Fatalf("page visibility = %q, want restricted", pageView.Document.Visibility)
	}
	if len(pageView.Breadcrumbs) != 1 || pageView.Breadcrumbs[0].ID != mf.ID {
		t.Fatalf("page breadcrumbs = %+v, want [%s]", pageView.Breadcrumbs, mf.ID)
	}
	if n := env.countAudit(t, audit.ActionDocumentCreated, mf.ID); n != 1 {
		t.Fatalf("My Folder audit count = %d, want 1", n)
	}
	if n := env.countAudit(t, audit.ActionDocumentCreated, pageView.Document.ID); n != 1 {
		t.Fatalf("page audit count = %d, want 1", n)
	}

	// Subsequent folder create in member's My Folder writes only the child's audit row.
	subFolder, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{
		Kind: DocumentKindFolder, Title: "Subfolder", Destination: DocumentSystemKindMyFolder,
	})
	if err != nil {
		t.Fatalf("CreatePage(folder, destination=my_folder): %v", err)
	}
	if subFolder.Document.ParentID.String != mf.ID || subFolder.Document.Visibility != documentVisibilityRestricted {
		t.Fatalf("subfolder parent=%q vis=%q, want %q/restricted", subFolder.Document.ParentID.String, subFolder.Document.Visibility, mf.ID)
	}
	if n := env.countAudit(t, audit.ActionDocumentCreated, mf.ID); n != 1 {
		t.Fatalf("My Folder audit count after second create = %d, want 1", n)
	}

	// Idempotency for CreatePage: replay with destination="my_folder" succeeds; mismatching destination fails.
	replayPage, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{
		Title: "Draft Page", Destination: DocumentSystemKindMyFolder, IdempotencyKey: pageKey,
	})
	if err != nil || replayPage.Document.ID != pageView.Document.ID {
		t.Fatalf("CreatePage replay = %v, %v", replayPage.Document.ID, err)
	}
	_, err = env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{
		Title: "Draft Page", IdempotencyKey: pageKey,
	})
	wantCode(t, err, "idempotency_payload_mismatch")
	_, err = env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{
		Title: "Draft Page", ParentID: mf.ID, IdempotencyKey: pageKey,
	})
	wantCode(t, err, "idempotency_payload_mismatch")

	// 4. CreateFileDocument with destination="my_folder" for creator (who has no My Folder yet).
	fileBytes := pdfBody("mf-file-" + util.NewID())
	fileKey := "mf-file-" + util.NewID()
	fileRes, err := env.svc.CreateFileDocument(ctx, creator, env.tn.wsA, CreateFileDocumentInput{
		Title: "Uploaded PDF", Filename: "up.pdf", Body: bytes.NewReader(fileBytes),
		Destination: DocumentSystemKindMyFolder, IdempotencyKey: fileKey,
	})
	if err != nil {
		t.Fatalf("CreateFileDocument(destination=my_folder): %v", err)
	}
	creatorMF, err := env.f.q.GetMyFolder(ctx, db.GetMyFolderParams{
		OrganizationID: env.tn.orgID, WorkspaceID: env.tn.wsA, AclOwnerID: pgtype.Text{String: creator.ID, Valid: true},
	})
	if err != nil {
		t.Fatalf("GetMyFolder(creator): %v", err)
	}
	if fileRes.Document.ParentID.String != creatorMF.ID || fileRes.Document.Visibility != documentVisibilityRestricted {
		t.Fatalf("file parent=%q vis=%q, want %q/restricted", fileRes.Document.ParentID.String, fileRes.Document.Visibility, creatorMF.ID)
	}
	fileReplay, err := env.svc.CreateFileDocument(ctx, creator, env.tn.wsA, CreateFileDocumentInput{
		Title: "Uploaded PDF", Filename: "up.pdf", Body: bytes.NewReader(fileBytes),
		Destination: DocumentSystemKindMyFolder, IdempotencyKey: fileKey,
	})
	if err != nil || fileReplay.Document.ID != fileRes.Document.ID {
		t.Fatalf("CreateFileDocument replay = %v, %v", fileReplay.Document.ID, err)
	}
	_, err = env.svc.CreateFileDocument(ctx, creator, env.tn.wsA, CreateFileDocumentInput{
		Title: "Uploaded PDF", Filename: "up.pdf", Body: bytes.NewReader(fileBytes),
		IdempotencyKey: fileKey,
	})
	wantCode(t, err, "idempotency_payload_mismatch")

	// 5. CreateBlankFile with destination="my_folder" for owner (who has no My Folder yet).
	blankKey := "mf-blank-" + util.NewID()
	blankRes, err := office.CreateBlankFile(ctx, owner, env.tn.wsA, BlankFileInput{
		Format: "docx", Title: "Blank Doc", Destination: DocumentSystemKindMyFolder, IdempotencyKey: blankKey,
	})
	if err != nil {
		t.Fatalf("CreateBlankFile(destination=my_folder): %v", err)
	}
	ownerMF, err := env.f.q.GetMyFolder(ctx, db.GetMyFolderParams{
		OrganizationID: env.tn.orgID, WorkspaceID: env.tn.wsA, AclOwnerID: pgtype.Text{String: owner.ID, Valid: true},
	})
	if err != nil {
		t.Fatalf("GetMyFolder(owner): %v", err)
	}
	if blankRes.Document.ParentID.String != ownerMF.ID || blankRes.Document.Visibility != documentVisibilityRestricted {
		t.Fatalf("blank parent=%q vis=%q, want %q/restricted", blankRes.Document.ParentID.String, blankRes.Document.Visibility, ownerMF.ID)
	}
	blankReplay, err := office.CreateBlankFile(ctx, owner, env.tn.wsA, BlankFileInput{
		Format: "docx", Title: "Blank Doc", Destination: DocumentSystemKindMyFolder, IdempotencyKey: blankKey,
	})
	if err != nil || blankReplay.Document.ID != blankRes.Document.ID {
		t.Fatalf("CreateBlankFile replay = %v, %v", blankReplay.Document.ID, err)
	}
	_, err = office.CreateBlankFile(ctx, owner, env.tn.wsA, BlankFileInput{
		Format: "docx", Title: "Blank Doc", IdempotencyKey: blankKey,
	})
	wantCode(t, err, "idempotency_payload_mismatch")
	_, err = office.CreateBlankFile(ctx, owner, env.tn.wsA, BlankFileInput{
		Format: "docx", Title: "Blank Doc", ParentID: ownerMF.ID, IdempotencyKey: blankKey,
	})
	wantCode(t, err, "idempotency_payload_mismatch")
}

// MF-6 + Decision B: Member A's My Folder is hidden from Member B AND from
// workspace owner/admin in tree, root list, flat list, and search; workspace
// admin sees only their own My Folder when ensured, sees restricted child items
// inside A's My Folder in flat list/search as admin_scope metadata-only rows
// with empty Path (not exposing A's My Folder), and gets 403 document_restricted
// on direct GetDocument(A's My Folder). Sharing a child inside A's My Folder
// with Member B lets B open and list the child while A's My Folder stays hidden.
func TestMyFolderVisibilityAndAdminHide(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := env.f.ctx
	memberA := human(env.tn.member)
	memberB := human(env.tn.creator)
	admin := human(env.tn.owner) // workspace owner (seeAll = true)

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
	sharedChild, err := env.svc.CreatePage(ctx, memberA, env.tn.wsA, CreatePageInput{
		Title: "Shared Inside My Folder", Destination: DocumentSystemKindMyFolder,
	})
	if err != nil {
		t.Fatalf("CreatePage(sharedChild): %v", err)
	}
	if _, err := env.svc.ShareDocument(ctx, memberA, sharedChild.Document.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: memberB.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatalf("ShareDocument(sharedChild -> memberB): %v", err)
	}

	containsTreeID := func(nodes []DocumentTreeNode, wantID string) bool {
		var walk func([]DocumentTreeNode) bool
		walk = func(ns []DocumentTreeNode) bool {
			for _, n := range ns {
				if n.ID == wantID || walk(n.Children) {
					return true
				}
			}
			return false
		}
		return walk(nodes)
	}
	containsListID := func(page DocumentListPage, wantID string) (*DocumentListItem, bool) {
		for i := range page.Items {
			if page.Items[i].Document.ID == wantID {
				return &page.Items[i], true
			}
		}
		return nil, false
	}

	// 1. Member A sees their own My Folder (with SystemKind="my_folder") in tree and root list.
	treeA, err := env.svc.DocumentTree(ctx, memberA, env.tn.wsA, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if !containsTreeID(treeA, mfA.Document.ID) || !containsTreeID(treeA, privateChild.Document.ID) {
		t.Fatalf("memberA tree missing own My Folder or child: %+v", treeA)
	}
	for _, n := range treeA {
		if n.ID == mfA.Document.ID && n.SystemKind != DocumentSystemKindMyFolder {
			t.Fatalf("memberA tree My Folder SystemKind = %q, want %q", n.SystemKind, DocumentSystemKindMyFolder)
		}
	}

	// 2. Member B does NOT see A's My Folder or privateChild in tree, root list, flat list, or search;
	// Member B DOES see sharedChild in SharedWithMe and flat list/search, with no breadcrumbs/path to A's My Folder.
	treeB, err := env.svc.DocumentTree(ctx, memberB, env.tn.wsA, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if containsTreeID(treeB, mfA.Document.ID) || containsTreeID(treeB, privateChild.Document.ID) || containsTreeID(treeB, sharedChild.Document.ID) {
		t.Fatalf("memberB tree leaked A's My Folder or children: %+v", treeB)
	}
	rootStr := ""
	rootsB, err := env.svc.ListDocuments(ctx, memberB, env.tn.wsA, ListDocumentsInput{ParentID: &rootStr})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := containsListID(rootsB, mfA.Document.ID); ok {
		t.Fatal("memberB root list leaked A's My Folder")
	}
	searchMFByB, err := env.svc.ListDocuments(ctx, memberB, env.tn.wsA, ListDocumentsInput{Query: "My Folder"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := containsListID(searchMFByB, mfA.Document.ID); ok {
		t.Fatal("memberB search leaked A's My Folder")
	}
	sharedViewB, err := env.svc.GetDocument(ctx, memberB, sharedChild.Document.ID)
	if err != nil {
		t.Fatalf("memberB GetDocument(sharedChild): %v", err)
	}
	if len(sharedViewB.Breadcrumbs) != 0 {
		t.Fatalf("memberB sharedChild breadcrumbs = %+v, want empty (My Folder hidden)", sharedViewB.Breadcrumbs)
	}
	searchSharedByB, err := env.svc.ListDocuments(ctx, memberB, env.tn.wsA, ListDocumentsInput{Query: "Shared Inside"})
	if err != nil {
		t.Fatal(err)
	}
	if item, ok := containsListID(searchSharedByB, sharedChild.Document.ID); !ok || len(item.Path) != 0 {
		t.Fatalf("memberB search sharedChild = %v path=%+v, want present with empty path", ok, item)
	}

	// 3. Workspace admin/owner (seeAll=true): does NOT see A's My Folder in tree, root list, flat list, or search;
	// sees only their own My Folder when ensured.
	mfAdmin, _, err := env.svc.EnsureMyFolder(ctx, admin, env.tn.wsA)
	if err != nil {
		t.Fatalf("EnsureMyFolder(admin): %v", err)
	}
	treeAdmin, err := env.svc.DocumentTree(ctx, admin, env.tn.wsA, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if containsTreeID(treeAdmin, mfA.Document.ID) || containsTreeID(treeAdmin, privateChild.Document.ID) {
		t.Fatalf("admin tree leaked A's My Folder or its unshared child: %+v", treeAdmin)
	}
	if !containsTreeID(treeAdmin, mfAdmin.Document.ID) {
		t.Fatalf("admin tree missing admin's own My Folder: %+v", treeAdmin)
	}
	rootsAdmin, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{ParentID: &rootStr})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := containsListID(rootsAdmin, mfA.Document.ID); ok {
		t.Fatal("admin root list leaked A's My Folder")
	}
	if _, ok := containsListID(rootsAdmin, mfAdmin.Document.ID); !ok {
		t.Fatal("admin root list missing admin's own My Folder")
	}
	flatAdmin, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := containsListID(flatAdmin, mfA.Document.ID); ok {
		t.Fatal("admin flat list leaked A's My Folder")
	}
	if item, ok := containsListID(flatAdmin, privateChild.Document.ID); !ok || !item.Access.AdminScope || item.Access.Level != DocumentLevelNone {
		t.Fatalf("admin flat list privateChild = %v access=%+v, want AdminScope/LevelNone", ok, item)
	}
	searchMFAdmin, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{Query: "My Folder"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := containsListID(searchMFAdmin, mfA.Document.ID); ok {
		t.Fatal("admin search leaked A's My Folder")
	}
	if _, ok := containsListID(searchMFAdmin, mfAdmin.Document.ID); !ok {
		t.Fatal("admin search missing admin's own My Folder")
	}
	searchChildAdmin, err := env.svc.ListDocuments(ctx, admin, env.tn.wsA, ListDocumentsInput{Query: "Secret Inside"})
	if err != nil {
		t.Fatal(err)
	}
	if item, ok := containsListID(searchChildAdmin, privateChild.Document.ID); !ok || !item.Access.AdminScope || len(item.Path) != 0 {
		t.Fatalf("admin search privateChild = %v item=%+v, want AdminScope with empty Path", ok, item)
	}

	// Direct GetDocument(A's My Folder) by non-owner workspace admin -> 403 document_restricted (not 200).
	_, err = env.svc.GetDocument(ctx, admin, mfA.Document.ID)
	if ce := wantCode(t, err, "document_restricted"); ce.Status != 403 {
		t.Fatalf("admin GetDocument(mfA) = %+v, want 403 document_restricted", ce)
	}
}
