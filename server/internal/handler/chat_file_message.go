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
	}
	return "", false
}

func (h *handlers) sendChatFileMessage(w http.ResponseWriter, r *http.Request) {
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

func (h *handlers) streamChatFileMessage(w http.ResponseWriter, r *http.Request) {
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

	disposition := "attachment"
	if strings.HasPrefix(msg.File.ContentType, "image/") {
		disposition = "inline"
	}
	w.Header().Set("Content-Type", msg.File.ContentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", msg.File.SizeBytes))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename=%q`, disposition, msg.File.Filename))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if _, err := io.Copy(w, reader); err != nil {
		h.Log.Error("chat file stream", "err", err, "message_id", msg.ID)
	}
}
