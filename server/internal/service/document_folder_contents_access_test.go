package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func createTestFolder(t *testing.T, f *docPermFixture, actor Actor, wsID, title string, parentID *string) db.Document {
	t.Helper()
	var pid string
	if parentID != nil {
		pid = *parentID
	}
	v, err := f.svc.CreatePage(f.ctx, actor, wsID, CreatePageInput{
		Title:    title,
		Kind:     DocumentKindFolder,
		ParentID: pid,
	})
	if err != nil {
		t.Fatalf("createTestFolder(%q): %v", title, err)
	}
	return v.Document
}

func createTestPageInParent(t *testing.T, f *docPermFixture, actor Actor, wsID, title, visibility string, parentID *string) db.Document {
	t.Helper()
	var pid string
	if parentID != nil {
		pid = *parentID
	}
	v, err := f.svc.CreatePage(f.ctx, actor, wsID, CreatePageInput{
		Title:      title,
		Kind:       DocumentKindPage,
		Visibility: visibility,
		ParentID:   pid,
	})
	if err != nil {
		t.Fatalf("createTestPageInParent(%q): %v", title, err)
	}
	return v.Document
}

// runFolderContentsAccessBatchChunk locks batchID with FOR UPDATE SKIP LOCKED
// (LockDocumentAccessBatchForChunk) and runs one worker chunk on that specific
// batch, returning true when the batch was queued/running and processed, or
// false when the batch was already terminal. Tests that verify a specific
// batch's chunk progression use this helper so foreign queued batches left in
// the shared test database cannot steal a worker tick or be mutated.
func runFolderContentsAccessBatchChunk(t *testing.T, f *docPermFixture, batchID string, chunkSize int) bool {
	t.Helper()
	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatalf("begin batch chunk tx (%s): %v", batchID, err)
	}
	defer func() { _ = tx.Rollback(f.ctx) }()
	q := f.svc.q.WithTx(tx)

	batch, err := q.LockDocumentAccessBatchForChunk(f.ctx, batchID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false
	}
	if err != nil {
		t.Fatalf("lock batch %s for chunk: %v", batchID, err)
	}
	if err := f.svc.processFolderContentsAccessChunk(f.ctx, q, batch, chunkSize); err != nil {
		t.Fatalf("process batch %s chunk: %v", batchID, err)
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatalf("commit batch %s chunk: %v", batchID, err)
	}
	return true
}

// TestFolderContentsAccessModesAndSubtreeScope covers UNI-2244 §1–§3, §6:
//   - merge mode (keep max level, never downgrade, merge home workspace into visibility+workspace_level)
//   - replace mode (set exact target set, revoke others, missing home workspace -> restricted, empty items -> private)
//   - subtree scope (nested folders, pages inside pages, excluding folders themselves, excluding Trash, excluding another person's My Folder subtree, counting skipped_not_manageable and skipped_locked, preserving acl_owner_id and public links)
//   - root not a folder -> 422 not_a_folder; unreadable root -> 404
//   - invalid principal -> 422 document_access_rejected with nothing written
//   - dry_run preview counts (changed, unchanged, skipped_not_manageable, skipped_locked, losing_users, downgraded_users) and warnings (wide_scope, downgrade, to_private) without writing or auditing
//   - audit metadata (via:"folder_contents", batch_id on child rows, document.contents_access_updated on folder)
func TestFolderContentsAccessModesAndSubtreeScope(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "fca1")
	foreign := f.tenant(t, "fca1f")
	f.withLinks(t)
	H := Human
	actor := H(tn.aclOwner.ID)

	// 1. Root not a folder -> 422 not_a_folder.
	plainPage := createTestPageInParent(t, f, actor, tn.wsA, "Not a folder", "restricted", nil)
	_, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, plainPage.ID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeReplace,
	})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Status != 422 || ce.Code != "not_a_folder" {
		t.Fatalf("page root = %v, want 422 not_a_folder", err)
	}

	// Unreadable / foreign root -> 404.
	if _, err := f.svc.UpdateFolderContentsAccess(f.ctx, H(foreign.owner.ID), plainPage.ID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeReplace,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign root = %v, want ErrNotFound", err)
	}

	// 2. Build a folder tree:
	//   rootFolder
	//     ├── page1 (manageable by aclOwner, restricted, outsider has edit)
	//     │     └── subPage1 (page inside page1, manageable by aclOwner, workspace-visible view)
	//     ├── subFolder
	//     │     ├── page2 (manageable by aclOwner, restricted)
	//     │     ├── unmanageablePage (created/owned by member, restricted -> aclOwner cannot administer)
	//     │     └── trashedPage (archived -> excluded from total)
	rootFolder := createTestFolder(t, f, actor, tn.wsA, "Root Folder", nil)
	rootID := rootFolder.ID

	page1 := createTestPageInParent(t, f, actor, tn.wsA, "Page 1", "restricted", &rootID)
	f.share(t, page1, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelEdit, tn.aclOwner.ID)
	f.share(t, page1, DocumentPrincipalUser, tn.bMember.ID, DocumentLevelView, tn.aclOwner.ID)

	// Public link on page1 must survive both merge and replace.
	if _, err := f.svc.SetDocumentPublicLinks(f.ctx, H(tn.owner.ID), tn.orgID, true); err != nil {
		t.Fatal(err)
	}
	linkView, err := f.svc.CreateDocumentLink(f.ctx, actor, page1.ID, 0)
	if err != nil {
		t.Fatal(err)
	}

	page1ID := page1.ID
	subPage1 := createTestPageInParent(t, f, actor, tn.wsA, "Child Page of Page 1", "workspace", &page1ID)
	subPage1 = setWorkspaceLevel(t, f, subPage1, "view")

	subFolder := createTestFolder(t, f, actor, tn.wsA, "Sub Folder", &rootID)
	subFolderID := subFolder.ID
	page2 := createTestPageInParent(t, f, actor, tn.wsA, "Page 2", "restricted", &subFolderID)

	unmanageablePage := createTestPageInParent(t, f, H(tn.member.ID), tn.wsA, "Member Private Page", "restricted", &subFolderID)

	// Note: Work Product documents (owner_kind = 'work_product') cannot sit inside a folder
	// subtree per documents_owned_no_parent_check; the skipped_locked branch is covered by
	// TestFolderContentsAccessSkipsLockedOwnedDocument below.
	trashedPage := createTestPageInParent(t, f, actor, tn.wsA, "Trashed Page", "restricted", &subFolderID)
	if _, err := f.svc.ArchiveDocument(f.ctx, actor, trashedPage.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}

	// Also verify another person's My Folder is excluded even if nested or queried:
	memberMF, _, err := f.svc.EnsureMyFolder(f.ctx, H(tn.member.ID), tn.wsA)
	if err != nil {
		t.Fatal(err)
	}
	mfID := memberMF.Document.ID
	_ = createTestPageInParent(t, f, H(tn.member.ID), tn.wsA, "Inside Member MyFolder", "restricted", &mfID)

	// 3. Invalid principal -> 422 document_access_rejected, nothing written.
	_, err = f.svc.UpdateFolderContentsAccess(f.ctx, actor, rootID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeMerge,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: foreign.owner.ID, Level: DocumentLevelView},
		},
	})
	rej := rejectedItemsFromError(t, err)
	if len(rej) != 1 || rej[0].Code != "principal_not_in_organization" {
		t.Fatalf("rejected = %+v, want principal_not_in_organization", rej)
	}

	// 4. Dry-run preview on merge mode:
	// Total in subtree = 4 (page1, subPage1, page2, unmanageablePage; rootFolder & subFolder & trashedPage excluded).
	// Manageable = 3 (page1, subPage1, page2), skipped_not_manageable = 1, skipped_locked = 0.
	// Granting outsider view + home workspace edit:
	// - page1: outsider already has edit (kept at edit), home workspace restricted -> workspace/edit (changed)
	// - subPage1: outsider none -> view, home workspace view -> edit (changed)
	// - page2: outsider none -> view, home workspace restricted -> edit (changed)
	dryMerge, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, rootID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeMerge,
		DryRun: true,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelEdit},
		},
	})
	if err != nil {
		t.Fatalf("dry_run merge: %v", err)
	}
	if !dryMerge.DryRun || dryMerge.Total != 4 || dryMerge.Preview.Changed != 3 || dryMerge.Preview.Unchanged != 0 ||
		dryMerge.Preview.SkippedNotManageable != 1 || dryMerge.Preview.SkippedLocked != 0 ||
		dryMerge.Preview.LosingUsers != 0 || dryMerge.Preview.DowngradedUsers != 0 || len(dryMerge.Preview.Warnings) != 0 {
		t.Fatalf("dryMerge = %+v", dryMerge)
	}

	// Verify dry-run wrote no document_access_batches row and no audit row.
	var batchCount int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_access_batches WHERE folder_id = $1`, rootID).Scan(&batchCount); err != nil || batchCount != 0 {
		t.Fatalf("dry_run batchCount = %d, err = %v, want 0", batchCount, err)
	}

	// 5. Execute sync merge mode.
	syncMerge, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, rootID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeMerge,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelEdit},
		},
	})
	if err != nil {
		t.Fatalf("sync merge: %v", err)
	}
	if syncMerge.ExecMode != FolderContentsAccessExecSync || syncMerge.BatchID == "" ||
		syncMerge.Total != 4 || syncMerge.Changed != 3 || syncMerge.Unchanged != 0 ||
		syncMerge.SkippedNotManageable != 1 || syncMerge.SkippedLocked != 0 {
		t.Fatalf("syncMerge = %+v", syncMerge)
	}

	// Re-running the exact same merge is a no-op (Changed=0, Unchanged=3).
	syncMergeAgain, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, rootID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeMerge,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelEdit},
		},
	})
	if err != nil {
		t.Fatalf("sync merge repeat: %v", err)
	}
	if syncMergeAgain.Changed != 0 || syncMergeAgain.Unchanged != 3 {
		t.Fatalf("syncMergeAgain = %+v, want Changed=0 Unchanged=3", syncMergeAgain)
	}

	// Check page1: outsider kept edit (never downgraded by merge view), bMember kept view, home ws is workspace/edit.
	if got := level(t, f, H(tn.outsider.ID), reloadDoc(t, f, page1.ID)); got != DocumentLevelEdit {
		t.Fatalf("page1 outsider level after merge = %q, want edit", got)
	}
	if got := level(t, f, H(tn.bMember.ID), reloadDoc(t, f, page1.ID)); got != DocumentLevelView {
		t.Fatalf("page1 bMember level after merge = %q, want view", got)
	}
	if got := level(t, f, H(tn.creator.ID), reloadDoc(t, f, page2.ID)); got != DocumentLevelEdit {
		t.Fatalf("page2 workspace member level after merge = %q, want edit", got)
	}
	if got := level(t, f, H(tn.outsider.ID), reloadDoc(t, f, subPage1.ID)); got != DocumentLevelView {
		t.Fatalf("subPage1 outsider level after merge = %q, want view", got)
	}
	if got := level(t, f, H(tn.creator.ID), reloadDoc(t, f, subPage1.ID)); got != DocumentLevelEdit {
		t.Fatalf("subPage1 workspace member level after merge = %q, want edit", got)
	}

	// Verify audit rows: child documents carry batch_id + via:"folder_contents"; folder carries document.contents_access_updated.
	var viaVal string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT metadata::jsonb->>'via' FROM audit_events WHERE resource_id = $1 AND metadata::jsonb->>'batch_id' = $2 LIMIT 1`,
		page2.ID, syncMerge.BatchID).Scan(&viaVal); err != nil || viaVal != FolderContentsAccessVia {
		t.Fatalf("child audit metadata.via = %q (err=%v), want %q", viaVal, err, FolderContentsAccessVia)
	}
	var folderAuditMeta string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT metadata FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->>'batch_id' = $3`,
		audit.ActionDocumentContentsAccessUpdated, rootID, syncMerge.BatchID).Scan(&folderAuditMeta); err != nil {
		t.Fatalf("folder contents_access_updated audit row missing: %v", err)
	}

	// Verify per-share document.shared events suppress notify_user_id for via=folder_contents,
	// while document_access_batches.notified_levels records outsider (count=2, level="view")
	// and document_access_batch.completed is emitted for the sync batch (F5).
	var notifyEvents int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = 'document.shared' AND payload::jsonb->>'notify_user_id' = $1`,
		tn.outsider.ID).Scan(&notifyEvents); err != nil || notifyEvents != 0 {
		t.Fatalf("outsider per-share notify_user_id event count = %d (err=%v), want 0 (suppressed for folder_contents)", notifyEvents, err)
	}
	var syncNotifiedRaw []byte
	if err := f.pool.QueryRow(f.ctx,
		`SELECT notified_levels FROM document_access_batches WHERE id = $1`,
		syncMerge.BatchID).Scan(&syncNotifiedRaw); err != nil {
		t.Fatalf("read sync batch notified_levels: %v", err)
	}
	var syncNotified map[string]FolderContentsRecipientNotice
	if err := json.Unmarshal(syncNotifiedRaw, &syncNotified); err != nil {
		t.Fatalf("unmarshal sync notified_levels: %v", err)
	}
	if got := syncNotified[tn.outsider.ID]; got.Level != string(DocumentLevelView) || got.Count != 2 {
		t.Fatalf("sync notified_levels[outsider] = %+v, want level=view count=2 (subPage1 + page2)", got)
	}
	var syncCompletedEvents int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = 'document_access_batch.completed' AND payload::jsonb->>'batch_id' = $1`,
		syncMerge.BatchID).Scan(&syncCompletedEvents); err != nil || syncCompletedEvents != 1 {
		t.Fatalf("sync document_access_batch.completed count = %d (err=%v), want 1", syncCompletedEvents, err)
	}

	// 6. Dry-run replace mode with downgrade + to_private warnings and empty-items to_private warning:
	// Replace with only outsider=view (omitting home workspace and bMember):
	// - bMember loses access on page1 (losing_users >= 1), workspace members without direct shares lose access on page1/subPage1/page2
	// - outsider is downgraded from edit -> view on page1 (downgraded_users >= 1)
	// - page1/subPage1/page2 lose their home-workspace share (visibility workspace -> restricted)
	// -> warnings includes both "downgrade" and "to_private".
	dryReplaceDowngrade, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, rootID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeReplace,
		DryRun: true,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
		},
	})
	if err != nil {
		t.Fatalf("dry_run replace downgrade: %v", err)
	}
	if dryReplaceDowngrade.Preview.LosingUsers == 0 || dryReplaceDowngrade.Preview.DowngradedUsers == 0 ||
		!slices.Contains(dryReplaceDowngrade.Preview.Warnings, FolderContentsAccessWarningDowngrade) ||
		!slices.Contains(dryReplaceDowngrade.Preview.Warnings, FolderContentsAccessWarningToPrivate) {
		t.Fatalf("dryReplaceDowngrade = %+v, want losing>0, downgraded>0 and warnings downgrade+to_private", dryReplaceDowngrade.Preview)
	}

	// Dry-run replace with empty items -> warning "to_private".
	dryToPrivate, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, rootID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeReplace,
		DryRun: true,
		Items:  []FolderContentsAccessItem{},
	})
	if err != nil {
		t.Fatalf("dry_run replace empty: %v", err)
	}
	if !slices.Contains(dryToPrivate.Preview.Warnings, FolderContentsAccessWarningToPrivate) {
		t.Fatalf("dryToPrivate warnings = %v, want to_private", dryToPrivate.Preview.Warnings)
	}

	// 7. Execute sync replace mode with empty items (back to private):
	// revokes all live shares on manageable docs and sets visibility='restricted',
	// while preserving acl_owner_id and public links.
	syncReplace, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, rootID, UpdateFolderContentsAccessInput{
		Mode:  FolderContentsAccessModeReplace,
		Items: []FolderContentsAccessItem{},
	})
	if err != nil {
		t.Fatalf("sync replace to private: %v", err)
	}
	if syncReplace.Changed != 3 || syncReplace.SkippedNotManageable != 1 || syncReplace.SkippedLocked != 0 {
		t.Fatalf("syncReplace = %+v", syncReplace)
	}
	p1After := reloadDoc(t, f, page1.ID)
	if p1After.Visibility != documentVisibilityRestricted || !p1After.AclOwnerID.Valid || p1After.AclOwnerID.String != tn.aclOwner.ID {
		t.Fatalf("page1 after replace = visibility %q acl_owner %v", p1After.Visibility, p1After.AclOwnerID)
	}
	if got := level(t, f, H(tn.outsider.ID), p1After); got != DocumentLevelNone {
		t.Fatalf("page1 outsider after replace empty = %q, want none", got)
	}
	// Public link on page1 is still intact.
	var activeLinks int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_share_links WHERE id = $1 AND revoked_at IS NULL`, linkView.Link.ID).Scan(&activeLinks); err != nil || activeLinks != 1 {
		t.Fatalf("page1 public link active count = %d (err=%v), want 1", activeLinks, err)
	}
	// Unmanageable page was untouched.
	unmgAfter := reloadDoc(t, f, unmanageablePage.ID)
	if !unmgAfter.AclOwnerID.Valid || unmgAfter.AclOwnerID.String != tn.member.ID {
		t.Fatalf("unmanageable page touched: %+v", unmgAfter)
	}
}

// TestFolderContentsAccessBackgroundWorkerAndRecovery covers UNI-2244 §3.1 step 6, §3.2, §4, §5:
//   - when total > FolderContentsAccessSyncMax (overridden in test), PUT queues a background batch (ExecMode="background")
//   - a second PUT on the same folder while queued/running returns 409 folder_access_batch_running with batch_id
//   - GET /contents-access/{batchID} returns progress to creator and 404 to any other user
//   - worker processes chunks in id order, updates cursor_id/processed/notified_levels per chunk, resumes after restart without re-processing completed chunks or re-notifying, and writes document.contents_access_updated + document.access_batch_completed on completion.
func TestFolderContentsAccessBackgroundWorkerAndRecovery(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "fcabg")
	H := Human
	actor := H(tn.aclOwner.ID)

	// Override sync threshold to 2 so a 5-document subtree queues a background batch.
	f.svc.SetFolderContentsAccessSyncMax(2)
	t.Cleanup(func() { f.svc.SetFolderContentsAccessSyncMax(0) })

	folder := createTestFolder(t, f, actor, tn.wsA, "BG Root Folder", nil)
	folderID := folder.ID

	docIDs := make([]string, 5)
	for i := range docIDs {
		d := createTestPageInParent(t, f, actor, tn.wsA, fmt.Sprintf("BG Doc %d", i+1), "restricted", &folderID)
		docIDs[i] = d.ID
	}
	slices.Sort(docIDs)

	// 1. Queue background batch (total=5 > threshold=2).
	res, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeMerge,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit},
		},
	})
	if err != nil {
		t.Fatalf("queue background batch: %v", err)
	}
	if res.ExecMode != FolderContentsAccessExecBackground || res.BatchID == "" || res.Total != 5 {
		t.Fatalf("background result = %+v, want mode=background total=5", res)
	}

	// 2. Concurrent PUT on the same folder while queued/running -> 409 folder_access_batch_running with batch_id.
	_, err = f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeReplace,
	})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Status != 409 || ce.Code != "folder_access_batch_running" || ce.Fields["batch_id"] != res.BatchID {
		t.Fatalf("second PUT while queued = %+v (err=%v), want 409 folder_access_batch_running batch_id=%s", ce, err, res.BatchID)
	}

	// 3. Creator reads queued progress; another workspace member gets 404.
	prog0, err := f.svc.GetFolderContentsAccessBatch(f.ctx, actor, folderID, res.BatchID)
	if err != nil {
		t.Fatalf("GetFolderContentsAccessBatch creator: %v", err)
	}
	if prog0.Status != FolderContentsAccessBatchStatusQueued || prog0.Total != 5 || prog0.Processed != 0 || prog0.FinishedAt != nil {
		t.Fatalf("initial progress = %+v", prog0)
	}
	if _, err := f.svc.GetFolderContentsAccessBatch(f.ctx, H(tn.member.ID), folderID, res.BatchID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-creator GetFolderContentsAccessBatch = %v, want ErrNotFound", err)
	}

	// 4. Worker chunk 1 (chunkSize=2): processes first 2 documents, status='running', cursor_id=docIDs[1].
	if !runFolderContentsAccessBatchChunk(t, f, res.BatchID, 2) {
		t.Fatal("chunk 1: batch not claimed")
	}
	prog1, err := f.svc.GetFolderContentsAccessBatch(f.ctx, actor, folderID, res.BatchID)
	if err != nil {
		t.Fatal(err)
	}
	if prog1.Status != FolderContentsAccessBatchStatusRunning || prog1.Processed != 2 || prog1.Changed != 2 || prog1.FinishedAt != nil {
		t.Fatalf("progress after chunk 1 = %+v, want status=running processed=2 changed=2", prog1)
	}

	// Chunk 2: resumes the 'running' batch from cursor_id without repeating docIDs[0..1].
	if !runFolderContentsAccessBatchChunk(t, f, res.BatchID, 2) {
		t.Fatal("chunk 2 after restart: batch not claimed")
	}
	prog2, err := f.svc.GetFolderContentsAccessBatch(f.ctx, actor, folderID, res.BatchID)
	if err != nil {
		t.Fatal(err)
	}
	if prog2.Status != FolderContentsAccessBatchStatusRunning || prog2.Processed != 4 || prog2.Changed != 4 {
		t.Fatalf("progress after chunk 2 = %+v, want processed=4 changed=4", prog2)
	}

	// Chunk 3: processes docIDs[4] and completes the batch.
	if !runFolderContentsAccessBatchChunk(t, f, res.BatchID, 2) {
		t.Fatal("chunk 3: batch not claimed")
	}
	prog3, err := f.svc.GetFolderContentsAccessBatch(f.ctx, actor, folderID, res.BatchID)
	if err != nil {
		t.Fatal(err)
	}
	if prog3.Status != FolderContentsAccessBatchStatusCompleted || prog3.Processed != 5 || prog3.Changed != 5 || prog3.FinishedAt == nil {
		t.Fatalf("progress after chunk 3 = %+v, want completed processed=5 changed=5 finished_at!=nil", prog3)
	}

	// Re-locking the completed batch finds nothing left to do.
	if runFolderContentsAccessBatchChunk(t, f, res.BatchID, 2) {
		t.Fatal("post-completion chunk lock claimed completed batch, want false")
	}

	// Verify each of the 5 documents was granted exactly once and outsider has edit on all 5.
	for _, id := range docIDs {
		if got := level(t, f, H(tn.outsider.ID), reloadDoc(t, f, id)); got != DocumentLevelEdit {
			t.Fatalf("doc %s outsider level = %q, want edit", id, got)
		}
		var shareAuditCount int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->>'batch_id' = $3`,
			audit.ActionDocumentShared, id, res.BatchID).Scan(&shareAuditCount); err != nil || shareAuditCount != 1 {
			t.Fatalf("doc %s share audit count = %d (err=%v), want 1 (no duplicate write across chunks)", id, shareAuditCount, err)
		}
	}

	// Verify per-share document.shared events suppress notify_user_id across all chunks,
	// while notified_levels accumulated count=5 level=edit for outsider across the 3 chunks (F5).
	var notifyCount int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = 'document.shared' AND payload::jsonb->>'notify_user_id' = $1`,
		tn.outsider.ID).Scan(&notifyCount); err != nil || notifyCount != 0 {
		t.Fatalf("background batch per-share notify_user_id count = %d (err=%v), want 0", notifyCount, err)
	}
	var bgNotifiedRaw []byte
	if err := f.pool.QueryRow(f.ctx,
		`SELECT notified_levels FROM document_access_batches WHERE id = $1`,
		res.BatchID).Scan(&bgNotifiedRaw); err != nil {
		t.Fatalf("read bg batch notified_levels: %v", err)
	}
	var bgNotified map[string]FolderContentsRecipientNotice
	if err := json.Unmarshal(bgNotifiedRaw, &bgNotified); err != nil {
		t.Fatalf("unmarshal bg notified_levels: %v", err)
	}
	if got := bgNotified[tn.outsider.ID]; got.Level != string(DocumentLevelEdit) || got.Count != 5 {
		t.Fatalf("bg notified_levels[outsider] = %+v, want level=edit count=5", got)
	}

	// Verify document_access_batch.completed outbox event was emitted with batch_id, folder_id, workspace_id.
	def, ok := outbox.Lookup("document_access_batch.completed")
	if !ok {
		t.Fatal("catalogue missing document_access_batch.completed")
	}
	var completedPayload string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT payload FROM outbox_events WHERE topic = 'document_access_batch.completed' AND payload::jsonb->>'batch_id' = $1`,
		res.BatchID).Scan(&completedPayload); err != nil {
		t.Fatalf("document_access_batch.completed event missing: %v", err)
	}
	var gotPayload map[string]string
	if err := json.Unmarshal([]byte(completedPayload), &gotPayload); err != nil {
		t.Fatalf("unmarshal document_access_batch.completed payload: %v", err)
	}
	gotKeys := make([]string, 0, len(gotPayload))
	for k := range gotPayload {
		gotKeys = append(gotKeys, k)
	}
	slices.Sort(gotKeys)
	wantKeys := slices.Clone(def.Payload)
	slices.Sort(wantKeys)
	if !slices.Equal(gotKeys, wantKeys) {
		t.Fatalf("document_access_batch.completed payload keys = %v, want catalogue keys %v", gotKeys, wantKeys)
	}
	if gotPayload["batch_id"] != res.BatchID || gotPayload["folder_id"] != folderID || gotPayload["workspace_id"] != tn.wsA {
		t.Fatalf("completedPayload = %v, want batch_id=%s folder_id=%s workspace_id=%s", gotPayload, res.BatchID, folderID, tn.wsA)
	}

	// 5. Exercise the production RunOnce / ClaimNextDocumentAccessBatch loop across
	// restart/resume without assuming no other batch exists in the database:
	// backdate created_at so this batch is deterministically oldest in the claim order.
	claimFolder := createTestFolder(t, f, actor, tn.wsA, "BG Claim Folder", nil)
	claimFolderID := claimFolder.ID
	for i := 1; i <= 3; i++ {
		_ = createTestPageInParent(t, f, actor, tn.wsA, fmt.Sprintf("BG Claim Doc %d", i), "restricted", &claimFolderID)
	}
	claimRes, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, claimFolderID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeMerge,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
		},
	})
	if err != nil || claimRes.ExecMode != FolderContentsAccessExecBackground {
		t.Fatalf("queue claim batch = %+v, err = %v", claimRes, err)
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(f.ctx, `DELETE FROM document_access_batches WHERE id = $1`, claimRes.BatchID)
	})
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE document_access_batches SET created_at = '2000-01-01T00:00:00Z' WHERE id = $1`,
		claimRes.BatchID); err != nil {
		t.Fatal(err)
	}
	worker := NewDocumentAccessBatchWorker(f.svc, nil)
	worker.ChunkSize = 2
	if worked, err := worker.RunOnce(f.ctx); err != nil || !worked {
		t.Fatalf("claim worker chunk 1: worked=%v err=%v", worked, err)
	}
	claimProg1, err := f.svc.GetFolderContentsAccessBatch(f.ctx, actor, claimFolderID, claimRes.BatchID)
	if err != nil {
		t.Fatal(err)
	}
	if claimProg1.Status != FolderContentsAccessBatchStatusRunning || claimProg1.Processed != 2 {
		t.Fatalf("claim batch after chunk 1 = %+v, want running processed=2", claimProg1)
	}
	workerAfterRestart := NewDocumentAccessBatchWorker(f.svc, nil)
	workerAfterRestart.ChunkSize = 2
	if worked, err := workerAfterRestart.RunOnce(f.ctx); err != nil || !worked {
		t.Fatalf("claim worker chunk 2 after restart: worked=%v err=%v", worked, err)
	}
	claimProg2, err := f.svc.GetFolderContentsAccessBatch(f.ctx, actor, claimFolderID, claimRes.BatchID)
	if err != nil {
		t.Fatal(err)
	}
	if claimProg2.Status != FolderContentsAccessBatchStatusCompleted || claimProg2.Processed != 3 {
		t.Fatalf("claim batch after chunk 2 = %+v, want completed processed=3", claimProg2)
	}
}

func TestFolderContentsBatchCompletedEventMatchesCatalogue(t *testing.T) {
	ev := folderContentsBatchCompletedEvent("batch-1", "folder-1", "ws-1")
	if ev.Topic != DocumentAccessBatchCompletedTopic {
		t.Fatalf("event topic = %q, want DocumentAccessBatchCompletedTopic %q", ev.Topic, DocumentAccessBatchCompletedTopic)
	}
	def, ok := outbox.Lookup(DocumentAccessBatchCompletedTopic)
	if !ok {
		t.Fatalf("emitted topic %q is not in outbox.Catalogue", DocumentAccessBatchCompletedTopic)
	}
	if DocumentAccessBatchCompletedTopic != "document_access_batch.completed" {
		t.Fatalf("DocumentAccessBatchCompletedTopic = %q, want \"document_access_batch.completed\"", DocumentAccessBatchCompletedTopic)
	}
	if def.Scope != outbox.ScopeWorkspace || def.Delivery != outbox.DeliveryOutbox {
		t.Fatalf("catalogue row for %s = %+v, want ScopeWorkspace + DeliveryOutbox", DocumentAccessBatchCompletedTopic, def)
	}
	gotKeys := make([]string, 0, len(ev.Payload))
	for k := range ev.Payload {
		gotKeys = append(gotKeys, k)
	}
	slices.Sort(gotKeys)
	wantKeys := slices.Clone(def.Payload)
	slices.Sort(wantKeys)
	if !slices.Equal(gotKeys, wantKeys) {
		t.Fatalf("%s payload keys = %v, want catalogue keys %v", DocumentAccessBatchCompletedTopic, gotKeys, wantKeys)
	}
}

// TestFolderContentsAccessSkipsLockedOwnedDocument covers the skipped_locked
// decision at the narrow DB-free service seam (UNI-2244 F7): Work Product
// documents cannot have a parent_id in the database schema, so the owned-row
// skip branch is verified directly without violating documents_owned_no_parent_check.
func TestFolderContentsAccessSkipsLockedOwnedDocument(t *testing.T) {
	var svc DocumentService
	lockedDoc := db.Document{
		ID:             util.NewID(),
		Kind:           DocumentKindPage,
		OwnerKind:      nullText("work_product"),
		OwnerID:        nullText(util.NewID()),
		Visibility:     documentVisibilityRestricted,
		WorkspaceLevel: string(DocumentLevelView),
	}
	if !isFolderContentsDocLocked(lockedDoc) {
		t.Fatal("isFolderContentsDocLocked(work_product) = false, want true")
	}
	plainDoc := db.Document{
		ID:         util.NewID(),
		Kind:       DocumentKindPage,
		Visibility: documentVisibilityRestricted,
	}
	if isFolderContentsDocLocked(plainDoc) {
		t.Fatal("isFolderContentsDocLocked(plainDoc) = true, want false")
	}
	out, err := svc.applyFolderContentsAccessToLockedDoc(
		t.Context(), nil, Human("01USER00000000000000000000"), db.Document{},
		"01BATCH0000000000000000000", FolderContentsAccessModeMerge, nil, nil, lockedDoc, nil,
	)
	if err != nil {
		t.Fatalf("applyFolderContentsAccessToLockedDoc(lockedDoc): %v", err)
	}
	if out.Processed != 1 || out.SkippedLocked != 1 || out.Changed != 0 || out.Unchanged != 0 || out.SkippedNotManageable != 0 {
		t.Fatalf("lockedDoc outcome = %+v, want Processed=1 SkippedLocked=1", out)
	}
}

// TestFolderContentsAccessChildDOC05SkipsRestrictedSelfGrant covers F1 (B2-R-01):
// a workspace/organization admin who has manage on a workspace folder but only
// AdminScope (no read level, no break-glass) on another member's restricted
// child document cannot use folder bulk access (merge or replace, granting
// their own user, the home workspace, or the organization) to grant themselves
// access on that restricted child. The restricted child is untouched, counted
// in skipped_not_manageable in dry-run, sync and background worker, and writes
// no audit row.
func TestFolderContentsAccessChildDOC05SkipsRestrictedSelfGrant(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "fcaf1")
	H := Human
	wsAdmin := H(tn.wsAdmin.ID)
	colleague := H(tn.member.ID)

	rootFolder := createTestFolder(t, f, wsAdmin, tn.wsA, "F1 Root Folder", nil)
	rootID := rootFolder.ID

	adminPage := createTestPageInParent(t, f, wsAdmin, tn.wsA, "Admin Own Page", "restricted", &rootID)
	colleagueRestricted := createTestPageInParent(t, f, colleague, tn.wsA, "Colleague Restricted Page", "restricted", &rootID)

	// Sanity check: single-document share by wsAdmin to themselves on colleagueRestricted requires break-glass.
	if _, err := f.svc.ShareDocument(f.ctx, wsAdmin, colleagueRestricted.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: tn.wsAdmin.ID, Level: DocumentLevelView,
	}); !codedIs(err, "break_glass_required") {
		t.Fatalf("single-doc self-share err = %v, want break_glass_required", err)
	}

	cases := []struct {
		name string
		item FolderContentsAccessItem
	}{
		{
			name: "self_user",
			item: FolderContentsAccessItem{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.wsAdmin.ID, Level: DocumentLevelView},
		},
		{
			name: "home_workspace",
			item: FolderContentsAccessItem{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelView},
		},
		{
			name: "organization",
			item: FolderContentsAccessItem{PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: DocumentLevelView},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dry, err := f.svc.UpdateFolderContentsAccess(f.ctx, wsAdmin, rootID, UpdateFolderContentsAccessInput{
				Mode:   FolderContentsAccessModeMerge,
				DryRun: true,
				Items:  []FolderContentsAccessItem{tc.item},
			})
			if err != nil {
				t.Fatalf("dry_run merge (%s): %v", tc.name, err)
			}
			if dry.Total != 2 || dry.Preview.SkippedNotManageable != 1 {
				t.Fatalf("dry_run (%s) = %+v, want Total=2 SkippedNotManageable=1", tc.name, dry)
			}

			syncRes, err := f.svc.UpdateFolderContentsAccess(f.ctx, wsAdmin, rootID, UpdateFolderContentsAccessInput{
				Mode:  FolderContentsAccessModeMerge,
				Items: []FolderContentsAccessItem{tc.item},
			})
			if err != nil {
				t.Fatalf("sync merge (%s): %v", tc.name, err)
			}
			if syncRes.Total != 2 || syncRes.SkippedNotManageable != 1 {
				t.Fatalf("sync (%s) = %+v, want Total=2 SkippedNotManageable=1", tc.name, syncRes)
			}

			reloaded := reloadDoc(t, f, colleagueRestricted.ID)
			if reloaded.Visibility != documentVisibilityRestricted {
				t.Fatalf("colleagueRestricted visibility after %s = %q, want restricted", tc.name, reloaded.Visibility)
			}
			if got := level(t, f, wsAdmin, reloaded); got != DocumentLevelNone {
				t.Fatalf("wsAdmin level on colleagueRestricted after %s = %q, want none", tc.name, got)
			}
			var auditCount int
			if err := f.pool.QueryRow(f.ctx,
				`SELECT count(*) FROM audit_events WHERE resource_id = $1 AND metadata::jsonb->>'via' = $2`,
				colleagueRestricted.ID, FolderContentsAccessVia).Scan(&auditCount); err != nil || auditCount != 0 {
				t.Fatalf("colleagueRestricted folder_contents audit rows after %s = %d (err=%v), want 0", tc.name, auditCount, err)
			}
		})
	}

	// V1-6: skipped_not_manageable must not depend on whether the home-workspace
	// row is in items. On this same fixture, wsAdmin holds manage on adminPage
	// and only AdminScope (level none < manage) on colleagueRestricted; two dry
	// runs (items with and without the home-workspace row) and a real run
	// granting another user without the home-workspace row must all report
	// SkippedNotManageable=1 and leave colleagueRestricted untouched.
	dryWithWSRow, err := f.svc.UpdateFolderContentsAccess(f.ctx, wsAdmin, rootID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeReplace,
		DryRun: true,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
		},
	})
	if err != nil {
		t.Fatalf("dry_run replace with ws row: %v", err)
	}
	dryWithoutWSRow, err := f.svc.UpdateFolderContentsAccess(f.ctx, wsAdmin, rootID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeReplace,
		DryRun: true,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
		},
	})
	if err != nil {
		t.Fatalf("dry_run replace without ws row: %v", err)
	}
	if dryWithWSRow.Preview.SkippedNotManageable != 1 ||
		dryWithoutWSRow.Preview.SkippedNotManageable != dryWithWSRow.Preview.SkippedNotManageable ||
		dryWithoutWSRow.Preview.Changed != 1 {
		t.Fatalf("V1-6 dry_run skipped_not_manageable varied with items: withWS=%+v withoutWS=%+v, want both SkippedNotManageable=1 Changed=1",
			dryWithWSRow.Preview, dryWithoutWSRow.Preview)
	}
	syncWithoutWSRow, err := f.svc.UpdateFolderContentsAccess(f.ctx, wsAdmin, rootID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeReplace,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
		},
	})
	if err != nil {
		t.Fatalf("sync replace without ws row: %v", err)
	}
	if syncWithoutWSRow.SkippedNotManageable != 1 || syncWithoutWSRow.Changed != 1 {
		t.Fatalf("V1-6 sync replace without ws row = %+v, want SkippedNotManageable=1 Changed=1", syncWithoutWSRow)
	}
	if got := level(t, f, H(tn.outsider.ID), reloadDoc(t, f, colleagueRestricted.ID)); got != DocumentLevelNone {
		t.Fatalf("outsider level on colleagueRestricted after sync without ws row = %q, want none", got)
	}

	// Also verify the background worker skips colleagueRestricted as skipped_not_manageable.
	f.svc.SetFolderContentsAccessSyncMax(1)
	t.Cleanup(func() { f.svc.SetFolderContentsAccessSyncMax(0) })

	bgRes, err := f.svc.UpdateFolderContentsAccess(f.ctx, wsAdmin, rootID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeMerge,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.wsAdmin.ID, Level: DocumentLevelEdit},
		},
	})
	if err != nil || bgRes.ExecMode != FolderContentsAccessExecBackground {
		t.Fatalf("queue bg (%+v): %v", bgRes, err)
	}
	if !runFolderContentsAccessBatchChunk(t, f, bgRes.BatchID, FolderContentsAccessChunkSize) {
		t.Fatal("bg worker chunk did not claim batch")
	}
	prog, err := f.svc.GetFolderContentsAccessBatch(f.ctx, wsAdmin, rootID, bgRes.BatchID)
	if err != nil {
		t.Fatal(err)
	}
	if prog.Status != FolderContentsAccessBatchStatusCompleted || prog.SkippedNotManageable != 1 {
		t.Fatalf("bg progress = %+v, want completed SkippedNotManageable=1", prog)
	}
	if got := level(t, f, wsAdmin, reloadDoc(t, f, colleagueRestricted.ID)); got != DocumentLevelNone {
		t.Fatalf("wsAdmin level on colleagueRestricted after bg = %q, want none", got)
	}
	_ = adminPage
}

// TestFolderContentsAccessWorkerFailsOnLostRootReadOrArchivedRoot covers F2 (B2-R-02):
// at the start of each chunk transaction the worker re-authorizes the creator's
// READ access on the live, non-archived root folder; if root read is lost or
// the root folder is archived between chunks, the batch transitions to 'failed'
// (error_code = 'root_access_lost'), preserving earlier committed chunks and
// leaving remaining children untouched.
func TestFolderContentsAccessWorkerFailsOnLostRootReadOrArchivedRoot(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "fcaf2")
	foreign := f.tenant(t, "fcaf2f")
	H := Human
	actor := H(tn.aclOwner.ID)

	f.svc.SetFolderContentsAccessSyncMax(1)
	t.Cleanup(func() { f.svc.SetFolderContentsAccessSyncMax(0) })

	t.Run("revoke_creator_root_read_between_chunks", func(t *testing.T) {
		// Seed an older queued batch in another tenant/folder before queuing
		// this subtest's batch. Without per-batch chunk execution, chunk 1 of
		// a global ClaimNextDocumentAccessBatch worker claims and completes this
		// older 1-chunk foreign batch (worked=true), leaving res.BatchID at
		// processed=0 when root read is revoked before chunk 2.
		foreignActor := H(foreign.aclOwner.ID)
		foreignFolder := createTestFolder(t, f, foreignActor, foreign.wsA, "F2 Foreign Folder", nil)
		foreignFolderID := foreignFolder.ID
		fd1 := createTestPageInParent(t, f, foreignActor, foreign.wsA, "F2 Foreign Doc 1", "restricted", &foreignFolderID)
		_ = createTestPageInParent(t, f, foreignActor, foreign.wsA, "F2 Foreign Doc 2", "restricted", &foreignFolderID)
		foreignRes, err := f.svc.UpdateFolderContentsAccess(f.ctx, foreignActor, foreignFolderID, UpdateFolderContentsAccessInput{
			Mode: FolderContentsAccessModeMerge,
			Items: []FolderContentsAccessItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: foreign.outsider.ID, Level: DocumentLevelView},
			},
		})
		if err != nil {
			t.Fatalf("queue foreign batch: %v", err)
		}
		t.Cleanup(func() {
			_, _ = f.pool.Exec(f.ctx, `DELETE FROM document_access_batches WHERE id = $1`, foreignRes.BatchID)
		})
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE document_access_batches SET document_ids = ARRAY[$2], total = 1, created_at = now() - interval '1 minute' WHERE id = $1`,
			foreignRes.BatchID, fd1.ID); err != nil {
			t.Fatal(err)
		}

		folder := createTestFolder(t, f, actor, tn.wsA, "F2 Revoke Root", nil)
		folderID := folder.ID
		d1 := createTestPageInParent(t, f, actor, tn.wsA, "F2 Doc 1", "restricted", &folderID)
		d2 := createTestPageInParent(t, f, actor, tn.wsA, "F2 Doc 2", "restricted", &folderID)
		docIDs := []string{d1.ID, d2.ID}
		slices.Sort(docIDs)

		res, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
			Mode: FolderContentsAccessModeMerge,
			Items: []FolderContentsAccessItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
			},
		})
		if err != nil {
			t.Fatalf("queue batch: %v", err)
		}

		if !runFolderContentsAccessBatchChunk(t, f, res.BatchID, 1) {
			t.Fatal("chunk 1: batch not claimed")
		}

		// Remove actor's read access on the root folder while keeping actor's
		// ownership of docIDs[1] (make root restricted and owned by tn.member).
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`,
			folderID, tn.member.ID); err != nil {
			t.Fatal(err)
		}

		if !runFolderContentsAccessBatchChunk(t, f, res.BatchID, 1) {
			t.Fatal("chunk 2 after lost root read: batch not claimed")
		}

		var status, errCode string
		var processed, changed int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT status, COALESCE(error_code, ''), processed, changed FROM document_access_batches WHERE id = $1`,
			res.BatchID).Scan(&status, &errCode, &processed, &changed); err != nil {
			t.Fatal(err)
		}
		if status != FolderContentsAccessBatchStatusFailed || errCode != "root_access_lost" || processed != 1 || changed != 1 {
			t.Fatalf("batch after lost root read = status=%q error_code=%q processed=%d changed=%d, want failed/root_access_lost/1/1",
				status, errCode, processed, changed)
		}
		if got := level(t, f, H(tn.outsider.ID), reloadDoc(t, f, docIDs[0])); got != DocumentLevelView {
			t.Fatalf("chunk 1 doc %s outsider level = %q, want view (retained)", docIDs[0], got)
		}
		if got := level(t, f, H(tn.outsider.ID), reloadDoc(t, f, docIDs[1])); got != DocumentLevelNone {
			t.Fatalf("chunk 2 doc %s outsider level = %q, want none (untouched)", docIDs[1], got)
		}
		var foreignStatus string
		var foreignProcessed int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT status, processed FROM document_access_batches WHERE id = $1`,
			foreignRes.BatchID).Scan(&foreignStatus, &foreignProcessed); err != nil {
			t.Fatal(err)
		}
		if foreignStatus != FolderContentsAccessBatchStatusQueued || foreignProcessed != 0 {
			t.Fatalf("foreign batch = status=%q processed=%d, want queued/0 (untouched)", foreignStatus, foreignProcessed)
		}
	})

	t.Run("archive_root_between_chunks", func(t *testing.T) {
		folder := createTestFolder(t, f, actor, tn.wsA, "F2 Archive Root", nil)
		folderID := folder.ID
		d1 := createTestPageInParent(t, f, actor, tn.wsA, "F2 Arch Doc 1", "restricted", &folderID)
		d2 := createTestPageInParent(t, f, actor, tn.wsA, "F2 Arch Doc 2", "restricted", &folderID)
		docIDs := []string{d1.ID, d2.ID}
		slices.Sort(docIDs)

		res, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
			Mode: FolderContentsAccessModeMerge,
			Items: []FolderContentsAccessItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
			},
		})
		if err != nil {
			t.Fatalf("queue batch: %v", err)
		}

		if !runFolderContentsAccessBatchChunk(t, f, res.BatchID, 1) {
			t.Fatal("chunk 1: batch not claimed")
		}

		// Archive root folder directly so docIDs[1] stays unarchived, proving
		// the root liveness check itself stops chunk 2.
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET archived_at = now() WHERE id = $1`, folderID); err != nil {
			t.Fatal(err)
		}

		if !runFolderContentsAccessBatchChunk(t, f, res.BatchID, 1) {
			t.Fatal("chunk 2 after root archived: batch not claimed")
		}

		var status, errCode string
		var processed, changed int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT status, COALESCE(error_code, ''), processed, changed FROM document_access_batches WHERE id = $1`,
			res.BatchID).Scan(&status, &errCode, &processed, &changed); err != nil {
			t.Fatal(err)
		}
		if status != FolderContentsAccessBatchStatusFailed || errCode != "root_access_lost" || processed != 1 || changed != 1 {
			t.Fatalf("batch after root archived = status=%q error_code=%q processed=%d changed=%d, want failed/root_access_lost/1/1",
				status, errCode, processed, changed)
		}
		if got := level(t, f, H(tn.outsider.ID), reloadDoc(t, f, docIDs[0])); got != DocumentLevelView {
			t.Fatalf("chunk 1 doc %s outsider level = %q, want view (retained)", docIDs[0], got)
		}
		if got := level(t, f, H(tn.outsider.ID), reloadDoc(t, f, docIDs[1])); got != DocumentLevelNone {
			t.Fatalf("chunk 2 doc %s outsider level = %q, want none (untouched)", docIDs[1], got)
		}
	})
}

// TestFolderContentsAccessSubtreeRecheckAndForeignMyFolder covers F3 (B2-R-03):
//   - documents inside another person's My Folder are excluded unconditionally
//     even when acl_owner_id = actor.ID;
//   - between worker chunks, saved IDs are intersected with the current live
//     permitted subtree: a page moved out of the folder or moved under a
//     foreign My Folder is skipped without modification while advancing
//     cursor_id, and newly arrived pages are never added.
func TestFolderContentsAccessSubtreeRecheckAndForeignMyFolder(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "fcaf3")
	H := Human
	actor := H(tn.aclOwner.ID)

	memberMF, _, err := f.svc.EnsureMyFolder(f.ctx, H(tn.member.ID), tn.wsA)
	if err != nil {
		t.Fatal(err)
	}
	mfID := memberMF.Document.ID

	// 1. A folder inside another member's My Folder that is readable by actor
	// and contains an actor-owned page still excludes that page unconditionally.
	foreignSubFolder := createTestFolder(t, f, H(tn.member.ID), tn.wsA, "Foreign MF Subfolder", &mfID)
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET visibility = 'workspace', workspace_level = 'view' WHERE id = $1`, foreignSubFolder.ID); err != nil {
		t.Fatal(err)
	}
	foreignSubID := foreignSubFolder.ID
	actorPageInForeignMF := createTestPageInParent(t, f, H(tn.member.ID), tn.wsA, "Actor Owned In Foreign MF", "restricted", &foreignSubID)
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET acl_owner_id = $2 WHERE id = $1`, actorPageInForeignMF.ID, tn.aclOwner.ID); err != nil {
		t.Fatal(err)
	}
	dryForeign, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, foreignSubID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeMerge,
		DryRun: true,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
		},
	})
	if err != nil {
		t.Fatalf("dry_run on foreign MF subfolder: %v", err)
	}
	if dryForeign.Total != 0 {
		t.Fatalf("dryForeign.Total = %d, want 0 (unconditional foreign My Folder exclusion)", dryForeign.Total)
	}

	// 2. Mid-batch moves: queue 3 pages under rootFolder, process chunk 1, then
	// move docIDs[1] to workspace root and docIDs[2] under member's My Folder,
	// plus add a new page under rootFolder after the snapshot.
	f.svc.SetFolderContentsAccessSyncMax(1)
	t.Cleanup(func() { f.svc.SetFolderContentsAccessSyncMax(0) })

	rootFolder := createTestFolder(t, f, actor, tn.wsA, "F3 Root Folder", nil)
	rootID := rootFolder.ID
	p1 := createTestPageInParent(t, f, actor, tn.wsA, "F3 Page 1", "restricted", &rootID)
	p2 := createTestPageInParent(t, f, actor, tn.wsA, "F3 Page 2", "restricted", &rootID)
	p3 := createTestPageInParent(t, f, actor, tn.wsA, "F3 Page 3", "restricted", &rootID)
	docIDs := []string{p1.ID, p2.ID, p3.ID}
	slices.Sort(docIDs)

	res, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, rootID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeMerge,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit},
		},
	})
	if err != nil || res.Total != 3 {
		t.Fatalf("queue batch = %+v, err = %v", res, err)
	}

	if !runFolderContentsAccessBatchChunk(t, f, res.BatchID, 1) {
		t.Fatal("chunk 1: batch not claimed")
	}

	// Move docIDs[1] out of rootFolder (to workspace root) and docIDs[2] into member's My Folder.
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET parent_id = NULL WHERE id = $1`, docIDs[1]); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET parent_id = $2 WHERE id = $1`, docIDs[2], mfID); err != nil {
		t.Fatal(err)
	}
	arrivedAfter := createTestPageInParent(t, f, actor, tn.wsA, "Arrived After Snapshot", "restricted", &rootID)

	for step := 2; step <= 3; step++ {
		if !runFolderContentsAccessBatchChunk(t, f, res.BatchID, 1) {
			t.Fatalf("chunk %d: batch not claimed", step)
		}
	}

	prog, err := f.svc.GetFolderContentsAccessBatch(f.ctx, actor, rootID, res.BatchID)
	if err != nil {
		t.Fatal(err)
	}
	if prog.Status != FolderContentsAccessBatchStatusCompleted || prog.Total != 3 || prog.Processed != 3 || prog.Changed != 1 {
		t.Fatalf("final progress = %+v, want completed Total=3 Processed=3 Changed=1", prog)
	}
	if got := level(t, f, H(tn.outsider.ID), reloadDoc(t, f, docIDs[0])); got != DocumentLevelEdit {
		t.Fatalf("docIDs[0] outsider level = %q, want edit", got)
	}
	for _, untouchedID := range []string{docIDs[1], docIDs[2], arrivedAfter.ID} {
		if got := level(t, f, H(tn.outsider.ID), reloadDoc(t, f, untouchedID)); got != DocumentLevelNone {
			t.Fatalf("untouched doc %s outsider level = %q, want none", untouchedID, got)
		}
	}
}

// TestFolderContentsAccessAuditProvenanceAndSequentialSyncs covers F6 (B2-R-05)
// and F9 (B2-R-06):
//   - child audit rows for grant, relevel, revoke, and home-row updates carry
//     all five required provenance keys: batch_id, via, folder_id, mode, and
//     before_level;
//   - two sequential sync updates on the same folder both succeed and return
//     distinct non-empty batch IDs, while a request arriving when a background
//     batch is queued returns 409 folder_access_batch_running with its batch_id.
func TestFolderContentsAccessAuditProvenanceAndSequentialSyncs(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "fcaf6f9")
	H := Human
	actor := H(tn.aclOwner.ID)

	folder := createTestFolder(t, f, actor, tn.wsA, "F6F9 Folder", nil)
	folderID := folder.ID
	page := createTestPageInParent(t, f, actor, tn.wsA, "F6F9 Page", "restricted", &folderID)

	assertFiveMetaKeys := func(t *testing.T, action, batchID, wantMode, wantBeforeLevel string) {
		t.Helper()
		var rawMeta string
		if err := f.pool.QueryRow(f.ctx,
			`SELECT metadata FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->>'batch_id' = $3 LIMIT 1`,
			action, page.ID, batchID).Scan(&rawMeta); err != nil {
			t.Fatalf("missing audit row action=%s batch_id=%s: %v", action, batchID, err)
		}
		var meta map[string]any
		if err := json.Unmarshal([]byte(rawMeta), &meta); err != nil {
			t.Fatalf("unmarshal audit metadata (%s): %v", rawMeta, err)
		}
		for _, k := range []string{"batch_id", "via", "folder_id", "mode", "before_level"} {
			if _, ok := meta[k]; !ok {
				t.Fatalf("audit action=%s metadata=%v missing key %q", action, meta, k)
			}
		}
		if meta["batch_id"] != batchID || meta["via"] != FolderContentsAccessVia ||
			meta["folder_id"] != folderID || meta["mode"] != wantMode || meta["before_level"] != wantBeforeLevel {
			t.Fatalf("audit action=%s metadata=%v, want batch_id=%s via=%s folder_id=%s mode=%s before_level=%q",
				action, meta, batchID, FolderContentsAccessVia, folderID, wantMode, wantBeforeLevel)
		}
	}

	// Sync 1 (merge): grant outsider=view (before_level="") and home workspace=view (before_level="").
	sync1, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeMerge,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelView},
		},
	})
	if err != nil || sync1.BatchID == "" || sync1.Changed != 1 {
		t.Fatalf("sync1 = %+v, err = %v", sync1, err)
	}
	assertFiveMetaKeys(t, audit.ActionDocumentShared, sync1.BatchID, FolderContentsAccessModeMerge, "")
	assertFiveMetaKeys(t, audit.ActionDocumentWorkspaceAccessChanged, sync1.BatchID, FolderContentsAccessModeMerge, "")

	// Sync 2 (merge, sequential on the same folder): relevel outsider view->edit (before_level="view")
	// and home workspace view->edit (before_level="view").
	sync2, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode: FolderContentsAccessModeMerge,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit},
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelEdit},
		},
	})
	if err != nil || sync2.BatchID == "" || sync2.BatchID == sync1.BatchID || sync2.Changed != 1 {
		t.Fatalf("sync2 = %+v, err = %v", sync2, err)
	}
	assertFiveMetaKeys(t, audit.ActionDocumentShared, sync2.BatchID, FolderContentsAccessModeMerge, string(DocumentLevelView))
	assertFiveMetaKeys(t, audit.ActionDocumentWorkspaceAccessChanged, sync2.BatchID, FolderContentsAccessModeMerge, string(DocumentLevelView))

	// Sync 3 (replace with empty items): revoke outsider edit (before_level="edit")
	// and close home workspace edit->restricted (before_level="edit").
	sync3, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode:  FolderContentsAccessModeReplace,
		Items: []FolderContentsAccessItem{},
	})
	if err != nil || sync3.BatchID == "" || sync3.Changed != 1 {
		t.Fatalf("sync3 = %+v, err = %v", sync3, err)
	}
	assertFiveMetaKeys(t, audit.ActionDocumentShareRevoked, sync3.BatchID, FolderContentsAccessModeReplace, string(DocumentLevelEdit))
	assertFiveMetaKeys(t, audit.ActionDocumentWorkspaceAccessChanged, sync3.BatchID, FolderContentsAccessModeReplace, string(DocumentLevelEdit))
}

// TestFolderContentsAccessLockTimeoutErrorMapping covers UNI-2244 §3.1 step 2 (F9, R2-02):
// a SQLSTATE 55P03 lock_not_available timeout on the folder advisory lock maps
// to 409 folder_access_batch_running:
//   - with fields.batch_id when a queued/running batch row is visible after the timeout;
//   - without fields.batch_id when no queued/running batch row is visible (e.g. a
//     synchronous update still holds the folder lock; never raw 55P03 / HTTP 500);
//   - non-55P03 errors pass through untouched.
func TestFolderContentsAccessLockTimeoutErrorMapping(t *testing.T) {
	lockTimeoutErr := &pgconn.PgError{Code: "55P03", Message: "canceling statement due to lock timeout"}

	// 1. Timeout with visible queued/running batch -> 409 folder_access_batch_running with fields.batch_id.
	withBatchErr := MapFolderAccessLockError(lockTimeoutErr, func() (string, error) {
		return "01J8X4BATCHRUNNING00000000", nil
	})
	var ceWithBatch CodedError
	if !errors.As(withBatchErr, &ceWithBatch) {
		t.Fatalf("timeout with visible batch: err = %T (%v), want CodedError", withBatchErr, withBatchErr)
	}
	if ceWithBatch.Status != http.StatusConflict || ceWithBatch.Code != ErrCodeFolderAccessBatchRunning {
		t.Fatalf("timeout with visible batch: status=%d code=%q, want 409 %q", ceWithBatch.Status, ceWithBatch.Code, ErrCodeFolderAccessBatchRunning)
	}
	if ceWithBatch.Fields["batch_id"] != "01J8X4BATCHRUNNING00000000" {
		t.Fatalf("timeout with visible batch: fields = %v, want batch_id=01J8X4BATCHRUNNING00000000", ceWithBatch.Fields)
	}

	// 2. Timeout with no visible queued/running batch (pgx.ErrNoRows) -> 409 folder_access_batch_running WITHOUT batch_id.
	noRowErr := MapFolderAccessLockError(lockTimeoutErr, func() (string, error) {
		return "", pgx.ErrNoRows
	})
	var ceNoRow CodedError
	if !errors.As(noRowErr, &ceNoRow) {
		t.Fatalf("timeout without visible batch: err = %T (%v), want CodedError (not raw 55P03)", noRowErr, noRowErr)
	}
	if ceNoRow.Status != http.StatusConflict || ceNoRow.Code != ErrCodeFolderAccessBatchRunning {
		t.Fatalf("timeout without visible batch: status=%d code=%q, want 409 %q", ceNoRow.Status, ceNoRow.Code, ErrCodeFolderAccessBatchRunning)
	}
	if _, hasBatchID := ceNoRow.Fields["batch_id"]; hasBatchID {
		t.Fatalf("timeout without visible batch: fields = %v, must not include batch_id", ceNoRow.Fields)
	}

	// 3. Non-55P03 database error is not remapped.
	otherPgErr := &pgconn.PgError{Code: "40001", Message: "serialization_failure"}
	gotOther := MapFolderAccessLockError(otherPgErr, func() (string, error) {
		t.Fatal("lookupRunning must not be called for non-55P03 error")
		return "", nil
	})
	if gotOther != otherPgErr {
		t.Fatalf("non-55P03 error = %v, want original %v", gotOther, otherPgErr)
	}
}

// TestFolderContentsAccessToPrivateWarningRequiresHomeWorkspaceShare covers
// UNI-2244 warnings and Amendment A1 (V1-1, DB-free unit check):
//   - replace with empty items or fewer users on an all-private (restricted)
//     subtree with direct user shares never raises "to_private" or "downgrade"
//     when downgraded_users == 0;
//   - replace with empty items OR user-only items (omitting the home-workspace
//     row) on a document that had a home-workspace share loses that share in the
//     simulated after state and raises "to_private" (without "downgrade" when
//     downgraded_users == 0);
//   - replace keeping the home-workspace row does not lose the home-workspace
//     share (no "to_private"), raises "downgrade" when downgraded_users > 0, and
//     raises neither when users only lose access (downgraded_users == 0);
//   - merge mode never raises "downgrade" or "to_private".
func TestFolderContentsAccessToPrivateWarningRequiresHomeWorkspaceShare(t *testing.T) {
	wsID := "01J8X4WS0N1P2Q3R4S5T6U7V8"
	u1ID := "01J8X4USER0000000000000001"
	u2ID := "01J8X4USER0000000000000002"
	privateDoc := db.Document{
		ID:          "01J8X4DOCPRIVATE0000000000",
		WorkspaceID: wsID,
		Kind:        DocumentKindPage,
		Visibility:  documentVisibilityRestricted,
	}
	directUserShares := []db.DocumentShare{
		{
			DocumentID:    privateDoc.ID,
			PrincipalType: DocumentPrincipalUser,
			PrincipalID:   u1ID,
			Level:         string(DocumentLevelEdit),
		},
		{
			DocumentID:    privateDoc.ID,
			PrincipalType: DocumentPrincipalUser,
			PrincipalID:   u2ID,
			Level:         string(DocumentLevelView),
		},
	}
	if !decideFolderContentsDocWouldChange(privateDoc, directUserShares, FolderContentsAccessModeReplace, nil) {
		t.Fatal("decideFolderContentsDocWouldChange(privateDoc with direct user share, replace empty) = false, want true")
	}
	if docHasHomeWorkspaceShare(privateDoc, directUserShares) {
		t.Fatal("docHasHomeWorkspaceShare(privateDoc with only direct user share) = true, want false")
	}
	warningsAllPrivate := computeFolderContentsWarnings(
		wsID, FolderContentsAccessModeReplace, nil, 2, 2, 2, 0,
		docHasHomeWorkspaceShare(privateDoc, directUserShares),
	)
	if slices.Contains(warningsAllPrivate, FolderContentsAccessWarningToPrivate) ||
		slices.Contains(warningsAllPrivate, FolderContentsAccessWarningDowngrade) {
		t.Fatalf("replace-with-nobody on all-private subtree warnings = %v, want empty", warningsAllPrivate)
	}

	// V1-1: private doc + user shares, replace keeping only u1=edit (dropping u2, losingUsers=1, downgradedUsers=0) -> neither to_private nor downgrade.
	userOnlyItems := []FolderContentsAccessItem{
		{PrincipalType: DocumentPrincipalUser, PrincipalID: u1ID, Level: DocumentLevelEdit},
	}
	simPrivAfter, simPrivShares := simulateFolderContentsDocAfter(privateDoc, directUserShares, FolderContentsAccessModeReplace, userOnlyItems)
	privLosesHome := docHasHomeWorkspaceShare(privateDoc, directUserShares) && !docHasHomeWorkspaceShare(simPrivAfter, simPrivShares)
	if privLosesHome {
		t.Fatal("privateDoc simulated replace with userOnlyItems reported losing home-workspace share")
	}
	warningsPrivateFewerUsers := computeFolderContentsWarnings(
		wsID, FolderContentsAccessModeReplace, userOnlyItems, 2, 1, 1, 0, privLosesHome,
	)
	if len(warningsPrivateFewerUsers) != 0 {
		t.Errorf("V1-1 private doc replace with fewer users warnings = %v, want empty (no to_private, no downgrade)", warningsPrivateFewerUsers)
	}

	wsSharedDoc := db.Document{
		ID:             "01J8X4DOCWSSHARED000000000",
		WorkspaceID:    wsID,
		Kind:           DocumentKindPage,
		Visibility:     documentVisibilityWorkspace,
		WorkspaceLevel: string(DocumentLevelView),
	}
	if !docHasHomeWorkspaceShare(wsSharedDoc, nil) {
		t.Fatal("docHasHomeWorkspaceShare(wsSharedDoc) = false, want true")
	}
	warningsWithWSShare := computeFolderContentsWarnings(
		wsID, FolderContentsAccessModeReplace, nil, 2, 2, 1, 0,
		docHasHomeWorkspaceShare(wsSharedDoc, nil),
	)
	if !slices.Contains(warningsWithWSShare, FolderContentsAccessWarningToPrivate) {
		t.Fatalf("replace-with-nobody with workspace-shared doc warnings = %v, want %q",
			warningsWithWSShare, FolderContentsAccessWarningToPrivate)
	}

	// Reported defect shape: replace with user-only items (no home-workspace row) on workspace-shared doc,
	// losingUsers=1, downgradedUsers=0 -> to_private present, downgrade absent.
	simWSAfterUserOnly, simWSSharesUserOnly := simulateFolderContentsDocAfter(wsSharedDoc, nil, FolderContentsAccessModeReplace, userOnlyItems)
	wsLosesHomeOnUserOnly := docHasHomeWorkspaceShare(wsSharedDoc, nil) && !docHasHomeWorkspaceShare(simWSAfterUserOnly, simWSSharesUserOnly)
	if !wsLosesHomeOnUserOnly {
		t.Fatal("wsSharedDoc simulated replace with userOnlyItems did not lose home-workspace share")
	}
	warningsUserOnlyNoWS := computeFolderContentsWarnings(
		wsID, FolderContentsAccessModeReplace, userOnlyItems, 7, 7, 1, 0, wsLosesHomeOnUserOnly,
	)
	if !slices.Contains(warningsUserOnlyNoWS, FolderContentsAccessWarningToPrivate) ||
		slices.Contains(warningsUserOnlyNoWS, FolderContentsAccessWarningDowngrade) {
		t.Errorf("replace user-only on workspace-shared doc (losing=1, downgraded=0) warnings = %v, want [to_private] without downgrade",
			warningsUserOnlyNoWS)
	}

	// Replace keeping the home-workspace row: simulated doc still has home-workspace share -> no to_private.
	keepWSItems := []FolderContentsAccessItem{
		{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: wsID, Level: DocumentLevelView},
		{PrincipalType: DocumentPrincipalUser, PrincipalID: u1ID, Level: DocumentLevelView},
	}
	simWSAfterKeep, simWSSharesKeep := simulateFolderContentsDocAfter(wsSharedDoc, nil, FolderContentsAccessModeReplace, keepWSItems)
	wsLosesHomeOnKeep := docHasHomeWorkspaceShare(wsSharedDoc, nil) && !docHasHomeWorkspaceShare(simWSAfterKeep, simWSSharesKeep)
	if wsLosesHomeOnKeep {
		t.Fatal("wsSharedDoc simulated replace keeping home-workspace row reported losing home-workspace share")
	}
	// Lowering a user (downgradedUsers=1) while keeping home-workspace row -> downgrade present, to_private absent.
	warningsKeepWSDowngrade := computeFolderContentsWarnings(
		wsID, FolderContentsAccessModeReplace, keepWSItems, 2, 2, 0, 1, wsLosesHomeOnKeep,
	)
	if !slices.Contains(warningsKeepWSDowngrade, FolderContentsAccessWarningDowngrade) ||
		slices.Contains(warningsKeepWSDowngrade, FolderContentsAccessWarningToPrivate) {
		t.Fatalf("replace keeping home ws with downgradedUsers=1 warnings = %v, want [downgrade] without to_private",
			warningsKeepWSDowngrade)
	}
	// User only losing access (losingUsers=1, downgradedUsers=0) while keeping home-workspace row -> neither warning.
	warningsKeepWSLosingOnly := computeFolderContentsWarnings(
		wsID, FolderContentsAccessModeReplace, keepWSItems, 2, 2, 1, 0, wsLosesHomeOnKeep,
	)
	if len(warningsKeepWSLosingOnly) != 0 {
		t.Errorf("replace keeping home ws with losingUsers=1 downgradedUsers=0 warnings = %v, want empty",
			warningsKeepWSLosingOnly)
	}

	// Merge mode never raises downgrade or to_private.
	warningsMerge := computeFolderContentsWarnings(
		wsID, FolderContentsAccessModeMerge, userOnlyItems, 2, 2, 1, 1, true,
	)
	if len(warningsMerge) != 0 {
		t.Fatalf("merge mode warnings = %v, want empty", warningsMerge)
	}
}

// TestFolderContentsAccessDryRunToPrivateOnlyWhenHomeWorkspaceShared covers
// UNI-2244 warnings and Amendment A1 (V1-1) end-to-end against UpdateFolderContentsAccess(dry_run=true):
//   - replace with empty items or fewer users on an all-private subtree that has
//     direct user shares reports changed > 0 and losing_users > 0, but emits
//     neither "to_private" nor "downgrade" when downgraded_users == 0;
//   - once a document in the subtree has a home-workspace share:
//   - replace with empty items emits "to_private";
//   - replace with user-only items (omitting the home-workspace row) emits
//     "to_private" and not "downgrade" when downgraded_users == 0;
//   - replace that lowers a user while keeping the home-workspace row emits
//     "downgrade" and not "to_private";
//   - replace keeping the home-workspace row where a user only loses access
//     emits neither "downgrade" nor "to_private";
//   - merge mode never emits "downgrade" or "to_private".
func TestFolderContentsAccessDryRunToPrivateOnlyWhenHomeWorkspaceShared(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "fcav11")
	H := Human
	actor := H(tn.aclOwner.ID)

	folder := createTestFolder(t, f, actor, tn.wsA, "V1-1 Folder", nil)
	folderID := folder.ID
	p1 := createTestPageInParent(t, f, actor, tn.wsA, "V1-1 Private 1", "restricted", &folderID)
	p2 := createTestPageInParent(t, f, actor, tn.wsA, "V1-1 Private 2", "restricted", &folderID)

	// Grant direct user shares on both restricted pages (neither has a home-workspace share):
	// outsider has edit on p1 and p2; bMember has view on p1.
	for _, docID := range []string{p1.ID, p2.ID} {
		if _, err := f.svc.ShareDocument(f.ctx, actor, docID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit,
		}); err != nil {
			t.Fatalf("share outsider on %s: %v", docID, err)
		}
	}
	if _, err := f.svc.ShareDocument(f.ctx, actor, p1.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatalf("share bMember on p1: %v", err)
	}

	// 1a. All-private subtree, replace with empty items -> no "to_private", no "downgrade".
	dryAllPrivate, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeReplace,
		DryRun: true,
		Items:  []FolderContentsAccessItem{},
	})
	if err != nil {
		t.Fatalf("dry_run all-private: %v", err)
	}
	if dryAllPrivate.Preview.Changed != 2 {
		t.Fatalf("dryAllPrivate Changed = %d, want 2", dryAllPrivate.Preview.Changed)
	}
	if slices.Contains(dryAllPrivate.Preview.Warnings, FolderContentsAccessWarningToPrivate) ||
		slices.Contains(dryAllPrivate.Preview.Warnings, FolderContentsAccessWarningDowngrade) {
		t.Fatalf("dryAllPrivate warnings = %v, must not include to_private or downgrade when all docs were already private", dryAllPrivate.Preview.Warnings)
	}

	// 1b. V1-1: All-private subtree, replace with fewer users (keep outsider=edit, drop bMember) ->
	// losing_users == 1, downgraded_users == 0, neither "to_private" nor "downgrade".
	dryPrivateFewerUsers, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeReplace,
		DryRun: true,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit},
		},
	})
	if err != nil {
		t.Fatalf("dry_run all-private fewer users: %v", err)
	}
	if dryPrivateFewerUsers.Preview.Changed != 1 || dryPrivateFewerUsers.Preview.LosingUsers != 1 || dryPrivateFewerUsers.Preview.DowngradedUsers != 0 {
		t.Fatalf("dryPrivateFewerUsers preview = %+v, want Changed=1 LosingUsers=1 DowngradedUsers=0", dryPrivateFewerUsers.Preview)
	}
	if len(dryPrivateFewerUsers.Preview.Warnings) != 0 {
		t.Fatalf("dryPrivateFewerUsers warnings = %v, want empty (no to_private, no downgrade)", dryPrivateFewerUsers.Preview.Warnings)
	}

	// 2. Give p2 a home-workspace share (view) -> dry-run replace with empty items now emits "to_private".
	viewLvl := DocumentLevelView
	if _, err := f.svc.UpdateDocumentAccess(f.ctx, actor, p2.ID, UpdateDocumentAccessInput{
		Items: []DocumentAccessBatchItem{
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: &viewLvl, OnExisting: DocumentAccessOnExistingUpdate},
		},
	}); err != nil {
		t.Fatalf("grant home workspace on p2: %v", err)
	}
	dryWithWS, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeReplace,
		DryRun: true,
		Items:  []FolderContentsAccessItem{},
	})
	if err != nil {
		t.Fatalf("dry_run with workspace share: %v", err)
	}
	if !slices.Contains(dryWithWS.Preview.Warnings, FolderContentsAccessWarningToPrivate) ||
		slices.Contains(dryWithWS.Preview.Warnings, FolderContentsAccessWarningDowngrade) {
		t.Fatalf("dryWithWS warnings = %v, want [to_private] without downgrade", dryWithWS.Preview.Warnings)
	}

	// 3. Replace with users only (outsider=edit, no home-workspace row) when p2 has a home-workspace share ->
	// losing_users >= 1, downgraded_users == 0, "to_private" present, "downgrade" absent.
	dryUserOnlyNoWS, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeReplace,
		DryRun: true,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit},
		},
	})
	if err != nil {
		t.Fatalf("dry_run replace user-only without home ws: %v", err)
	}
	if dryUserOnlyNoWS.Preview.Changed != 2 || dryUserOnlyNoWS.Preview.LosingUsers == 0 || dryUserOnlyNoWS.Preview.DowngradedUsers != 0 {
		t.Fatalf("dryUserOnlyNoWS preview = %+v, want Changed=2 LosingUsers>0 DowngradedUsers=0", dryUserOnlyNoWS.Preview)
	}
	if !slices.Contains(dryUserOnlyNoWS.Preview.Warnings, FolderContentsAccessWarningToPrivate) ||
		slices.Contains(dryUserOnlyNoWS.Preview.Warnings, FolderContentsAccessWarningDowngrade) {
		t.Fatalf("dryUserOnlyNoWS warnings = %v, want [to_private] without downgrade", dryUserOnlyNoWS.Preview.Warnings)
	}

	// 4. Replace that lowers a user (outsider edit -> view) while keeping the home-workspace row ->
	// "downgrade" present, "to_private" absent.
	dryKeepWSDowngrade, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeReplace,
		DryRun: true,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
		},
	})
	if err != nil {
		t.Fatalf("dry_run replace keeping home ws with user downgrade: %v", err)
	}
	if dryKeepWSDowngrade.Preview.DowngradedUsers == 0 ||
		!slices.Contains(dryKeepWSDowngrade.Preview.Warnings, FolderContentsAccessWarningDowngrade) ||
		slices.Contains(dryKeepWSDowngrade.Preview.Warnings, FolderContentsAccessWarningToPrivate) {
		t.Fatalf("dryKeepWSDowngrade preview = %+v, want DowngradedUsers>0 and [downgrade] without to_private", dryKeepWSDowngrade.Preview)
	}

	// 5. Replace keeping the home-workspace row while a user only loses access (outsider stays edit, bMember dropped) ->
	// losing_users >= 1, downgraded_users == 0, neither "downgrade" nor "to_private".
	dryKeepWSLosingOnly, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeReplace,
		DryRun: true,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit},
		},
	})
	if err != nil {
		t.Fatalf("dry_run replace keeping home ws with losing user only: %v", err)
	}
	if dryKeepWSLosingOnly.Preview.LosingUsers == 0 || dryKeepWSLosingOnly.Preview.DowngradedUsers != 0 ||
		len(dryKeepWSLosingOnly.Preview.Warnings) != 0 {
		t.Fatalf("dryKeepWSLosingOnly preview = %+v, want LosingUsers>0 DowngradedUsers=0 and empty warnings", dryKeepWSLosingOnly.Preview)
	}

	// 6. Merge mode never raises "downgrade" or "to_private".
	dryMergeUserOnly, err := f.svc.UpdateFolderContentsAccess(f.ctx, actor, folderID, UpdateFolderContentsAccessInput{
		Mode:   FolderContentsAccessModeMerge,
		DryRun: true,
		Items: []FolderContentsAccessItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView},
		},
	})
	if err != nil {
		t.Fatalf("dry_run merge user-only: %v", err)
	}
	if len(dryMergeUserOnly.Preview.Warnings) != 0 {
		t.Fatalf("dryMergeUserOnly warnings = %v, want empty", dryMergeUserOnly.Preview.Warnings)
	}
}
