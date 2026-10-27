package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Folder bulk access constants and error codes (UNI-2244 §1–§6).
const (
	// FolderContentsAccessSyncMax is the default maximum number of subtree
	// documents processed synchronously in one transaction before falling back
	// to a background batch (spec §3.1 step 5).
	FolderContentsAccessSyncMax = 500

	// FolderContentsAccessMaxItems caps the number of principal items on
	// PUT /api/v1/documents/{folderID}/contents-access (spec §3.1).
	FolderContentsAccessMaxItems = 100

	// FolderContentsAccessChunkSize is the number of subtree documents processed
	// per transaction by the background worker (spec §4).
	FolderContentsAccessChunkSize = 200

	FolderContentsAccessModeMerge   = "merge"
	FolderContentsAccessModeReplace = "replace"

	FolderContentsAccessExecSync       = "sync"
	FolderContentsAccessExecBackground = "background"

	FolderContentsAccessBatchStatusQueued    = "queued"
	FolderContentsAccessBatchStatusRunning   = "running"
	FolderContentsAccessBatchStatusCompleted = "completed"
	FolderContentsAccessBatchStatusFailed    = "failed"

	FolderContentsAccessWarningWideScope = "wide_scope"
	FolderContentsAccessWarningDowngrade = "downgrade"
	FolderContentsAccessWarningToPrivate = "to_private"

	FolderContentsAccessVia = "folder_contents"

	ErrCodeNotAFolder               = "not_a_folder"
	ErrCodeDocumentAccessRejected   = "document_access_rejected"
	ErrCodeFolderAccessBatchRunning = "folder_access_batch_running"
)

func errNotAFolder() error {
	return coded(http.StatusUnprocessableEntity, "not_a_folder", "tài liệu gốc không phải là thư mục")
}

func errFolderAccessBatchRunning(batchID string) error {
	return CodedError{
		Code:   "folder_access_batch_running",
		Status: http.StatusConflict,
		Msg:    "thư mục đang có một lô cập nhật quyền truy cập chạy nền",
		Fields: map[string]any{"batch_id": batchID},
	}
}

// MapFolderAccessLockError maps a lock error from LockFolderAccessBatch (UNI-2244 §3.1 step 2, F9).
func MapFolderAccessLockError(err error, lookupRunning func() (string, error)) error {
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "55P03" {
		if lookupRunning != nil {
			if runningID, qErr := lookupRunning(); qErr == nil && runningID != "" {
				return errFolderAccessBatchRunning(runningID)
			}
		}
	}
	return err
}

// FolderContentsAccessItem is one principal grant in UpdateFolderContentsAccessInput.
type FolderContentsAccessItem struct {
	PrincipalType string        `json:"principal_type"`
	PrincipalID   string        `json:"principal_id"`
	Level         DocumentLevel `json:"level"`
}

// UpdateFolderContentsAccessInput is the input to
// PUT /api/v1/documents/{folderID}/contents-access (UNI-2244 §3.1).
type UpdateFolderContentsAccessInput struct {
	Mode   string
	Items  []FolderContentsAccessItem
	DryRun bool
}

// FolderContentsAccessPreview is the dry-run summary block (UNI-2244 §3.1):
// counts and warning codes only, never document titles or person names (NFR-04).
type FolderContentsAccessPreview struct {
	Changed              int
	Unchanged            int
	SkippedNotManageable int
	SkippedLocked        int
	LosingUsers          int
	DowngradedUsers      int
	Warnings             []string
}

// FolderContentsAccessResult is the outcome of UpdateFolderContentsAccess.
type FolderContentsAccessResult struct {
	DryRun               bool
	BatchID              string
	ExecMode             string
	Total                int
	Changed              int
	Unchanged            int
	SkippedNotManageable int
	SkippedLocked        int
	Preview              FolderContentsAccessPreview
}

// FolderContentsAccessBatch is the progress and outcome of a folder access batch
// returned by GET /api/v1/documents/{folderID}/contents-access/{batchID} (§3.2).
type FolderContentsAccessBatch struct {
	BatchID              string
	Status               string
	Total                int
	Processed            int
	Changed              int
	Unchanged            int
	SkippedNotManageable int
	SkippedLocked        int
	FinishedAt           *time.Time
}

// FolderContentsRecipientNotice is one entry in document_access_batches.notified_levels
// (keyed by recipient user_id): the highest effective level reached across the
// batch, the number of subtree documents where their effective level strictly
// rose, and the affected document IDs for delivery-time read checks (UNI-2244 §6, F5).
type FolderContentsRecipientNotice struct {
	Level  string   `json:"level"`
	Count  int      `json:"count"`
	DocIDs []string `json:"doc_ids,omitempty"`
}

// validateFolderContentsAccessInput checks syntax and bounds on mode and items
// (spec §2, §3.1): mode is merge or replace; items has 0..100 entries (empty
// allowed only when mode=replace); each item has a valid principal_type,
// non-empty principal_id and valid share level.
func validateFolderContentsAccessInput(in UpdateFolderContentsAccessInput) (string, []FolderContentsAccessItem, error) {
	mode := strings.TrimSpace(in.Mode)
	switch mode {
	case FolderContentsAccessModeMerge, FolderContentsAccessModeReplace:
	default:
		return "", nil, Invalid("mode phải là merge hoặc replace")
	}
	if len(in.Items) > FolderContentsAccessMaxItems {
		return "", nil, Invalid("items tối đa 100 mục")
	}
	if mode == FolderContentsAccessModeMerge && len(in.Items) == 0 {
		return "", nil, Invalid("items phải có ít nhất 1 mục khi mode là merge")
	}
	items := make([]FolderContentsAccessItem, len(in.Items))
	for i, raw := range in.Items {
		pt := strings.TrimSpace(raw.PrincipalType)
		switch pt {
		case DocumentPrincipalUser, DocumentPrincipalWorkspace, DocumentPrincipalOrganization:
		default:
			return "", nil, Invalid("principal_type phải là user, workspace hoặc organization")
		}
		pid := strings.TrimSpace(raw.PrincipalID)
		if pid == "" {
			return "", nil, Invalid("principal_id bắt buộc")
		}
		lvl := DocumentLevel(strings.TrimSpace(string(raw.Level)))
		if err := validShareLevel(lvl); err != nil {
			return "", nil, err
		}
		items[i] = FolderContentsAccessItem{
			PrincipalType: pt,
			PrincipalID:   pid,
			Level:         lvl,
		}
	}
	return mode, items, nil
}

// validateFolderContentsAccessSemantics runs §6.1 semantic validation on the
// items against the root folder's organization/workspace and the caller's
// standing: duplicate principals, principal_not_in_organization,
// level_not_allowed (manage on organization or home workspace), and DOC-05
// self-grant (break_glass_required when the caller is not an effective
// workspace admin and would grant themselves via AdminScope, though on a
// workspace folder an AdminScope caller already holds manage).
func (s *DocumentService) validateFolderContentsAccessSemantics(
	ctx context.Context,
	q *db.Queries,
	folder db.Document,
	folderAccess DocumentAccess,
	actor Actor,
	items []FolderContentsAccessItem,
) ([]DocumentAccessRejectedItem, error) {
	batchItems := make([]DocumentAccessBatchItem, len(items))
	for i, it := range items {
		lvl := it.Level
		batchItems[i] = DocumentAccessBatchItem{
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Level:         &lvl,
			OnExisting:    DocumentAccessOnExistingUpdate,
		}
	}
	return s.validateAccessBatchSemantics(ctx, q, folder, folderAccess, actor, batchItems)
}

// UpdateFolderContentsAccess previews or applies a bulk access update across
// every live non-folder document in folderID's subtree that the caller can
// administer (UNI-2244 §1–§6).
func (s *DocumentService) UpdateFolderContentsAccess(
	ctx context.Context,
	actor Actor,
	folderID string,
	in UpdateFolderContentsAccessInput,
) (FolderContentsAccessResult, error) {
	mode, items, err := validateFolderContentsAccessInput(in)
	if err != nil {
		return FolderContentsAccessResult{}, err
	}
	if !validActor(actor) || folderID == "" {
		return FolderContentsAccessResult{}, ErrNotFound
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FolderContentsAccessResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	// 1. Root must be a readable document whose kind is 'folder' (§1).
	folder, folderAccess, err := s.authorizeDocumentQ(ctx, q, actor, folderID, DocumentLevelView)
	if err != nil {
		return FolderContentsAccessResult{}, err
	}
	if folder.Kind != DocumentKindFolder {
		return FolderContentsAccessResult{}, errNotAFolder()
	}

	// 2. Validate all items (§3.1 step 1) -> 422 document_access_rejected, nothing written.
	rejected, err := s.validateFolderContentsAccessSemantics(ctx, q, folder, folderAccess, actor, items)
	if err != nil {
		return FolderContentsAccessResult{}, err
	}
	if len(rejected) > 0 {
		return FolderContentsAccessResult{}, errDocumentAccessRejected(rejected)
	}

	// 3. Acquire the blocking per-folder advisory xact lock with a 30s timeout
	// (§3.1 step 2, F9) and check for a queued/running batch.
	if _, err := tx.Exec(ctx, `SET LOCAL lock_timeout = '30s'`); err != nil {
		return FolderContentsAccessResult{}, err
	}
	if err := q.LockFolderAccessBatch(ctx, folder.ID); err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "55P03" {
			_ = tx.Rollback(ctx)
			runningID, qErr := s.q.GetRunningDocumentAccessBatchForFolder(ctx, db.GetRunningDocumentAccessBatchForFolderParams{
				OrganizationID: folder.OrganizationID,
				WorkspaceID:    folder.WorkspaceID,
				FolderID:       folder.ID,
			})
			if qErr == nil && runningID != "" {
				return FolderContentsAccessResult{}, errFolderAccessBatchRunning(runningID)
			}
		}
		return FolderContentsAccessResult{}, err
	}
	if _, err := tx.Exec(ctx, `SET LOCAL lock_timeout = 0`); err != nil {
		return FolderContentsAccessResult{}, err
	}
	if runningID, err := q.GetRunningDocumentAccessBatchForFolder(ctx, db.GetRunningDocumentAccessBatchForFolderParams{
		OrganizationID: folder.OrganizationID,
		WorkspaceID:    folder.WorkspaceID,
		FolderID:       folder.ID,
	}); err == nil {
		return FolderContentsAccessResult{}, errFolderAccessBatchRunning(runningID)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return FolderContentsAccessResult{}, err
	}

	// 4. Snapshot subtree document IDs (§3.1 step 3).
	ids, err := q.ListFolderContentsAccessSubtreeIDs(ctx, db.ListFolderContentsAccessSubtreeIDsParams{
		OrganizationID: folder.OrganizationID,
		WorkspaceID:    folder.WorkspaceID,
		FolderID:       folder.ID,
		ActorID:        actor.ID,
		MaxLevel:       subtreeMaxLevel(),
	})
	if err != nil {
		return FolderContentsAccessResult{}, err
	}
	total := len(ids)

	// 5. dry_run: compute preview counts and warnings without writing or auditing (§3.1 step 4).
	if in.DryRun {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			return FolderContentsAccessResult{}, err
		}
		return s.previewFolderContentsAccess(ctx, actor, folder, mode, items, ids)
	}

	batchID := util.NewID()
	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return FolderContentsAccessResult{}, err
	}

	// 6. Sync branch when total <= FolderContentsAccessSyncMax (§3.1 step 5).
	if total <= s.effectiveFolderContentsAccessSyncMax() {
		return s.executeFolderContentsAccessSync(ctx, tx, q, actor, folder, batchID, mode, items, itemsJSON, ids)
	}

	// 7. Background branch when total > FolderContentsAccessSyncMax (§3.1 step 6):
	// insert the queued batch row in the same transaction under the folder lock.
	if _, err := q.InsertDocumentAccessBatch(ctx, db.InsertDocumentAccessBatchParams{
		ID:             batchID,
		OrganizationID: folder.OrganizationID,
		WorkspaceID:    folder.WorkspaceID,
		FolderID:       folder.ID,
		CreatedBy:      actor.ID,
		CreatedByKind:  string(actor.Kind),
		Mode:           mode,
		Items:          itemsJSON,
		DocumentIds:    ids,
		NotifiedLevels: []byte("{}"),
		Status:         FolderContentsAccessBatchStatusQueued,
		Total:          int32(total),
	}); err != nil {
		return FolderContentsAccessResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return FolderContentsAccessResult{}, err
	}
	return FolderContentsAccessResult{
		BatchID:  batchID,
		ExecMode: FolderContentsAccessExecBackground,
		Total:    total,
	}, nil
}

// GetFolderContentsAccessBatch returns the progress and outcome counts of one
// batch for its creator on GET /api/v1/documents/{folderID}/contents-access/{batchID}
// (spec §3.2). Any other user or tenant receives 404.
func (s *DocumentService) GetFolderContentsAccessBatch(
	ctx context.Context,
	actor Actor,
	folderID, batchID string,
) (FolderContentsAccessBatch, error) {
	if !validActor(actor) || folderID == "" || batchID == "" {
		return FolderContentsAccessBatch{}, ErrNotFound
	}
	folder, _, err := s.authorizeDocument(ctx, actor, folderID, DocumentLevelView)
	if err != nil {
		return FolderContentsAccessBatch{}, ErrNotFound
	}
	row, err := s.q.GetDocumentAccessBatchForCreator(ctx, db.GetDocumentAccessBatchForCreatorParams{
		ID:             batchID,
		OrganizationID: folder.OrganizationID,
		WorkspaceID:    folder.WorkspaceID,
		FolderID:       folder.ID,
		CreatedBy:      actor.ID,
		CreatedByKind:  string(actor.Kind),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return FolderContentsAccessBatch{}, ErrNotFound
	}
	if err != nil {
		return FolderContentsAccessBatch{}, err
	}
	out := FolderContentsAccessBatch{
		BatchID:              row.ID,
		Status:               row.Status,
		Total:                int(row.Total),
		Processed:            int(row.Processed),
		Changed:              int(row.Changed),
		Unchanged:            int(row.Unchanged),
		SkippedNotManageable: int(row.SkippedNotManageable),
		SkippedLocked:        int(row.SkippedLocked),
	}
	if row.FinishedAt.Valid {
		t := row.FinishedAt.Time.UTC()
		out.FinishedAt = &t
	}
	return out, nil
}
