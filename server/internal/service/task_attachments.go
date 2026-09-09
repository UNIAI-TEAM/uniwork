package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
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
func (s *TaskService) UploadTaskAttachment(ctx context.Context, actor Actor, taskID, filename, contentType string, size int64, r io.Reader) (db.Attachment, error) {
	if err := s.requireStorage(); err != nil {
		return db.Attachment{}, err
	}
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return db.Attachment{}, err
	}
	if size < 0 || size > MaxAttachmentBytes {
		return db.Attachment{}, coded(http.StatusRequestEntityTooLarge, "attachment_too_large", "tệp vượt quá giới hạn 25 MiB")
	}
	ct, err := validateAttachmentMIME(contentType)
	if err != nil {
		return db.Attachment{}, err
	}
	safeName := safeAttachmentFilename(filename)
	uploaderType := s.commentActorType(actor.Kind)
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
	key := attachmentObjectKey(task.WorkspaceID, id, safeName)
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
		OrganizationID: task.OrganizationID,
		WorkspaceID:    task.WorkspaceID,
		TaskID:         pgtype.Text{String: taskID, Valid: true},
		CommentID:      pgtype.Text{},
		UploaderType:   uploaderType,
		UploaderID:     actor.ID,
		ObjectKey:      key,
		ObjectUrl:      pgtype.Text{String: objectURL, Valid: objectURL != ""},
		Filename:       safeName,
		ContentType:    ct,
		Metadata:       []byte("{}"),
		SizeBytes:      actualSize,
	})
	if err != nil {
		_ = s.storage.DeleteObject(ctx, key)
		return db.Attachment{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor: actor, Action: audit.ActionAttachmentUploaded,
		ResourceType: "attachment", ResourceID: att.ID,
		Metadata: map[string]any{"task_id": taskID, "filename": safeName},
	}, audit.Event{Topic: "attachment.uploaded", Payload: map[string]string{
		"attachment_id": att.ID, "task_id": taskID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		_ = s.storage.DeleteObject(ctx, key)
		return db.Attachment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		_ = s.storage.DeleteObject(ctx, key)
		return db.Attachment{}, err
	}
	return att, nil
}

// GetAttachment returns metadata after membership check.
func (s *TaskService) GetAttachment(ctx context.Context, actor Actor, attachmentID string) (db.Attachment, error) {
	return s.loadAttachment(ctx, actor, attachmentID)
}

// OpenAttachmentContent streams the stored object for preview/download.
func (s *TaskService) OpenAttachmentContent(ctx context.Context, actor Actor, attachmentID string) (db.Attachment, io.ReadCloser, error) {
	if err := s.requireStorage(); err != nil {
		return db.Attachment{}, nil, err
	}
	att, err := s.loadAttachment(ctx, actor, attachmentID)
	if err != nil {
		return db.Attachment{}, nil, err
	}
	r, err := s.storage.GetReader(ctx, att.ObjectKey)
	if err != nil {
		return db.Attachment{}, nil, err
	}
	return att, r, nil
}

// DeleteAttachment removes the DB row (audited) then best-effort deletes the object.
func (s *TaskService) DeleteAttachment(ctx context.Context, actor Actor, attachmentID string) error {
	att, err := s.loadAttachment(ctx, actor, attachmentID)
	if err != nil {
		return err
	}
	taskID := ""
	if att.TaskID.Valid {
		taskID = att.TaskID.String
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.DeleteAttachment(ctx, db.DeleteAttachmentParams{
		ID: attachmentID, OrganizationID: att.OrganizationID, WorkspaceID: att.WorkspaceID,
	}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: att.OrganizationID, WorkspaceID: att.WorkspaceID,
		Actor: actor, Action: audit.ActionAttachmentDeleted,
		ResourceType: "attachment", ResourceID: attachmentID,
		Metadata: map[string]any{"task_id": taskID, "object_key": att.ObjectKey},
	}, audit.Event{Topic: "attachment.deleted", Payload: map[string]string{
		"attachment_id": attachmentID, "task_id": taskID, "workspace_id": att.WorkspaceID,
	}}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if s.storage != nil {
		_ = s.storage.DeleteObject(ctx, att.ObjectKey)
	}
	return nil
}
