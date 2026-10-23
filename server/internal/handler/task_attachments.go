package handler

import (
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const attachmentMultipartHeadroom = 64 << 10

func attachmentContentPath(id string) string {
	return "/api/v1/attachments/" + id + "/content"
}

func attachmentDownloadPath(id string) string {
	return "/api/v1/attachments/" + id + "/download"
}

func attachmentDTO(att db.Attachment) sdo.AttachmentDTO {
	out := sdo.AttachmentDTO{
		ID:           att.ID,
		WorkspaceID:  att.WorkspaceID,
		UploaderType: att.UploaderType,
		UploaderID:   att.UploaderID,
		Filename:     att.Filename,
		URL:          attachmentContentPath(att.ID),
		DownloadURL:  attachmentDownloadPath(att.ID),
		MarkdownURL:  attachmentDownloadPath(att.ID),
		ContentType:  att.ContentType,
		SizeBytes:    att.SizeBytes,
		CreatedAt:    att.CreatedAt.Time.Format(time.RFC3339),
	}
	if att.TaskID.Valid {
		v := att.TaskID.String
		out.TaskID = &v
	}
	if att.CommentID.Valid {
		v := att.CommentID.String
		out.CommentID = &v
	}
	return out
}

func (h *handlers) listTaskAttachments(w http.ResponseWriter, r *http.Request) {
	atts, err := h.Tasks.ListTaskAttachments(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AttachmentDTO, 0, len(atts))
	for _, att := range atts {
		out = append(out, attachmentDTO(att))
	}
	respondJSON(w, http.StatusOK, sdo.AttachmentListSDO{Attachments: out})
}

func (h *handlers) uploadTaskAttachment(w http.ResponseWriter, r *http.Request) {
	file, size, filename, contentType, release, ok := h.attachmentUpload(w, r)
	if !ok {
		return
	}
	defer release()
	defer file.Close()
	att, err := h.Tasks.UploadTaskAttachment(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "taskID"),
		r.FormValue("purpose"),
		filename,
		contentType,
		size,
		file,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, attachmentDTO(att))
}

func (h *handlers) uploadWorkspaceAttachment(w http.ResponseWriter, r *http.Request) {
	file, size, filename, contentType, release, ok := h.attachmentUpload(w, r)
	if !ok {
		return
	}
	defer release()
	defer file.Close()
	att, err := h.Tasks.UploadWorkspaceAttachment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), r.FormValue("purpose"), filename, contentType, size, file)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, attachmentDTO(att))
}

// attachmentUpload unpacks an attachment envelope without a heap copy of the
// file: the part arrives disk-backed (see uploadFormFile) and only its first
// 512 bytes are read to sniff a missing type before it is rewound (C7). The
// task or workspace gate runs before the body is read.
func (h *handlers) attachmentUpload(w http.ResponseWriter, r *http.Request) (file multipart.File, size int64, filename, contentType string, release func(), ok bool) {
	const tooLarge = "attachment must be at most 25 MiB"
	release, ok = beginUpload(w, r, uploads, service.MaxAttachmentBytes+attachmentMultipartHeadroom, tooLarge)
	if !ok {
		return nil, 0, "", "", nil, false
	}
	ctx := r.Context()
	if err := h.Tasks.AuthorizeAttachmentUpload(ctx, service.Human(middleware.UserID(ctx)), chi.URLParam(r, "taskID"), chi.URLParam(r, "workspaceID")); err != nil {
		release()
		h.mapServiceError(w, err)
		return nil, 0, "", "", nil, false
	}
	file, header, ok := uploadFormFile(w, r, tooLarge)
	if !ok {
		release()
		return nil, 0, "", "", nil, false
	}
	fail := func(status int, code, msg string) (multipart.File, int64, string, string, func(), bool) {
		_ = file.Close()
		release()
		respondError(w, status, code, msg)
		return nil, 0, "", "", nil, false
	}
	if header.Size > service.MaxAttachmentBytes {
		return fail(http.StatusRequestEntityTooLarge, "too_large", tooLarge)
	}
	filename, contentType = "file", header.Header.Get("Content-Type")
	if base := path.Base(header.Filename); base != "" && base != "." && base != ".." {
		filename = base
	}
	if contentType == "" || contentType == "application/octet-stream" {
		head := make([]byte, 512)
		n, err := io.ReadFull(file, head)
		if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
			return fail(http.StatusBadRequest, "invalid_request", "could not read upload")
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return fail(http.StatusBadRequest, "invalid_request", "could not read upload")
		}
		contentType = http.DetectContentType(head[:n])
	}
	return file, header.Size, filename, contentType, release, true
}

func (h *handlers) getAttachment(w http.ResponseWriter, r *http.Request) {
	att, err := h.Tasks.GetAttachment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "attachmentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, attachmentDTO(att))
}

func (h *handlers) deleteAttachment(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.DeleteAttachment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "attachmentID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) serveAttachmentStream(w http.ResponseWriter, r *http.Request, asDownload bool) {
	att, reader, err := h.Tasks.OpenAttachmentContent(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "attachmentID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", att.ContentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", att.SizeBytes))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if asDownload {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, att.Filename))
	} else {
		w.Header().Set("Content-Disposition", "inline")
	}
	if _, err := io.Copy(w, reader); err != nil {
		h.Log.Error("attachment stream", "err", err, "attachment_id", att.ID)
	}
}

func (h *handlers) getAttachmentContent(w http.ResponseWriter, r *http.Request) {
	h.serveAttachmentStream(w, r, false)
}

func (h *handlers) downloadAttachment(w http.ResponseWriter, r *http.Request) {
	h.serveAttachmentStream(w, r, true)
}
