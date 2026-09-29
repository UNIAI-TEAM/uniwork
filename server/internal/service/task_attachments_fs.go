package service

// FileService half of the task attachment module (UNI-744, FS-C1). The path is
// selectable at construction: TaskService.files nil keeps the legacy storage
// pipeline byte-identical, and once wired every entry point uses FileService —
// one request, one path, no fallback after a files error, no dual-write. Rows
// written by each side tell the readers apart: a file_id means FileService
// holds the bytes, a NULL file_id means object_key does.

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// SetFiles selects the FileService path for task attachments. nil (the
// default) keeps the legacy storage path; the integrator sets it when the real
// FileService is ready.
func (s *TaskService) SetFiles(f files.Service) { s.files = f }

// taskFileScope is the tenant scope every task-file call runs under. UserID
// stays empty: org_workspace files belong to the workspace, and the actor is
// carried on the input structs, so a second member opening the file still
// matches the scope it was uploaded with.
func taskFileScope(organizationID, workspaceID string) files.Scope {
	return files.Scope{OrganizationID: organizationID, WorkspaceID: workspaceID}
}

// normalizeAttachmentPurpose maps the declared purpose onto the registry. An
// absent one is the file-attachment default — what every client uploaded
// before the field existed — and anything outside the three task purposes is
// refused before a byte is read.
func normalizeAttachmentPurpose(raw string) (files.UploadPurpose, error) {
	switch purpose := files.UploadPurpose(strings.TrimSpace(raw)); purpose {
	case "", files.TaskAttachment:
		return files.TaskAttachment, nil
	case files.TaskDescriptionImage, files.TaskCommentAttachment:
		return purpose, nil
	default:
		return "", coded(http.StatusBadRequest, "attachment_purpose_invalid", "purpose không hợp lệ")
	}
}

// attachmentUploadError keeps the codes the upload endpoints already publish:
// the registry's cap and allowlist answer as the 413/400 the legacy path
// returned, and everything else travels through filesError unchanged.
func attachmentUploadError(err error) error {
	var fe *files.Error
	if errors.As(err, &fe) {
		switch fe.Code {
		case files.CodeTooLarge:
			return coded(http.StatusRequestEntityTooLarge, "attachment_too_large", "tệp vượt quá giới hạn 25 MiB")
		case files.CodeTypeRejected:
			return coded(http.StatusBadRequest, "attachment_mime_rejected", "loại tệp không được hỗ trợ")
		}
	}
	return filesError(err)
}

// errAttachmentNotAvailable is the create-time refusal, shared by the legacy
// bind-count check and the FileService claim: staged file gone, expired or
// bound elsewhere all read the same to the caller.
func errAttachmentNotAvailable() error {
	return coded(http.StatusUnprocessableEntity, "attachment_not_available", "đính kèm không tồn tại, đã hết hạn hoặc đã được sử dụng")
}

// uploadAttachmentFS is the FileService branch of uploadAttachment: the bytes
// and the MIME/size policy live in files.Upload, and a task-bound row claims
// the file in the same transaction that writes it. A staged (task-less) row
// stays unclaimed — task create claims it inside its own transaction.
// contentType and size are the client's claims; FileService never trusts them,
// so this path does not even read them.
func (s *TaskService) uploadAttachmentFS(ctx context.Context, actor Actor, organizationID, workspaceID string, taskID *string, purpose files.UploadPurpose, filename string, r io.Reader) (db.Attachment, error) {
	uploaderType := commentActorType(actor.Kind)
	if uploaderType != "member" && uploaderType != "agent" {
		return db.Attachment{}, ErrForbidden
	}
	scope := taskFileScope(organizationID, workspaceID)
	up, err := s.files.Upload(ctx, files.UploadInput{
		Actor: actor, Purpose: purpose, Scope: scope,
		IdempotencyKey: "att-" + util.NewID(),
		Filename:       filename,
		Body:           r,
	})
	if err != nil {
		return db.Attachment{}, attachmentUploadError(err)
	}
	fileID := up.File.ID
	// A failure below leaves a staged-but-unreferenced file; cancel it so it
	// does not wait out the 24h claim window. Best-effort: a claim the caller
	// already committed answers already_claimed, which is safe to drop.
	cancel := func() {
		_ = s.files.CancelUpload(ctx, files.CancelInput{Actor: actor, Scope: scope, FileID: fileID})
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		cancel()
		return db.Attachment{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	att, err := q.InsertAttachment(ctx, db.InsertAttachmentParams{
		ID:             util.NewID(),
		OrganizationID: organizationID,
		WorkspaceID:    workspaceID,
		TaskID:         optText(taskID),
		CommentID:      pgtype.Text{},
		UploaderType:   uploaderType,
		UploaderID:     actor.ID,
		ObjectKey:      pgtype.Text{},
		ObjectUrl:      pgtype.Text{},
		Filename:       up.File.Filename,
		ContentType:    up.File.ContentType,
		Metadata:       []byte("{}"),
		SizeBytes:      up.File.SizeBytes,
		ExpiresAt:      pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: taskID == nil},
		FileID:         pgtype.Text{String: string(fileID), Valid: true},
		Purpose:        pgtype.Text{String: string(purpose), Valid: true},
	})
	if err != nil {
		cancel()
		return db.Attachment{}, err
	}
	if taskID != nil {
		// A task-bound row claims at once: the file is referenced the moment
		// this transaction commits, and a refusal rolls the row back with it.
		if _, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: actor, Purpose: purpose, Scope: scope, FileIDs: []files.FileID{fileID},
		}); err != nil {
			cancel()
			return db.Attachment{}, filesError(err)
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: organizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionAttachmentUploaded,
		ResourceType: "attachment", ResourceID: att.ID,
		Metadata: map[string]any{"task_id": taskID, "filename": att.Filename, "temporary": taskID == nil},
	}, attachmentUploadEvent(att, taskID)); err != nil {
		cancel()
		return db.Attachment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		cancel()
		return db.Attachment{}, err
	}
	return att, nil
}

// claimBoundAttachmentsInTx claims every file-backed row BindAttachmentsToTask
// just bound, grouped by the purpose the row was uploaded with. It runs inside
// the task-create transaction, so a refused claim rolls the task back with it
// and leaves the files staged for a retry.
func (s *TaskService) claimBoundAttachmentsInTx(ctx context.Context, q *db.Queries, actor Actor, ws db.Workspace, workspaceID string, attachmentIDs []string) error {
	if s.files == nil || len(attachmentIDs) == 0 {
		return nil
	}
	refs, err := q.ListAttachmentFileRefsByIDs(ctx, db.ListAttachmentFileRefsByIDsParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, AttachmentIds: attachmentIDs,
	})
	if err != nil {
		return err
	}
	byPurpose := map[files.UploadPurpose][]files.FileID{}
	for _, ref := range refs {
		if !ref.FileID.Valid || !ref.Purpose.Valid {
			continue
		}
		purpose := files.UploadPurpose(ref.Purpose.String)
		byPurpose[purpose] = append(byPurpose[purpose], files.FileID(ref.FileID.String))
	}
	scope := taskFileScope(ws.OrganizationID, workspaceID)
	for _, purpose := range []files.UploadPurpose{files.TaskAttachment, files.TaskDescriptionImage, files.TaskCommentAttachment} {
		ids := byPurpose[purpose]
		if len(ids) == 0 {
			continue
		}
		if _, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: actor, Purpose: purpose, Scope: scope, FileIDs: ids,
		}); err != nil {
			return errAttachmentNotAvailable()
		}
	}
	return nil
}

// releaseFilesInTx is the shared unlink: it records the file ids a removal
// just dropped inside the same transaction, and the collector — not this
// call — decides whether the bytes die. A file the collector already deleted
// answers file_not_found: the unlink goal already holds, so it is not an
// error the transaction should roll back for.
func releaseFilesInTx(ctx context.Context, f files.Service, q *db.Queries, ids []files.FileID) error {
	if f == nil || len(ids) == 0 {
		return nil
	}
	if err := f.ReleaseInTx(ctx, q, ids); err != nil {
		var fe *files.Error
		if errors.As(err, &fe) && fe.Code == files.CodeNotFound {
			return nil
		}
		return filesError(err)
	}
	return nil
}

// attachmentFileIDs converts a nullable-text id list to FileIDs, skipping the
// empty values a NULL-tolerant query can produce.
func attachmentFileIDs(rows []pgtype.Text) []files.FileID {
	out := make([]files.FileID, 0, len(rows))
	for _, r := range rows {
		if r.Valid && r.String != "" {
			out = append(out, files.FileID(r.String))
		}
	}
	return out
}

// TaskAttachmentProvider is the reference provider for the three task-side
// purposes (FS-C1 section 6). The query it wraps decides every hold — a bound
// row, an open staging window, or an attachment URL still embedded in a live
// task description or comment body — so HeldBy only translates rows into the
// held set.
type TaskAttachmentProvider struct{}

func NewTaskAttachmentProvider() TaskAttachmentProvider { return TaskAttachmentProvider{} }

func (TaskAttachmentProvider) Name() string { return "tasks.attachments" }

func (TaskAttachmentProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.TaskAttachment, files.TaskDescriptionImage, files.TaskCommentAttachment}
}

func (TaskAttachmentProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := map[files.FileID]files.HoldReason{}
	if len(ids) == 0 {
		return out, nil
	}
	raw := make([]string, 0, len(ids))
	for _, id := range ids {
		raw = append(raw, string(id))
	}
	rows, err := q.ListAttachmentFileHolds(ctx, raw)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row.FileID.Valid {
			out[files.FileID(row.FileID.String)] = files.HoldActive
		}
	}
	return out, nil
}
