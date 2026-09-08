package handler

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/oklog/ulid/v2"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

const chatVoiceMultipartHeadroom = 64 << 10

var chatVoiceExtByType = map[string]string{
	"audio/webm": "webm",
	"audio/ogg":  "ogg",
	"audio/mp4":  "m4a",
}

func sniffChatVoiceContentType(data []byte) (string, bool) {
	switch {
	case len(data) >= 4 && bytes.Equal(data[:4], []byte("OggS")):
		return "audio/ogg", true
	case len(data) >= 4 && bytes.Equal(data[:4], []byte{0x1a, 0x45, 0xdf, 0xa3}):
		// DetectContentType reports WebM as application/octet-stream on some
		// Go versions; the EBML magic is the reliable container signature.
		return "audio/webm", true
	case len(data) >= 12 && bytes.Equal(data[4:8], []byte("ftyp")):
		return "audio/mp4", true
	default:
		return "", false
	}
}

func (h *handlers) sendChatVoiceMessage(w http.ResponseWriter, r *http.Request) {
	if h.Storage == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file storage is not configured")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, service.MaxChatVoiceMessageBytes+chatVoiceMultipartHeadroom)
	file, _, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			respondError(w, http.StatusRequestEntityTooLarge, "too_large", "voice message must be at most 4 MiB")
			return
		}
		respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" is required`)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, service.MaxChatVoiceMessageBytes+1))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "could not read voice message")
		return
	}
	if len(data) > service.MaxChatVoiceMessageBytes {
		respondError(w, http.StatusRequestEntityTooLarge, "too_large", "voice message must be at most 4 MiB")
		return
	}
	contentType, ok := sniffChatVoiceContentType(data)
	if !ok {
		respondError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "voice message must be WebM, Ogg, or MP4 audio")
		return
	}
	durationMS, err := strconv.Atoi(strings.TrimSpace(r.FormValue("duration_ms")))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "duration_ms must be an integer")
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
	prep, err := h.Chat.PrepareVoiceMessage(ctx, userID, workspaceID, roomID, service.PrepareVoiceMessageInput{
		DurationMS:       durationMS,
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

	ext := chatVoiceExtByType[contentType]
	objectKey := path.Join(
		strings.TrimSuffix(storage.PrefixChatVoice, "/"),
		prep.OrganizationID,
		roomID,
		strings.ToLower(ulid.Make().String())+"."+ext,
	)
	if _, err := h.Storage.Upload(ctx, objectKey, data, contentType, "voice."+ext); err != nil {
		h.Log.Error("chat voice upload", "err", err, "room_id", roomID)
		respondError(w, http.StatusInternalServerError, "internal", "could not store voice message")
		return
	}
	msg, created, err := h.Chat.CreateVoiceMessage(ctx, userID, objectKey, prep)
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

func (h *handlers) streamChatVoiceMessage(w http.ResponseWriter, r *http.Request) {
	if h.Storage == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file storage is not configured")
		return
	}
	msg, err := h.Chat.GetVoiceMessage(
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
	reader, err := h.Storage.GetReader(r.Context(), msg.Voice.ObjectKey)
	if err != nil {
		h.Log.Error("chat voice read", "err", err, "message_id", msg.ID)
		respondError(w, http.StatusNotFound, "not_found", "voice content not found")
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", msg.Voice.ContentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", msg.Voice.SizeBytes))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if _, err := io.Copy(w, reader); err != nil {
		h.Log.Error("chat voice stream", "err", err, "message_id", msg.ID)
	}
}
