package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"testing"

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
	//     │     ├── lockedPage (Work Product owner_id set -> skipped_locked)
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

	lockedPage := createTestPageInParent(t, f, actor, tn.wsA, "Work Product Page", "restricted", &subFolderID)
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET owner_kind = 'work_product', owner_id = $2 WHERE id = $1`, lockedPage.ID, util.NewID()); err != nil {
		t.Fatal(err)
	}

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
	// Total in subtree = 5 (page1, subPage1, page2, unmanageablePage, lockedPage; rootFolder & subFolder & trashedPage excluded).
	// Manageable = 3 (page1, subPage1, page2), skipped_not_manageable = 1, skipped_locked = 1.
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
	if !dryMerge.DryRun || dryMerge.Total != 5 || dryMerge.Preview.Changed != 3 || dryMerge.Preview.Unchanged != 0 ||
		dryMerge.Preview.SkippedNotManageable != 1 || dryMerge.Preview.SkippedLocked != 1 ||
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
		syncMerge.Total != 5 || syncMerge.Changed != 3 || syncMerge.Unchanged != 0 ||
		syncMerge.SkippedNotManageable != 1 || syncMerge.SkippedLocked != 1 {
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

	// Verify audit rows: child documents carry batch_id + via:"folder_contents"; folder carries document.contents_access_updated.
	var viaVal string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT metadata->>'via' FROM audit_events WHERE resource_id = $1 AND metadata->>'batch_id' = $2 LIMIT 1`,
		page2.ID, syncMerge.BatchID).Scan(&viaVal); err != nil || viaVal != FolderContentsAccessVia {
		t.Fatalf("child audit metadata.via = %q (err=%v), want %q", viaVal, err, FolderContentsAccessVia)
	}
	var folderAuditMeta string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT metadata FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata->>'batch_id' = $3`,
		audit.ActionDocumentContentsAccessUpdated, rootID, syncMerge.BatchID).Scan(&folderAuditMeta); err != nil {
		t.Fatalf("folder contents_access_updated audit row missing: %v", err)
	}

	// Verify only ONE document.shared outbox event for outsider carry notify_user_id across the batch (for page2 & subPage1 where outsider rose from none -> view).
	var notifyEvents int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = 'document.shared' AND payload::jsonb->>'notify_user_id' = $1`,
		tn.outsider.ID).Scan(&notifyEvents); err != nil || notifyEvents != 1 {
		t.Fatalf("outsider notify_user_id event count = %d (err=%v), want 1", notifyEvents, err)
	}

	// 6. Dry-run replace mode with downgrade warning and empty-items to_private warning:
	// Replace with only outsider=view (omitting home workspace and bMember):
	// - bMember loses access on page1 (losing_users >= 1), workspace members without direct shares lose access on page1/subPage1/page2
	// - outsider is downgraded from edit -> view on page1 (downgraded_users >= 1)
	// -> warnings includes "downgrade".
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
		!slices.Contains(dryReplaceDowngrade.Preview.Warnings, FolderContentsAccessWarningDowngrade) {
		t.Fatalf("dryReplaceDowngrade = %+v, want losing>0, downgraded>0 and warning downgrade", dryReplaceDowngrade.Preview)
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
	if syncReplace.Changed != 3 || syncReplace.SkippedNotManageable != 1 || syncReplace.SkippedLocked != 1 {
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
	worker := NewDocumentAccessBatchWorker(f.svc, nil)
	worker.ChunkSize = 2

	worked, err := worker.RunOnce(f.ctx)
	if err != nil || !worked {
		t.Fatalf("chunk 1: worked=%v, err=%v", worked, err)
	}
	prog1, err := f.svc.GetFolderContentsAccessBatch(f.ctx, actor, folderID, res.BatchID)
	if err != nil {
		t.Fatal(err)
	}
	if prog1.Status != FolderContentsAccessBatchStatusRunning || prog1.Processed != 2 || prog1.Changed != 2 || prog1.FinishedAt != nil {
		t.Fatalf("progress after chunk 1 = %+v, want status=running processed=2 changed=2", prog1)
	}

	// Simulate server restart: a new worker instance picks up the 'running' batch from cursor_id without repeating docIDs[0..1].
	workerAfterRestart := NewDocumentAccessBatchWorker(f.svc, nil)
	workerAfterRestart.ChunkSize = 2

	// Chunk 2: processes docIDs[2..3].
	if worked, err := workerAfterRestart.RunOnce(f.ctx); err != nil || !worked {
		t.Fatalf("chunk 2 after restart: worked=%v, err=%v", worked, err)
	}
	prog2, err := f.svc.GetFolderContentsAccessBatch(f.ctx, actor, folderID, res.BatchID)
	if err != nil {
		t.Fatal(err)
	}
	if prog2.Status != FolderContentsAccessBatchStatusRunning || prog2.Processed != 4 || prog2.Changed != 4 {
		t.Fatalf("progress after chunk 2 = %+v, want processed=4 changed=4", prog2)
	}

	// Chunk 3: processes docIDs[4] and completes the batch.
	if worked, err := workerAfterRestart.RunOnce(f.ctx); err != nil || !worked {
		t.Fatalf("chunk 3: worked=%v, err=%v", worked, err)
	}
	prog3, err := f.svc.GetFolderContentsAccessBatch(f.ctx, actor, folderID, res.BatchID)
	if err != nil {
		t.Fatal(err)
	}
	if prog3.Status != FolderContentsAccessBatchStatusCompleted || prog3.Processed != 5 || prog3.Changed != 5 || prog3.FinishedAt == nil {
		t.Fatalf("progress after chunk 3 = %+v, want completed processed=5 changed=5 finished_at!=nil", prog3)
	}

	// Next worker poll finds nothing left to do.
	if worked, err := workerAfterRestart.RunOnce(f.ctx); err != nil || worked {
		t.Fatalf("post-completion poll: worked=%v, err=%v, want false", worked, err)
	}

	// Verify each of the 5 documents was granted exactly once and outsider has edit on all 5.
	for _, id := range docIDs {
		if got := level(t, f, H(tn.outsider.ID), reloadDoc(t, f, id)); got != DocumentLevelEdit {
			t.Fatalf("doc %s outsider level = %q, want edit", id, got)
		}
		var shareAuditCount int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata->>'batch_id' = $3`,
			audit.ActionDocumentShared, id, res.BatchID).Scan(&shareAuditCount); err != nil || shareAuditCount != 1 {
			t.Fatalf("doc %s share audit count = %d (err=%v), want 1 (no duplicate write across chunks)", id, shareAuditCount, err)
		}
	}

	// Verify only 1 outbox event for outsider carried notify_user_id across all 3 chunks (notified_levels persisted between chunks).
	var notifyCount int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = 'document.shared' AND payload::jsonb->>'notify_user_id' = $1`,
		tn.outsider.ID).Scan(&notifyCount); err != nil || notifyCount != 1 {
		t.Fatalf("background batch notify_user_id count = %d (err=%v), want 1", notifyCount, err)
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
