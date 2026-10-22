package handler

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

const chatFileMultipartHeadroom = 256 << 10

// sendChatFileMessage uploads through FileService: the handler unpacks the
// multipart envelope; verification, dedupe and claim all live in the service.
func (h *handlers) sendChatFileMessage(w http.ResponseWriter, r *http.Request) {
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
