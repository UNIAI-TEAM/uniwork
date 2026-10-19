package handler

import (
	"errors"
	"fmt"
	"net/http"
	"path"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
)

// maxChatRoomAvatarBytes mirrors the chat_room_avatar purpose cap.
const maxChatRoomAvatarBytes = 2 << 20

func (h *handlers) uploadChatRoomAvatar(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxChatRoomAvatarBytes+64<<10)
	file, header, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			respondError(w, http.StatusRequestEntityTooLarge, "too_large", fmt.Sprintf("avatar must be at most %d bytes", maxChatRoomAvatarBytes))
			return
		}
		respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" is required`)
		return
	}
	defer file.Close()

	filename := "avatar"
	if header != nil {
		if base := path.Base(header.Filename); base != "" && base != "." && base != ".." {
			filename = base
		}
	}
	room, err := h.Chat.UploadRoomAvatar(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"), filename, file)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"room": toChatRoomDTO(room)})
}

func (h *handlers) removeChatRoomAvatar(w http.ResponseWriter, r *http.Request) {
	room, err := h.Chat.RemoveRoomAvatar(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"room": toChatRoomDTO(room)})
}
