package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// sendChatDocumentMessage is POST .../chat/rooms/{roomID}/messages/document
// (UNI-1966 §2.1): the bytes become a Document in the sender's My Folder and
// every current human room member gets a share at share_level. The room gate
// runs before the body is read, and the caller is always a human
// (service.Human), the documents route's precedent: an agent has no room
// membership and no path here.
func (h *handlers) sendChatDocumentMessage(w http.ResponseWriter, r *http.Request) {
	if h.Chat == nil || h.Chat.FilesService() == nil || h.Chat.DocumentsService() == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	ctx := r.Context()
	userID, workspaceID, roomID := middleware.UserID(ctx), chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID")
	if err := h.Chat.AuthorizeDocumentSend(ctx, userID, workspaceID, roomID); err != nil {
		h.mapServiceError(w, err)
		return
	}
	// The documents route's byte budget, with the chat upload's seekable part:
	// the service hashes the body before storing it, so it needs a ReadSeeker,
	// and a document of up to DOCUMENT_MAX_BYTES is spooled to disk, never
	// held in heap.
	maxBytes := h.documentMaxBytes()
	tooLarge := fmt.Sprintf("document must be at most %d bytes", maxBytes)
	release, ok := beginUpload(w, r, uploads, h.documentFileMultipartCap(), tooLarge)
	if !ok {
		return
	}
	defer release()
	file, header, ok := uploadFormFile(w, r, tooLarge)
	if !ok {
		return
	}
	defer file.Close()
	if header.Size > maxBytes {
		documentTooLarge(w, maxBytes)
		return
	}
	var replyTo *string
	if raw := strings.TrimSpace(r.FormValue("reply_to_message_id")); raw != "" {
		replyTo = &raw
	}
	msg, err := h.Chat.SendDocumentMessage(ctx, userID, workspaceID, roomID, service.SendDocumentMessageInput{
		ShareLevel:       strings.TrimSpace(r.FormValue("share_level")),
		Title:            strings.TrimSpace(r.FormValue("title")),
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

// getChatRoomDetail is GET .../chat/rooms/{roomID} (UNI-1966 L5): the one room
// a caller is looking at, so the composer learns can_send_document before it
// offers the picker. The room list never carries the flag: computing it per
// list row would be a member and share read per room.
func (h *handlers) getChatRoomDetail(w http.ResponseWriter, r *http.Request) {
	room, err := h.Chat.GetRoomSummary(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"room": toChatRoomDTO(room)})
}
