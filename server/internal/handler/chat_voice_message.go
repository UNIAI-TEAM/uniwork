package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

const chatVoiceMultipartHeadroom = 64 << 10

// sendChatVoiceMessage uploads through FileService: the handler unpacks the
// multipart envelope and duration; verification, dedupe and claim live in the service.
func (h *handlers) sendChatVoiceMessage(w http.ResponseWriter, r *http.Request) {
	const tooLarge = "voice message must be at most 4 MiB"
	release, ok := beginUpload(w, r, uploads, service.MaxChatVoiceMessageBytes+chatVoiceMultipartHeadroom, tooLarge)
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
	if header.Size > service.MaxChatVoiceMessageBytes {
		respondError(w, http.StatusRequestEntityTooLarge, "too_large", tooLarge)
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
	msg, err := h.Chat.SendVoiceMessage(ctx, userID, workspaceID, roomID, service.SendVoiceMessageInput{
		DurationMS:       durationMS,
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
