package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const documentAccessBatchWorkerDefaultPoll = time.Second

// DocumentAccessBatchWorker drains queued and interrupted running rows in
// document_access_batches in chunks of FolderContentsAccessChunkSize (UNI-2244 §4).
type DocumentAccessBatchWorker struct {
	docs         *DocumentService
	log          *slog.Logger
	PollInterval time.Duration
	ChunkSize    int
}

// NewDocumentAccessBatchWorker builds the background worker for folder bulk
// access batches. main.go awaits Run in its shutdown sequence.
func NewDocumentAccessBatchWorker(docs *DocumentService, log *slog.Logger) *DocumentAccessBatchWorker {
	if log == nil {
		log = slog.Default()
	}
	return &DocumentAccessBatchWorker{
		docs:         docs,
		log:          log,
		PollInterval: documentAccessBatchWorkerDefaultPoll,
		ChunkSize:    FolderContentsAccessChunkSize,
	}
}

func (w *DocumentAccessBatchWorker) pollInterval() time.Duration {
	if w != nil && w.PollInterval > 0 {
		return w.PollInterval
	}
	return documentAccessBatchWorkerDefaultPoll
}

func (w *DocumentAccessBatchWorker) chunkSize() int {
	if w != nil && w.ChunkSize > 0 {
		return w.ChunkSize
	}
	return FolderContentsAccessChunkSize
}

// Run drains batches until ctx is cancelled, pausing PollInterval when the
// queue is empty.
func (w *DocumentAccessBatchWorker) Run(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		worked, err := w.RunOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			w.log.Warn("document access batch worker", "err", err)
		}
		if worked {
			continue
		}
		if !retentionPause(ctx, w.pollInterval()) {
			return
		}
	}
}

// RunOnce claims at most one queued or running batch and processes one chunk
// of up to ChunkSize documents inside a single transaction. It returns true
// when a batch was claimed and advanced/completed/failed, or false when no
// unclaimed queued/running batch existed.
func (w *DocumentAccessBatchWorker) RunOnce(ctx context.Context) (bool, error) {
	if w == nil || w.docs == nil {
		return false, nil
	}
	return w.docs.ProcessNextFolderContentsAccessChunk(ctx, w.chunkSize())
}

// ProcessNextFolderContentsAccessChunk claims one queued or running
// document_access_batches row with FOR UPDATE SKIP LOCKED and processes one
// chunk of up to chunkSize documents after cursor_id (UNI-2244 §4).
func (s *DocumentService) ProcessNextFolderContentsAccessChunk(ctx context.Context, chunkSize int) (bool, error) {
	if chunkSize <= 0 {
		chunkSize = FolderContentsAccessChunkSize
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	batch, err := q.ClaimNextDocumentAccessBatch(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	// Acquire the per-folder advisory xact lock so a concurrent PUT on the same
	// folder serializes with this chunk transaction.
	if err := q.LockFolderAccessBatch(ctx, batch.FolderID); err != nil {
		return false, err
	}

	// Verify the root folder still exists in the workspace and is still a folder.
	folder, err := q.GetDocument(ctx, db.GetDocumentParams{
		ID:             batch.FolderID,
		OrganizationID: batch.OrganizationID,
		WorkspaceID:    batch.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && folder.Kind != DocumentKindFolder) {
		if _, failErr := q.FailDocumentAccessBatch(ctx, db.FailDocumentAccessBatchParams{
			ID:             batch.ID,
			OrganizationID: batch.OrganizationID,
			WorkspaceID:    batch.WorkspaceID,
			ErrorCode:      nullText("folder_not_found"),
		}); failErr != nil {
			return false, failErr
		}
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		return true, nil
	}
	if err != nil {
		return false, err
	}

	var items []FolderContentsAccessItem
	if len(batch.Items) > 0 {
		if err := json.Unmarshal(batch.Items, &items); err != nil {
			if _, failErr := q.FailDocumentAccessBatch(ctx, db.FailDocumentAccessBatchParams{
				ID:             batch.ID,
				OrganizationID: batch.OrganizationID,
				WorkspaceID:    batch.WorkspaceID,
				ErrorCode:      nullText("invalid_batch_items"),
			}); failErr != nil {
				return false, failErr
			}
			if err := tx.Commit(ctx); err != nil {
				return false, err
			}
			return true, nil
		}
	}

	notifiedLevels := make(map[string]string)
	if len(batch.NotifiedLevels) > 0 {
		_ = json.Unmarshal(batch.NotifiedLevels, &notifiedLevels)
	}

	// Determine the next slice of document_ids strictly after batch.CursorID.
	remaining := batch.DocumentIds
	if batch.CursorID != "" {
		idx := -1
		for i, id := range batch.DocumentIds {
			if id > batch.CursorID {
				idx = i
				break
			}
		}
		if idx == -1 {
			remaining = nil
		} else {
			remaining = batch.DocumentIds[idx:]
		}
	}

	chunk := remaining
	isLastChunk := true
	if len(chunk) > chunkSize {
		chunk = chunk[:chunkSize]
		isLastChunk = false
	}

	actor := Actor{
		ID:   batch.CreatedBy,
		Kind: audit.Kind(batch.CreatedByKind),
	}

	userItemIDs := make([]string, 0, len(items))
	for _, it := range items {
		if it.PrincipalType == DocumentPrincipalUser {
			userItemIDs = append(userItemIDs, it.PrincipalID)
		}
	}

	outcome := folderContentsOutcome{
		Processed:            int(batch.Processed),
		Changed:              int(batch.Changed),
		Unchanged:            int(batch.Unchanged),
		SkippedNotManageable: int(batch.SkippedNotManageable),
		SkippedLocked:        int(batch.SkippedLocked),
	}

	cursorID := batch.CursorID
	for _, docID := range chunk {
		cursorID = docID
		doc, err := q.LockDocumentByID(ctx, docID)
		if errors.Is(err, pgx.ErrNoRows) {
			outcome.Processed++
			continue
		}
		if err != nil {
			return false, err
		}
		if doc.OrganizationID != batch.OrganizationID || doc.WorkspaceID != batch.WorkspaceID {
			outcome.Processed++
			continue
		}
		if doc.ArchivedAt.Valid || doc.Kind == DocumentKindFolder || isMyFolder(doc) {
			outcome.Processed++
			continue
		}
		res, err := s.applyFolderContentsAccessToLockedDoc(ctx, q, actor, folder, batch.ID, batch.Mode, items, userItemIDs, doc, notifiedLevels)
		if err != nil {
			return false, err
		}
		outcome.Processed += res.Processed
		outcome.Changed += res.Changed
		outcome.Unchanged += res.Unchanged
		outcome.SkippedNotManageable += res.SkippedNotManageable
		outcome.SkippedLocked += res.SkippedLocked
	}

	notifiedJSON, err := json.Marshal(notifiedLevels)
	if err != nil {
		return false, err
	}

	if isLastChunk {
		if _, err := q.CompleteDocumentAccessBatch(ctx, db.CompleteDocumentAccessBatchParams{
			ID:                   batch.ID,
			OrganizationID:       batch.OrganizationID,
			WorkspaceID:          batch.WorkspaceID,
			Processed:            int32(outcome.Processed),
			Changed:              int32(outcome.Changed),
			Unchanged:            int32(outcome.Unchanged),
			SkippedNotManageable: int32(outcome.SkippedNotManageable),
			SkippedLocked:        int32(outcome.SkippedLocked),
			CursorID:             cursorID,
			NotifiedLevels:       notifiedJSON,
		}); err != nil {
			return false, err
		}
		if err := recordFolderContentsBatchCompletedAudit(ctx, q, actor, folder, batch.ID, batch.Mode, items, int(batch.Total), outcome, FolderContentsAccessExecBackground); err != nil {
			return false, err
		}
	} else {
		if _, err := q.AdvanceDocumentAccessBatchChunk(ctx, db.AdvanceDocumentAccessBatchChunkParams{
			ID:                   batch.ID,
			OrganizationID:       batch.OrganizationID,
			WorkspaceID:          batch.WorkspaceID,
			Processed:            int32(outcome.Processed),
			Changed:              int32(outcome.Changed),
			Unchanged:            int32(outcome.Unchanged),
			SkippedNotManageable: int32(outcome.SkippedNotManageable),
			SkippedLocked:        int32(outcome.SkippedLocked),
			CursorID:             cursorID,
			NotifiedLevels:       notifiedJSON,
		}); err != nil {
			return false, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}
