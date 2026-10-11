package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// MaxAttachmentBytes is the per-file upload cap (25 MiB).
const MaxAttachmentBytes int64 = 25 << 20

var allowedAttachmentMIME = map[string]bool{
	"image/jpeg":         true,
	"image/png":          true,
	"image/gif":          true,
	"image/webp":         true,
	"image/bmp":          true,
	"video/mp4":          true,
	"application/pdf":    true,
	"text/markdown":      true,
	"text/plain":         true,
	"application/msword": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
	"application/vnd.ms-excel": true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         true,
	"application/vnd.ms-powerpoint":                                             true,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
}

func (s *TaskService) requireStorage() error {
	if s.storage == nil {
		return collaborationUnavailable("attachment_storage_missing", "đính kèm chưa khả dụng")
	}
	return nil
}

func normalizeAttachmentContentType(ct string) string {
	ct = strings.ToLower(strings.TrimSpace(ct))
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return ct
}

func validateAttachmentMIME(ct string) (string, error) {
	ct = normalizeAttachmentContentType(ct)
	if ct == "" || !allowedAttachmentMIME[ct] {
		return "", coded(http.StatusBadRequest, "attachment_mime_rejected", "loại tệp không được hỗ trợ")
	}
	return ct, nil
}

func safeAttachmentFilename(name string) string {
	name = strings.TrimSpace(name)
	name = filepath.Base(name)
	if name == "" || name == "." || name == ".." {
		return "file"
	}
	var b strings.Builder
	b.Grow(len(name))
	for _, r := range name {
		if r < 0x20 || r == 0x7f || r == '/' || r == '\\' || r == '"' || r == ';' {
			b.WriteRune('_')
			continue
		}
		if !unicode.IsPrint(r) {
			b.WriteRune('_')
			continue
		}
		b.WriteRune(r)
	}
	out := strings.TrimSpace(b.String())
	if out == "" || out == "." || out == ".." {
		return "file"
	}
	return out
}

func attachmentObjectKey(workspaceID, attachmentID, filename string) string {
	return "workspaces/" + workspaceID + "/attachments/" + attachmentID + "/" + filename
}

func (s *TaskService) loadAttachment(ctx context.Context, actor Actor, attachmentID string) (db.Attachment, error) {
	att, err := s.q.GetAttachmentByID(ctx, attachmentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Attachment{}, ErrNotFound
		}
		return db.Attachment{}, err
	}
	if err := s.ws.requireActorMember(ctx, att.WorkspaceID, actor); err != nil {
		return db.Attachment{}, err
	}
	if !att.TaskID.Valid && !att.CommentID.Valid {
		if att.UploaderID != actor.ID || att.UploaderType != commentActorType(actor.Kind) {
			return db.Attachment{}, ErrNotFound
		}
		if att.ExpiresAt.Valid && time.Now().After(att.ExpiresAt.Time) {
			return db.Attachment{}, ErrNotFound
		}
	}
	return att, nil
}

// ListTaskAttachments returns attachments for a task the actor can see.
func (s *TaskService) ListTaskAttachments(ctx context.Context, actor Actor, taskID string) ([]db.Attachment, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return nil, err
	}
	return s.q.ListAttachmentsByTask(ctx, db.ListAttachmentsByTaskParams{
		OrganizationID: task.OrganizationID,
		WorkspaceID:    task.WorkspaceID,
		TaskID:         pgtype.Text{String: taskID, Valid: true},
	})
}

// UploadTaskAttachment stores the object then inserts the attachments row.
// purpose is one of the task-side registry purposes; "" means task_attachment.
func (s *TaskService) UploadTaskAttachment(ctx context.Context, actor Actor, taskID, purpose, filename, contentType string, size int64, r io.Reader) (db.Attachment, error) {
	p, err := normalizeAttachmentPurpose(purpose)
	if err != nil {
		return db.Attachment{}, err
	}
	if s.files == nil {
		if err := s.requireStorage(); err != nil {
			return db.Attachment{}, err
		}
	}
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return db.Attachment{}, err
	}
	return s.uploadAttachment(ctx, actor, task.OrganizationID, task.WorkspaceID, &taskID, p, filename, contentType, size, r)
}

// AuthorizeAttachmentUpload is the gate of UploadTaskAttachment (taskID set)
// or UploadWorkspaceAttachment, exposed so the upload handlers can refuse an
// outsider before reading a byte of the body.
func (s *TaskService) AuthorizeAttachmentUpload(ctx context.Context, actor Actor, taskID, workspaceID string) error {
	if taskID != "" {
		_, err := s.authorizeActor(ctx, actor, taskID)
		return err
	}
	return s.ws.requireActorMember(ctx, workspaceID, actor)
}

// UploadWorkspaceAttachment stages a file before its task exists. CreateTaskSuite
// claims the returned id atomically; unclaimed rows expire after 24 hours.
func (s *TaskService) UploadWorkspaceAttachment(ctx context.Context, actor Actor, workspaceID, purpose, filename, contentType string, size int64, r io.Reader) (db.Attachment, error) {
	p, err := normalizeAttachmentPurpose(purpose)
	if err != nil {
		return db.Attachment{}, err
	}
	if s.files == nil {
		if err := s.requireStorage(); err != nil {
			return db.Attachment{}, err
		}
	}
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.Attachment{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.Attachment{}, err
	}
	return s.uploadAttachment(ctx, actor, ws.OrganizationID, workspaceID, nil, p, filename, contentType, size, r)
}

// uploadAttachment dispatches on the module's selected storage path. A wired
// files.Service owns the whole write; nil stays on the legacy object store.
func (s *TaskService) uploadAttachment(ctx context.Context, actor Actor, organizationID, workspaceID string, taskID *string, purpose files.UploadPurpose, filename, contentType string, size int64, r io.Reader) (db.Attachment, error) {
	if s.files != nil {
		return s.uploadAttachmentFS(ctx, actor, organizationID, workspaceID, taskID, purpose, filename, r)
	}
	if size < 0 || size > MaxAttachmentBytes {
		return db.Attachment{}, coded(http.StatusRequestEntityTooLarge, "attachment_too_large", "tệp vượt quá giới hạn 25 MiB")
	}
	ct, err := validateAttachmentMIME(contentType)
	if err != nil {
		return db.Attachment{}, err
	}
	safeName := safeAttachmentFilename(filename)
	uploaderType := commentActorType(actor.Kind)
	if uploaderType != "member" && uploaderType != "agent" {
		return db.Attachment{}, ErrForbidden
	}

	data, err := io.ReadAll(io.LimitReader(r, MaxAttachmentBytes+1))
	if err != nil {
		return db.Attachment{}, err
	}
	if int64(len(data)) > MaxAttachmentBytes || (size > 0 && int64(len(data)) > size) {
		return db.Attachment{}, coded(http.StatusRequestEntityTooLarge, "attachment_too_large", "tệp vượt quá giới hạn 25 MiB")
	}
	if size > 0 && int64(len(data)) != size {
		// Declared size must match bytes read when the client sent Content-Length.
		return db.Attachment{}, coded(http.StatusBadRequest, "attachment_size_mismatch", "kích thước tệp không khớp")
	}
	actualSize := int64(len(data))

	id := util.NewID()
	key := attachmentObjectKey(workspaceID, id, safeName)
	objectURL, err := s.storage.Upload(ctx, key, data, ct, safeName)
	if err != nil {
		return db.Attachment{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		_ = s.storage.DeleteObject(ctx, key)
		return db.Attachment{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	att, err := q.InsertAttachment(ctx, db.InsertAttachmentParams{
		ID:             id,
		OrganizationID: organizationID,
		WorkspaceID:    workspaceID,
		TaskID:         optText(taskID),
		CommentID:      pgtype.Text{},
		UploaderType:   uploaderType,
		UploaderID:     actor.ID,
		ObjectKey:      pgtype.Text{String: key, Valid: true},
		ObjectUrl:      pgtype.Text{String: objectURL, Valid: objectURL != ""},
		Filename:       safeName,
		ContentType:    ct,
		Metadata:       []byte("{}"),
		SizeBytes:      actualSize,
		ExpiresAt:      pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: taskID == nil},
		Purpose:        pgtype.Text{String: string(purpose), Valid: true},
	})
	if err != nil {
		_ = s.storage.DeleteObject(ctx, key)
		return db.Attachment{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: organizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionAttachmentUploaded,
		ResourceType: "attachment", ResourceID: att.ID,
		Metadata: map[string]any{"task_id": taskID, "filename": safeName, "temporary": taskID == nil},
	}, attachmentUploadEvent(att, taskID)); err != nil {
		_ = s.storage.DeleteObject(ctx, key)
		return db.Attachment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		_ = s.storage.DeleteObject(ctx, key)
		return db.Attachment{}, err
	}
	return att, nil
}

func attachmentUploadEvent(att db.Attachment, taskID *string) audit.Event {
	if taskID == nil {
		return audit.Event{Topic: "attachment.staged", Payload: map[string]string{
			"attachment_id": att.ID, "workspace_id": att.WorkspaceID,
		}}
	}
	return audit.Event{Topic: "attachment.uploaded", Payload: map[string]string{
		"attachment_id": att.ID, "task_id": *taskID, "workspace_id": att.WorkspaceID,
	}}
}

// GetAttachment returns metadata after membership check.
func (s *TaskService) GetAttachment(ctx context.Context, actor Actor, attachmentID string) (db.Attachment, error) {
	return s.loadAttachment(ctx, actor, attachmentID)
}

// OpenAttachmentContent streams the stored object for preview/download. The
// row's file_id picks the path: FileService rows stream through files.Open,
// legacy rows through storage.
func (s *TaskService) OpenAttachmentContent(ctx context.Context, actor Actor, attachmentID string) (db.Attachment, io.ReadCloser, error) {
	att, err := s.loadAttachment(ctx, actor, attachmentID)
	if err != nil {
		return db.Attachment{}, nil, err
	}
	if att.FileID.Valid {
		if s.files == nil {
			// A file-backed row is not servable while the module is unwired —
			// its bytes were never on the legacy store.
			return db.Attachment{}, nil, ErrNotFound
		}
		r, err := s.files.Open(ctx, files.OpenInput{
			Scope:  taskFileScope(att.OrganizationID, att.WorkspaceID),
			FileID: files.FileID(att.FileID.String),
		})
		if err != nil {
			return db.Attachment{}, nil, filesError(err)
		}
		return att, r.Body, nil
	}
	if err := s.requireStorage(); err != nil {
		return db.Attachment{}, nil, err
	}
	r, err := s.storage.GetReader(ctx, att.ObjectKey.String)
	if err != nil {
		return db.Attachment{}, nil, err
	}
	return att, r, nil
}

// DeleteAttachment removes the DB row (audited) then schedules the bytes: a
// file-backed row releases through ReleaseInTx inside the transaction, a
// legacy row keeps the best-effort storage delete.
func (s *TaskService) DeleteAttachment(ctx context.Context, actor Actor, attachmentID string) error {
	att, err := s.loadAttachment(ctx, actor, attachmentID)
	if err != nil {
		return err
	}
	taskID := ""
	if att.TaskID.Valid {
		taskID = att.TaskID.String
	}
	metadata := map[string]any{"task_id": taskID}
	if att.ObjectKey.Valid {
		metadata["object_key"] = att.ObjectKey.String
	}
	if att.FileID.Valid {
		metadata["file_id"] = att.FileID.String
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if att.FileID.Valid {
		if s.files == nil {
			// A file-backed row cannot be removed correctly while the module
			// is unwired: the unlink has to reach FileService.
			return coded(http.StatusServiceUnavailable, "attachment_storage_missing", "đính kèm chưa khả dụng")
		}
		bound := att.TaskID.Valid || att.CommentID.Valid
		if bound {
			// The row held a claimed file; dropping the row drops the hold.
			// The release locks the files row before the delete touches the
			// attachments row (FS-C1 §5.4), and the provider re-check happens
			// in the collector, not here.
			if err := releaseFilesInTx(ctx, s.files, q, []files.FileID{files.FileID(att.FileID.String)}); err != nil {
				return err
			}
		}
	}
	if err := q.DeleteAttachment(ctx, db.DeleteAttachmentParams{
		ID: attachmentID, OrganizationID: att.OrganizationID, WorkspaceID: att.WorkspaceID,
	}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: att.OrganizationID, WorkspaceID: att.WorkspaceID,
		Actor: actor, Action: audit.ActionAttachmentDeleted,
		ResourceType: "attachment", ResourceID: attachmentID,
		Metadata: metadata,
	}, audit.Event{Topic: "attachment.deleted", Payload: map[string]string{
		"attachment_id": attachmentID, "task_id": taskID, "workspace_id": att.WorkspaceID,
	}}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	switch {
	case att.FileID.Valid && !att.TaskID.Valid && !att.CommentID.Valid:
		// A staged file was never claimed, so there is nothing to release —
		// cancelling closes its session instead of leaving it to expire.
		_ = s.files.CancelUpload(ctx, files.CancelInput{
			Actor:  actor,
			Scope:  taskFileScope(att.OrganizationID, att.WorkspaceID),
			FileID: files.FileID(att.FileID.String),
		})
	case !att.FileID.Valid && s.storage != nil:
		_ = s.storage.DeleteObject(ctx, att.ObjectKey.String)
	}
	return nil
}
