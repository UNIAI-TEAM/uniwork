package handler

import (
	"bytes"
	"errors"
	"fmt"
	"io"
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
	r.Body = http.MaxBytesReader(w, r.Body, service.MaxAttachmentBytes+attachmentMultipartHeadroom)
	file, header, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			respondError(w, http.StatusRequestEntityTooLarge, "too_large", "attachment must be at most 25 MiB")
			return
		}
		respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" is required`)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, service.MaxAttachmentBytes+1))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "could not read upload")
		return
	}
	if int64(len(data)) > service.MaxAttachmentBytes {
		respondError(w, http.StatusRequestEntityTooLarge, "too_large", "attachment must be at most 25 MiB")
		return
	}

	filename := "file"
	contentType := "application/octet-stream"
	if header != nil {
		if base := path.Base(header.Filename); base != "" && base != "." && base != ".." {
			filename = base
		}
		if ct := header.Header.Get("Content-Type"); ct != "" {
			contentType = ct
		}
	}
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = http.DetectContentType(data)
	}

	att, err := h.Tasks.UploadTaskAttachment(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "taskID"),
		filename,
		contentType,
		int64(len(data)),
		bytes.NewReader(data),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, attachmentDTO(att))
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
