package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The batch routes after the PLAN (UNI-2052 w3): the creator's read (GET),
// the cancel (DELETE) and the sweep that closes batches nobody finished.

const (
	folderUploadStatusCanceled = "canceled"
	folderUploadStatusExpired  = "expired"

	// folderUploadGCJob is the audit actor of the expiry sweep.
	folderUploadGCJob = "documents.folder_upload_gc"
)

func errFolderUploadExpired() error {
	return coded(http.StatusGone, "folder_upload_expired", "lượt tải thư mục đã hết hạn: hãy tải lại từ đầu")
}

// folderUploadGate is the one gate of the batch routes: the caller is a
// signed-in person who is still a member of the workspace. Any refusal reads
// as ErrNotFound, so the answer never tells a stranger whether a batch is
// there; the batch row itself is then read for its creator only.
func (s *DocumentService) folderUploadGate(ctx context.Context, actor Actor, workspaceID, batchID string) (string, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) || workspaceID == "" || batchID == "" {
		return "", ErrNotFound
	}
	if _, err := s.ws.RequireMember(ctx, workspaceID, actor.ID); err != nil {
		if isGateRefusal(err) {
			return "", ErrNotFound
		}
		return "", err
	}
	return s.workspaceOrganization(ctx, workspaceID)
}

// folderUploadClosedForUploads reports a batch past its window: the sweep has
// closed it, or it is still open but its expiry has passed (the sweep may not
// have reached it yet).
func (s *DocumentService) folderUploadClosedForUploads(row db.DocumentFolderUpload) bool {
	return row.Status == folderUploadStatusExpired ||
		(row.Status == folderUploadStatusOpen && !s.now().Before(row.ExpiresAt.Time))
}

// GetFolderUpload is the poll and the resume of one batch (§1 #4): counts for
// every file and a fresh target for each pending one; a multipart file lists
// only the parts storage does not hold yet. Only the creator reads it. An
// expired batch is 410 folder_upload_expired.
func (s *DocumentService) GetFolderUpload(ctx context.Context, actor Actor, workspaceID, batchID string) (FolderUploadBatch, error) {
	orgID, err := s.folderUploadGate(ctx, actor, workspaceID, batchID)
	if err != nil {
		return FolderUploadBatch{}, err
	}
	row, err := s.folderUploadRow(ctx, actor, orgID, workspaceID, batchID)
	if err != nil {
		return FolderUploadBatch{}, err
	}
	if s.folderUploadClosedForUploads(row) {
		return FolderUploadBatch{}, errFolderUploadExpired()
	}
	return s.folderUploadView(ctx, actor, orgID, workspaceID, batchID, true)
}

// CancelFolderUpload is DELETE (§1 #5): an open batch becomes canceled, its
// pending uploads are aborted (multipart) or revoked (single PUT), and one
// documents.folder_upload_canceled audit row records how many files were
// still pending. The folders and documents the batch already landed stay.
// Cancel is idempotent: a canceled or completed batch is answered as it is,
// without a second audit row; an expired one is 410.
func (s *DocumentService) CancelFolderUpload(ctx context.Context, actor Actor, workspaceID, batchID string) (FolderUploadBatch, error) {
	orgID, err := s.folderUploadGate(ctx, actor, workspaceID, batchID)
	if err != nil {
		return FolderUploadBatch{}, err
	}
	pending, row, err := s.cancelFolderUploadRows(ctx, actor, orgID, workspaceID, batchID)
	if err != nil {
		return FolderUploadBatch{}, err
	}
	// The batch is closed for good; releasing what it held is best effort, so
	// a storage hiccup never turns a committed cancel into an error. What a
	// failed release leaves behind expires with its own session.
	s.releaseFolderUploadFiles(ctx, row, pending)
	return s.folderUploadView(ctx, actor, orgID, workspaceID, batchID, false)
}

// cancelFolderUploadRows is the cancel transaction: the batch row lock (the
// one COMPLETE and the content route take, so a cancel and a file landing are
// ordered), the status change and the audit row. It answers the files that
// were pending, or none when the batch was already settled.
func (s *DocumentService) cancelFolderUploadRows(ctx context.Context, actor Actor, orgID, workspaceID, batchID string) ([]db.DocumentFolderUploadFile, db.DocumentFolderUpload, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, db.DocumentFolderUpload{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	row, err := q.LockDocumentFolderUpload(ctx, db.LockDocumentFolderUploadParams{
		ID: batchID, OrganizationID: orgID, WorkspaceID: workspaceID,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, db.DocumentFolderUpload{}, ErrNotFound
	}
	if err != nil {
		return nil, db.DocumentFolderUpload{}, err
	}
	if s.folderUploadClosedForUploads(row) {
		return nil, row, errFolderUploadExpired()
	}
	if row.Status != folderUploadStatusOpen {
		return nil, row, nil
	}
	pending, err := pendingFolderUploadFiles(ctx, q, row)
	if err != nil {
		return nil, row, err
	}
	if n, err := q.SetDocumentFolderUploadStatus(ctx, db.SetDocumentFolderUploadStatusParams{
		Status: folderUploadStatusCanceled, ID: row.ID, OrganizationID: orgID, WorkspaceID: workspaceID,
	}); err != nil {
		return nil, row, err
	} else if n == 0 {
		return nil, row, nil
	}
	if err := recordFolderUploadClosed(ctx, q, actor, audit.ActionDocumentsFolderUploadCanceled, row, len(pending)); err != nil {
		return nil, row, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, row, err
	}
	return pending, row, nil
}

func pendingFolderUploadFiles(ctx context.Context, q *db.Queries, row db.DocumentFolderUpload) ([]db.DocumentFolderUploadFile, error) {
	all, err := q.ListDocumentFolderUploadFiles(ctx, db.ListDocumentFolderUploadFilesParams{
		BatchID: row.ID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
	})
	if err != nil {
		return nil, err
	}
	pending := all[:0]
	for _, f := range all {
		if f.Status == folderUploadFilePending {
			pending = append(pending, f)
		}
	}
	return pending, nil
}

// recordFolderUploadClosed writes the one audit row of a cancel or an expiry,
// inside the transaction that closed the batch.
func recordFolderUploadClosed(ctx context.Context, q *db.Queries, actor Actor, action string, row db.DocumentFolderUpload, pending int) error {
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, Actor: actor,
		Action: action, ResourceType: folderUploadResourceType, ResourceID: row.ID,
		Metadata: map[string]any{"batch_id": row.ID, "pending_count": pending},
	})
}

// releaseFolderUploadFiles gives back what a closed batch's pending files
// still hold: a multipart upload is aborted in storage and its quota
// reservation released; a single PUT's FileService intent is revoked. It
// never fails the caller: a failure is logged, and the multipart session's own
// expiry sweep (the batch's expiry is the session's) or the file collector
// finishes the job.
func (s *DocumentService) releaseFolderUploadFiles(ctx context.Context, batch db.DocumentFolderUpload, pending []db.DocumentFolderUploadFile) {
	ctx = context.WithoutCancel(ctx)
	creator := Actor{Kind: audit.Kind(batch.CreatedByKind), ID: batch.CreatedBy}
	for _, f := range pending {
		if !f.UploadRef.Valid {
			continue
		}
		var err error
		if f.TargetKind == folderUploadTargetMulti {
			err = s.abortFolderUploadMultipart(ctx, f.UploadRef.String)
		} else {
			err = s.revokeFolderUploadIntent(ctx, creator, batch, f.UploadRef.String)
		}
		if err != nil {
			slog.Warn("folder upload release", "batch", batch.ID, "file", f.ID, "err", err)
		}
	}
}

// revokeFolderUploadIntent cancels the FileService upload of a single-PUT
// file. A file the service no longer knows, or one a module already claimed,
// is nothing left to release.
func (s *DocumentService) revokeFolderUploadIntent(ctx context.Context, creator Actor, batch db.DocumentFolderUpload, fileID string) error {
	if s.files == nil {
		return nil
	}
	err := s.files.CancelUpload(ctx, files.CancelInput{
		Actor: creator, Scope: documentScope(batch.OrganizationID, batch.WorkspaceID), FileID: files.FileID(fileID),
	})
	var fe *files.Error
	if errors.As(err, &fe) && (fe.Code == files.CodeNotFound || fe.Code == files.CodeAlreadyClaimed) {
		return nil
	}
	return err
}

// abortFolderUploadMultipart aborts one open multipart session of a folder
// batch the way abortUploadSession does, without that route's own audit row:
// the batch's cancel or expiry row stands for it. The claim, the storage abort
// and the FileService cancel commit together, so a failure leaves the session
// open for the expiry sweep.
func (s *DocumentService) abortFolderUploadMultipart(ctx context.Context, sessionID string) error {
	fs, err := s.multipartFileService()
	if err != nil {
		return err
	}
	row, err := s.q.GetFileMultipartUploadByID(ctx, sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if row.Status != "open" {
		return nil
	}
	now := s.now().UTC().Truncate(time.Microsecond)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	n, err := q.AbortFileMultipartUpload(ctx, db.AbortFileMultipartUploadParams{
		ID:       row.ID,
		ClosedAt: pgtype.Timestamptz{Time: now, Valid: true},
		Now:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil || n == 0 {
		return err
	}
	loc := storage.ObjectLocator{Storage: fs.backend, Bucket: fs.bucket, Key: row.ObjectKey}
	if err := fs.store.AbortMultipart(ctx, loc, row.StorageUploadID); err != nil && !errors.Is(err, storage.ErrMultipartNotFound) {
		return documentFileError(files.StorageUnavailable(err))
	}
	if err := fs.cancelMultipartFileSessionInTx(ctx, q, row.FileID, row.FileUploadSessionID, true); err != nil {
		return fmt.Errorf("cancel upload session: %w", err)
	}
	return tx.Commit(ctx)
}

// SweepFolderUploads closes every open batch past its expiry (one
// documents.folder_upload_expired audit row each, actor system, and the
// storage of its pending files released), then deletes batches settled for
// more than a week with their file rows. Documents and folders a batch
// created are never touched. It answers the rows it closed or deleted.
func (s *DocumentService) SweepFolderUploads(ctx context.Context) (int64, error) {
	if s == nil || s.q == nil || s.pool == nil {
		return 0, nil
	}
	var total int64
	expired, err := s.expireFolderUploads(ctx)
	total += expired
	if err != nil {
		return total, err
	}
	settled, err := s.q.DeleteSettledFolderUploads(ctx)
	total += settled
	if err != nil {
		return total, err
	}
	orphans, err := s.q.DeleteOrphanFolderUploadFiles(ctx)
	return total + orphans, err
}

// expireFolderUploads moves the open batches past their expiry to expired and
// audits each in the same transaction, then releases their pending uploads.
func (s *DocumentService) expireFolderUploads(ctx context.Context) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	rows, err := q.ExpireOpenFolderUploads(ctx)
	if err != nil || len(rows) == 0 {
		return 0, err
	}
	sys := audit.System(folderUploadGCJob)
	pendings := make([][]db.DocumentFolderUploadFile, len(rows))
	for i, row := range rows {
		pending, err := pendingFolderUploadFiles(ctx, q, row)
		if err != nil {
			return 0, err
		}
		pendings[i] = pending
		if err := recordFolderUploadClosed(ctx, q, sys, audit.ActionDocumentsFolderUploadExpired, row, len(pending)); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	for i, row := range rows {
		s.releaseFolderUploadFiles(ctx, row, pendings[i])
	}
	return int64(len(rows)), nil
}
