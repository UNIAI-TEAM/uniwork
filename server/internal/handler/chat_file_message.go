package handler

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/oklog/ulid/v2"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

const chatFileMultipartHeadroom = 256 << 10

func sniffChatFileContentType(data []byte, filename string) (string, bool) {
	detected := http.DetectContentType(data)
	if i := strings.IndexByte(detected, ';'); i >= 0 {
		detected = detected[:i]
	}
	detected = strings.ToLower(strings.TrimSpace(detected))
	if service.ExtForChatFileContentType(detected) != "" {
		return detected, true
	}
	// DetectContentType often returns application/octet-stream for PDF/text;
	// fall back to extension when the magic is ambiguous.
	ext := strings.ToLower(path.Ext(filename))
	switch ext {
	case ".pdf":
		if len(data) >= 5 && bytes.Equal(data[:5], []byte("%PDF-")) {
			return "application/pdf", true
		}
	case ".txt":
		return "text/plain", true
	case ".jpg", ".jpeg":
		return "image/jpeg", true
	case ".png":
		return "image/png", true
	case ".gif":
		return "image/gif", true
	case ".webp":
		return "image/webp", true
	case ".docx":
		if len(data) >= 2 && data[0] == 'P' && data[1] == 'K' {
			return "application/vnd.openxmlformats-officedocument.wordprocessingml.document", true
		}
	case ".xlsx":
		if len(data) >= 2 && data[0] == 'P' && data[1] == 'K' {
			return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", true
		}
	}
	return "", false
}

func (h *handlers) sendChatFileMessage(w http.ResponseWriter, r *http.Request) {
	// T7 selectable path: a wired FileService takes the FS flow below; nil keeps
	// the legacy storage pipeline byte-identical until the module cutover
	// (plan §7 step 8 / T9c removes it).
	if h.Chat.FilesService() != nil {
		h.sendChatFileMessageFS(w, r)
		return
	}
	if h.Storage == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file storage is not configured")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, service.MaxChatFileMessageBytes+chatFileMultipartHeadroom)
	file, header, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			respondError(w, http.StatusRequestEntityTooLarge, "too_large", "file must be at most 25 MiB")
			return
		}
		respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" is required`)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, service.MaxChatFileMessageBytes+1))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "could not read file")
		return
	}
	if len(data) > service.MaxChatFileMessageBytes {
		respondError(w, http.StatusRequestEntityTooLarge, "too_large", "file must be at most 25 MiB")
		return
	}
	filename := ""
	if header != nil {
		filename = header.Filename
	}
	contentType, ok := sniffChatFileContentType(data, filename)
	if !ok {
		respondError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "file must be JPEG, PNG, GIF, WebP, PDF, or plain text")
		return
	}
	var replyTo *string
	if raw := strings.TrimSpace(r.FormValue("reply_to_message_id")); raw != "" {
		replyTo = &raw
	}
	ctx := r.Context()
	userID := middleware.UserID(ctx)
	workspaceID := chi.URLParam(r, "workspaceID")
	roomID := chi.URLParam(r, "roomID")
	prep, err := h.Chat.PrepareFileMessage(ctx, userID, workspaceID, roomID, service.PrepareFileMessageInput{
		Filename:         filename,
		ContentType:      contentType,
		SizeBytes:        int64(len(data)),
		ReplyToMessageID: replyTo,
		ClientMsgID:      strings.TrimSpace(r.FormValue("client_msg_id")),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	if prep.Existing != nil {
		respondJSON(w, http.StatusOK, map[string]any{"message": toChatMessageDTO(*prep.Existing)})
		return
	}

	ext := service.ExtForChatFileContentType(contentType)
	objectKey := path.Join(
		strings.TrimSuffix(storage.PrefixChatFiles, "/"),
		prep.OrganizationID,
		roomID,
		strings.ToLower(ulid.Make().String())+"."+ext,
	)
	if _, err := h.Storage.Upload(ctx, objectKey, data, contentType, prep.Filename()); err != nil {
		h.Log.Error("chat file upload", "err", err, "room_id", roomID)
		respondError(w, http.StatusInternalServerError, "internal", "could not store file")
		return
	}
	msg, created, err := h.Chat.CreateFileMessage(ctx, userID, objectKey, prep)
	if err != nil {
		h.Storage.Delete(ctx, objectKey)
		h.mapServiceError(w, err)
		return
	}
	if !created {
		h.Storage.Delete(ctx, objectKey)
	}
	respondJSON(w, http.StatusOK, map[string]any{"message": toChatMessageDTO(msg)})
}

// sendChatFileMessageFS is the FileService send: the handler only unpacks the
// multipart envelope; verification, dedupe and claim all live in the service.
// The room gate and the byte budget run before the body is read, and the file
// part reaches the service disk-backed, never as a heap copy (C7).
func (h *handlers) sendChatFileMessageFS(w http.ResponseWriter, r *http.Request) {
	const tooLarge = "file must be at most 25 MiB"
	release, ok := beginUpload(w, r, uploads, service.MaxChatFileMessageBytes+chatFileMultipartHeadroom, tooLarge)
	if !ok {
		return
	}
	defer release()
	ctx := r.Context()
	userID, workspaceID, roomID := middleware.UserID(ctx), chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID")
	if err := h.Chat.AuthorizeMediaSend(ctx, userID, workspaceID, roomID); err != nil {
		h.mapServiceError(w, err)
		return
	}
	file, header, ok := uploadFormFile(w, r, tooLarge)
	if !ok {
		return
	}
	defer file.Close()
	if header.Size > service.MaxChatFileMessageBytes {
		respondError(w, http.StatusRequestEntityTooLarge, "too_large", tooLarge)
		return
	}
	var replyTo *string
	if raw := strings.TrimSpace(r.FormValue("reply_to_message_id")); raw != "" {
		replyTo = &raw
	}
	msg, err := h.Chat.SendFileMessage(ctx, userID, workspaceID, roomID, service.SendFileMessageInput{
		Filename:         header.Filename,
		Body:             file,
		ReplyToMessageID: replyTo,
		ClientMsgID:      strings.TrimSpace(r.FormValue("client_msg_id")),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"message": toChatMessageDTO(msg)})
}

func (h *handlers) streamChatFileMessage(w http.ResponseWriter, r *http.Request) {
	// Reader handles rows written by either path: file_id rows open through
	// FileService, object_key rows still read the storage object (which has
	// no thumbnails, so a variant there serves the original).
	thumb, ok := chatFileThumb(w, r)
	if !ok {
		return
	}
	if h.Chat.FilesService() != nil {
		h.streamChatFileMessageFS(w, r, thumb)
		return
	}
	if h.Storage == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file storage is not configured")
		return
	}
	msg, err := h.Chat.GetFileMessage(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "messageID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	reader, err := h.Storage.GetReader(r.Context(), msg.File.ObjectKey)
	if err != nil {
		h.Log.Error("chat file read", "err", err, "message_id", msg.ID)
		respondError(w, http.StatusNotFound, "not_found", "file content not found")
		return
	}
	defer reader.Close()

	setChatFileHeaders(w, msg.File.ContentType, msg.File.SizeBytes, msg.File.Filename)
	if _, err := io.Copy(w, reader); err != nil {
		h.Log.Error("chat file stream", "err", err, "message_id", msg.ID)
	}
}

// streamChatFileMessageFS opens through FileService; a pre-migration row still
// serves its storage object until the T9b backfill lands.
func (h *handlers) streamChatFileMessageFS(w http.ResponseWriter, r *http.Request, thumb bool) {
	ctx := r.Context()
	msg, reader, err := h.Chat.OpenChatFileMessage(
		ctx,
		middleware.UserID(ctx),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "messageID"),
		thumb,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	var body io.ReadCloser
	if reader.Body != nil {
		body = reader.Body
	} else {
		if h.Storage == nil || msg.File.ObjectKey == "" {
			respondError(w, http.StatusNotFound, "not_found", "file content not found")
			return
		}
		legacy, err := h.Storage.GetReader(ctx, msg.File.ObjectKey)
		if err != nil {
			h.Log.Error("chat file read", "err", err, "message_id", msg.ID)
			respondError(w, http.StatusNotFound, "not_found", "file content not found")
			return
		}
		body = legacy
	}
	defer body.Close()

	// A thumbnail differs from the message's snapshot; FileService says what
	// it streamed.
	contentType, size := msg.File.ContentType, msg.File.SizeBytes
	if reader.Body != nil {
		contentType, size = reader.File.ContentType, reader.File.SizeBytes
	}
	setChatFileHeaders(w, contentType, size, msg.File.Filename)
	if _, err := io.Copy(w, body); err != nil {
		h.Log.Error("chat file stream", "err", err, "message_id", msg.ID)
	}
}

// chatFileThumb reads ?variant=: "" is the original, "thumb" the photo's
// thumbnail; anything else is refused before the room is even looked at.
func chatFileThumb(w http.ResponseWriter, r *http.Request) (thumb, ok bool) {
	switch r.URL.Query().Get("variant") {
	case "":
		return false, true
	case "thumb":
		return true, true
	default:
		respondError(w, http.StatusBadRequest, "invalid_request", `variant must be "thumb" or absent`)
		return false, false
	}
}

// setChatFileHeaders: every viewer scrolling a busy room re-requests its
// photos, so an image may sit in the private browser cache for a minute (a
// revoked member keeps what they already saw for at most that long). Other
// files stay no-store and download as attachments.
func setChatFileHeaders(w http.ResponseWriter, contentType string, size int64, filename string) {
	disposition, cache := "attachment", "private, no-store"
	if strings.HasPrefix(contentType, "image/") {
		disposition, cache = "inline", "private, max-age=60"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
	w.Header().Set("Cache-Control", cache)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename=%q`, disposition, filename))
	w.Header().Set("X-Content-Type-Options", "nosniff")
}
