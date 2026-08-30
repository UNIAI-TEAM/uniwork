package handler

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) getWorkspaceChatRoom(w http.ResponseWriter, r *http.Request) {
	status, err := h.Chat.GetWorkspaceRoom(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.WorkspaceChatRoomSDO{
		RoomID: status.RoomID, WorkspaceID: status.WorkspaceID, Enabled: status.Enabled,
	})
}

func (h *handlers) lookupChatUser(w http.ResponseWriter, r *http.Request) {
	callerID := middleware.UserID(r.Context())
	email := strings.TrimSpace(r.URL.Query().Get("email"))
	userID := strings.TrimSpace(r.URL.Query().Get("user_id"))
	var profile service.ChatUserProfile
	var err error
	switch {
	case userID != "":
		profile, err = h.Chat.LookupUserByID(r.Context(), callerID, userID)
	case email != "":
		profile, err = h.Chat.LookupUserByEmail(r.Context(), callerID, email)
	default:
		respondError(w, http.StatusBadRequest, "invalid_request", "email or user_id is required")
		return
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatUserLookupSDO{
		UserID: profile.UserID, Email: profile.Email, DisplayName: profile.DisplayName,
		MatrixUserID: profile.MatrixUserID, MatrixReady: profile.MatrixReady,
	})
}

func (h *handlers) ensureWorkspaceChatRoom(w http.ResponseWriter, r *http.Request) {
	var in sdi.EnsureWorkspaceChatRoomSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	room, err := h.Chat.EnsureWorkspaceRoom(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		in.MatrixAccessToken,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.WorkspaceChatRoomSDO{
		RoomID: room.RoomID, WorkspaceID: room.WorkspaceID, Enabled: true,
	})
}
