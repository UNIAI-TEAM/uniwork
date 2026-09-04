package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func toChatMessageDTO(m service.ChatMessageRow) sdo.ChatMessageDTO {
	kind := m.Kind
	if kind == "" {
		kind = "text"
	}
	out := sdo.ChatMessageDTO{
		ID: m.ID, RoomID: m.RoomID, WorkspaceID: m.WorkspaceID,
		SenderID: m.SenderID, SenderDisplayName: m.SenderDisplayName,
		Kind: kind, Body: m.Body, CreatedAt: m.CreatedAt.Format(time.RFC3339),
	}
	if m.ReplyToMessageID != nil {
		out.ReplyToMessageID = m.ReplyToMessageID
	}
	if len(m.Reactions) > 0 {
		out.Reactions = m.Reactions
	}
	if m.VoiceCall != nil {
		out.VoiceCall = &sdo.VoiceCallLogDTO{
			Outcome:         m.VoiceCall.Outcome,
			DurationSeconds: m.VoiceCall.DurationSeconds,
			CallerID:        m.VoiceCall.CallerID,
		}
	}
	return out
}

func toChatRoomDTO(r service.ChatRoomSummary) sdo.ChatRoomDTO {
	memberIDs := r.MemberUserIDs
	if memberIDs == nil {
		memberIDs = []string{}
	}
	return sdo.ChatRoomDTO{
		ID: r.ID, Kind: r.Kind, Name: r.Name, WorkspaceID: r.WorkspaceID,
		MemberUserIDs: memberIDs, UnreadCount: r.UnreadCount,
		PeerUserID: r.PeerUserID, PeerEmail: r.PeerEmail, PeerDisplayName: r.PeerDisplayName,
	}
}

func parseChatMessageListQuery(r *http.Request) (service.ListChatMessagesInput, error) {
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	var before *time.Time
	if raw := strings.TrimSpace(r.URL.Query().Get("before")); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return service.ListChatMessagesInput{}, err
		}
		before = &t
	}
	return service.ListChatMessagesInput{Before: before, Limit: limit}, nil
}

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
	wsID := chi.URLParam(r, "workspaceID")
	email := strings.TrimSpace(r.URL.Query().Get("email"))
	userID := strings.TrimSpace(r.URL.Query().Get("user_id"))
	var profile service.ChatUserProfile
	var err error
	switch {
	case userID != "":
		profile, err = h.Chat.LookupUserByID(r.Context(), callerID, wsID, userID)
	case email != "":
		profile, err = h.Chat.LookupUserByEmail(r.Context(), callerID, wsID, email)
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
	})
}

func (h *handlers) ensureWorkspaceChatRoom(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength > 0 {
		var in sdi.EnsureWorkspaceChatRoomSDI
		if !decode(w, r, &in, maxJSONBody) {
			return
		}
	}
	room, err := h.Chat.EnsureWorkspaceRoom(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.WorkspaceChatRoomSDO{
		RoomID: room.RoomID, WorkspaceID: room.WorkspaceID, Enabled: true,
	})
}

func (h *handlers) listWorkspaceChatMessages(w http.ResponseWriter, r *http.Request) {
	wsID := chi.URLParam(r, "workspaceID")
	in, err := parseChatMessageListQuery(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "before must be RFC3339")
		return
	}
	msgs, err := h.Chat.ListWorkspaceMessages(r.Context(), middleware.UserID(r.Context()), wsID, in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatMessageDTO, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, toChatMessageDTO(m))
	}
	respondJSON(w, http.StatusOK, map[string]any{"messages": out})
}

func (h *handlers) sendWorkspaceChatMessage(w http.ResponseWriter, r *http.Request) {
	var in sdi.SendChatMessageSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	msg, err := h.Chat.SendWorkspaceMessage(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		service.SendChatMessageInput{Body: in.Body, ReplyToMessageID: in.ReplyToMessageID},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"message": toChatMessageDTO(msg)})
}

func (h *handlers) listChatRooms(w http.ResponseWriter, r *http.Request) {
	wsID := chi.URLParam(r, "workspaceID")
	rooms, err := h.Chat.ListChatRooms(r.Context(), middleware.UserID(r.Context()), wsID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatRoomDTO, 0, len(rooms))
	for _, room := range rooms {
		out = append(out, toChatRoomDTO(room))
	}
	respondJSON(w, http.StatusOK, map[string]any{"rooms": out})
}

func (h *handlers) resolveDM(w http.ResponseWriter, r *http.Request) {
	var in sdi.ResolveDMSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	room, err := h.Chat.ResolveDM(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), in.UserID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"room": toChatRoomDTO(room)})
}

func (h *handlers) createChatGroup(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateGroupSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	room, err := h.Chat.CreateGroup(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), service.CreateGroupInput{
		Name: in.Name, MemberUserIDs: in.MemberUserIDs,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"room": toChatRoomDTO(room)})
}

func (h *handlers) inviteChatGroupMembers(w http.ResponseWriter, r *http.Request) {
	var in sdi.InviteGroupMembersSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	room, err := h.Chat.InviteGroupMembers(
		r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"), in.MemberUserIDs,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"room": toChatRoomDTO(room)})
}

func (h *handlers) leaveChatRoom(w http.ResponseWriter, r *http.Request) {
	err := h.Chat.LeaveChatRoom(
		r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) listChatRoomMessages(w http.ResponseWriter, r *http.Request) {
	wsID := chi.URLParam(r, "workspaceID")
	roomID := chi.URLParam(r, "roomID")
	in, err := parseChatMessageListQuery(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "before must be RFC3339")
		return
	}
	msgs, err := h.Chat.ListRoomMessages(r.Context(), middleware.UserID(r.Context()), wsID, roomID, in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatMessageDTO, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, toChatMessageDTO(m))
	}
	respondJSON(w, http.StatusOK, map[string]any{"messages": out})
}

func (h *handlers) sendChatRoomMessage(w http.ResponseWriter, r *http.Request) {
	var in sdi.SendChatMessageSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	msg, err := h.Chat.SendRoomMessage(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		service.SendChatMessageInput{Body: in.Body, ReplyToMessageID: in.ReplyToMessageID},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"message": toChatMessageDTO(msg)})
}

func (h *handlers) toggleChatMessageReaction(w http.ResponseWriter, r *http.Request) {
	var in sdi.ToggleChatReactionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	msg, err := h.Chat.ToggleChatMessageReaction(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "messageID"),
		in.Emoji,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"message": toChatMessageDTO(msg)})
}

func (h *handlers) getChatBlockStatus(w http.ResponseWriter, r *http.Request) {
	status, err := h.Chat.GetChatBlockStatus(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "userID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatBlockStatusSDO{
		BlockedByMe: status.BlockedByMe,
		BlockedMe:   status.BlockedMe,
	})
}

func (h *handlers) blockChatUser(w http.ResponseWriter, r *http.Request) {
	err := h.Chat.BlockChatUser(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "userID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) unblockChatUser(w http.ResponseWriter, r *http.Request) {
	err := h.Chat.UnblockChatUser(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "userID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}
