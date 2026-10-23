package handler

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// shareChatMessageAsDocument is POST
// .../chat/rooms/{roomID}/messages/{messageID}/share-as-document (UNI-1966
// §2.2, S10; UNI-2012 D1a/D1b): copies the caller's own file attachment into a
// new Document at the root of the workspace the sender stands in, grants the
// room's current human members at share_level, and flips the message in place
// to kind="document" with the same id.
func (h *handlers) shareChatMessageAsDocument(w http.ResponseWriter, r *http.Request) {
	if h.Chat == nil || h.Chat.FilesService() == nil || h.Chat.DocumentsService() == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.ShareChatMessageAsDocumentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	ctx := r.Context()
	msg, err := h.Chat.ShareAttachmentAsDocument(
		ctx,
		middleware.UserID(ctx),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "messageID"),
		service.ShareAttachmentAsDocumentInput{
			ShareLevel:  strings.TrimSpace(in.ShareLevel),
			ClientMsgID: strings.TrimSpace(in.ClientMsgID),
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"message": toChatMessageDTO(msg)})
}
