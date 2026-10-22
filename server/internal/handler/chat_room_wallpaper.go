package handler

import (
	"errors"
	"fmt"
	"net/http"
	"path"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
)

const maxChatRoomWallpaperBytes = 900_000

func (h *handlers) uploadChatRoomWallpaper(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "roomID")
	wsID := chi.URLParam(r, "workspaceID")
	actorID := middleware.UserID(r.Context())
	if _, err := h.Chat.GetRoomMemberPermissions(r.Context(), actorID, wsID, roomID); err != nil {
		h.mapServiceError(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxChatRoomWallpaperBytes+64<<10)
	file, header, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			respondError(w, http.StatusRequestEntityTooLarge, "too_large", fmt.Sprintf("wallpaper must be at most %d bytes", maxChatRoomWallpaperBytes))
			return
		}
		respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" is required`)
		return
	}
	defer file.Close()

	filename := "wallpaper"
	if header != nil {
		if base := path.Base(header.Filename); base != "" && base != "." && base != ".." {
			filename = base
		}
	}
	room, err := h.Chat.UploadRoomWallpaper(r.Context(), actorID, wsID, roomID, filename, file)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"room": toChatRoomDTO(room)})
}
