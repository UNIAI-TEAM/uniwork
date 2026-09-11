package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) createChatChannel(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateChatChannelSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	room, err := h.Chat.CreateChannel(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), service.CreateChannelInput{
		Name: in.Name, Visibility: in.Visibility, Topic: in.Topic,
		ProjectID: in.ProjectID, MemberUserIDs: in.MemberUserIDs,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, map[string]any{"room": toChatRoomDTO(room)})
}

func (h *handlers) listChatChannels(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	rooms, err := h.Chat.ListChannels(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), service.ListChannelsInput{
		Scope: q.Get("scope"), ProjectID: q.Get("project_id"), Query: q.Get("q"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatRoomDTO, 0, len(rooms))
	for _, room := range rooms {
		out = append(out, toChatRoomDTO(room))
	}
	respondJSON(w, http.StatusOK, sdo.ChatChannelListSDO{Rooms: out})
}

func (h *handlers) listProjectChatChannels(w http.ResponseWriter, r *http.Request) {
	rooms, err := h.Chat.ListProjectChannels(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "projectID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatRoomDTO, 0, len(rooms))
	for _, room := range rooms {
		out = append(out, toChatRoomDTO(room))
	}
	respondJSON(w, http.StatusOK, sdo.ChatChannelListSDO{Rooms: out})
}

func (h *handlers) updateChatChannel(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw, maxJSONBody) {
		return
	}
	var in sdi.UpdateChatChannelSDI
	buf, _ := json.Marshal(raw)
	if err := json.Unmarshal(buf, &in); err != nil {
		respondError(w, http.StatusBadRequest, "invalid_json", "JSON không hợp lệ")
		return
	}
	clearProject := false
	if v, ok := raw["project_id"]; ok && string(v) == "null" {
		clearProject = true
		in.ProjectID = nil
	}
	room, err := h.Chat.UpdateChannel(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"),
		service.UpdateChannelInput{
			Name: in.Name, Topic: in.Topic, Visibility: in.Visibility,
			ProjectID: in.ProjectID, ClearProject: clearProject,
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"room": toChatRoomDTO(room)})
}

func (h *handlers) joinChatChannel(w http.ResponseWriter, r *http.Request) {
	room, err := h.Chat.JoinChannel(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"room": toChatRoomDTO(room)})
}

func (h *handlers) archiveChatChannel(w http.ResponseWriter, r *http.Request) {
	err := h.Chat.ArchiveChannel(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) unarchiveChatChannel(w http.ResponseWriter, r *http.Request) {
	err := h.Chat.UnarchiveChannel(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}
