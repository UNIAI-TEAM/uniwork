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
	if m.ThreadRootID != nil {
		out.ThreadRootID = m.ThreadRootID
	}
	if m.ReplyCount > 0 {
		out.ReplyCount = m.ReplyCount
	}
	if m.LastReplyAt != nil {
		out.LastReplyAt = m.LastReplyAt.Format(time.RFC3339)
	}
	if m.ThreadUnread {
		out.ThreadUnread = true
	}
	if len(m.Reactions) > 0 {
		out.Reactions = m.Reactions
	}
	if len(m.MentionedUserIDs) > 0 {
		out.MentionedUserIDs = m.MentionedUserIDs
	}
	if m.Pinned {
		out.Pinned = true
	}
	if m.Priority != "" {
		out.Priority = m.Priority
	}
	if m.ClientMsgID != "" {
		out.ClientMsgID = m.ClientMsgID
	}
	if m.EditedAt != nil {
		out.EditedAt = m.EditedAt.Format(time.RFC3339)
	}
	if m.VoiceCall != nil {
		out.VoiceCall = &sdo.VoiceCallLogDTO{
			Outcome:         m.VoiceCall.Outcome,
			DurationSeconds: m.VoiceCall.DurationSeconds,
			CallerID:        m.VoiceCall.CallerID,
		}
	}
	if m.Voice != nil {
		out.Voice = &sdo.VoiceMessageDTO{
			DurationMS:  m.Voice.DurationMS,
			ContentType: m.Voice.ContentType,
			SizeBytes:   m.Voice.SizeBytes,
		}
	}
	if m.File != nil {
		out.File = &sdo.FileMessageDTO{
			Filename:    m.File.Filename,
			ContentType: m.File.ContentType,
			SizeBytes:   m.File.SizeBytes,
		}
	}
	if m.Poll != nil {
		options := make([]sdo.ChatPollOptionDTO, 0, len(m.Poll.Options))
		for _, option := range m.Poll.Options {
			options = append(options, sdo.ChatPollOptionDTO{
				ID: option.ID, Label: option.Label, Votes: option.Votes,
			})
		}
		out.Poll = &sdo.ChatPollDTO{
			Question: m.Poll.Question,
			Options:  options,
			Settings: sdo.ChatPollSettingsDTO{
				DeadlineAt:           m.Poll.Settings.DeadlineAt,
				PinToTop:             m.Poll.Settings.PinToTop,
				AllowMultiple:        m.Poll.Settings.AllowMultiple,
				AllowAddOptions:      m.Poll.Settings.AllowAddOptions,
				HideResultsUntilVote: m.Poll.Settings.HideResultsUntilVote,
				HideVoters:           m.Poll.Settings.HideVoters,
			},
			ViewerOptionIDs: m.Poll.ViewerOptionIDs,
			VotesByUser:     m.Poll.VotesByUser,
		}
	}
	if m.Reminder != nil {
		out.Reminder = &sdo.ChatReminderDTO{
			Body:     m.Reminder.Body,
			RemindAt: m.Reminder.RemindAt,
			Repeat:   m.Reminder.Repeat,
		}
	}
	if m.Note != nil {
		out.Note = &sdo.ChatNoteDTO{
			Body:     m.Note.Body,
			PinToTop: m.Note.PinToTop,
		}
	}
	return out
}

func toChatRoomMemberPermissionsDTO(p service.ChatRoomMemberPermissions) *sdo.ChatRoomMemberPermissionsDTO {
	return &sdo.ChatRoomMemberPermissionsDTO{
		AllowChangeProfile: p.AllowChangeProfile,
		AllowPinContent:    p.AllowPinContent,
		AllowCreateNotes:   p.AllowCreateNotes,
		AllowCreatePolls:   p.AllowCreatePolls,
		AllowSendMessages:  p.AllowSendMessages,
	}
}

func toChatRoomDTO(r service.ChatRoomSummary) sdo.ChatRoomDTO {
	memberIDs := r.MemberUserIDs
	if memberIDs == nil {
		memberIDs = []string{}
	}
	out := sdo.ChatRoomDTO{
		ID: r.ID, Kind: r.Kind, Name: r.Name, WorkspaceID: r.WorkspaceID,
		MemberUserIDs: memberIDs, UnreadCount: r.UnreadCount, MentionUnreadCount: r.MentionUnreadCount,
		PeerUserID: r.PeerUserID, PeerEmail: r.PeerEmail, PeerDisplayName: r.PeerDisplayName,
		LastMessageBody: r.LastMessageBody, LastMessageKind: r.LastMessageKind,
		LastMessageSenderID: r.LastMessageSenderID, LastMessageSenderName: r.LastMessageSenderName,
		Visibility: r.Visibility, ProjectID: r.ProjectID, Topic: r.Topic, IsDefault: r.IsDefault,
	}
	if r.LastMessageAt != nil {
		out.LastMessageAt = r.LastMessageAt.Format(time.RFC3339)
	}
	if r.Kind != "dm" {
		out.MemberPermissions = toChatRoomMemberPermissionsDTO(r.MemberPermissions)
	}
	return out
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
		service.SendChatMessageInput{
			Body:             in.Body,
			ReplyToMessageID: in.ReplyToMessageID,
			ClientMsgID:      in.ClientMsgID,
		},
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

func (h *handlers) removeWorkspaceChatRoomMember(w http.ResponseWriter, r *http.Request) {
	err := h.Chat.RemoveChatRoomMember(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "userID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) listChatRoomMembers(w http.ResponseWriter, r *http.Request) {
	members, err := h.Chat.ListChatRoomMembers(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatRoomMemberDTO, 0, len(members))
	for _, m := range members {
		out = append(out, sdo.ChatRoomMemberDTO{
			UserID: m.UserID, Role: m.Role, SendRestricted: m.SendRestricted,
			Email: m.Email, DisplayName: m.DisplayName,
		})
	}
	respondJSON(w, http.StatusOK, sdo.ChatRoomMemberListSDO{Members: out})
}

func (h *handlers) patchChatRoomMember(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchChatRoomMemberSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.Chat.UpdateChatRoomMember(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "userID"),
		service.UpdateChatRoomMemberInput{Role: in.Role, SendRestricted: in.SendRestricted},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func patchMemberPermissionsFromSDI(
	current service.ChatRoomMemberPermissions,
	in *sdi.ChatRoomMemberPermissionsSDI,
) service.ChatRoomMemberPermissions {
	if in == nil {
		return current
	}
	if in.AllowChangeProfile != nil {
		current.AllowChangeProfile = *in.AllowChangeProfile
	}
	if in.AllowPinContent != nil {
		current.AllowPinContent = *in.AllowPinContent
	}
	if in.AllowCreateNotes != nil {
		current.AllowCreateNotes = *in.AllowCreateNotes
	}
	if in.AllowCreatePolls != nil {
		current.AllowCreatePolls = *in.AllowCreatePolls
	}
	if in.AllowSendMessages != nil {
		current.AllowSendMessages = *in.AllowSendMessages
	}
	return current
}

func (h *handlers) patchChatRoom(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchChatRoomSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	roomID := chi.URLParam(r, "roomID")
	wsID := chi.URLParam(r, "workspaceID")
	actorID := middleware.UserID(r.Context())
	var merged *service.ChatRoomMemberPermissions
	if in.MemberPermissions != nil {
		current, err := h.Chat.GetRoomMemberPermissions(r.Context(), actorID, wsID, roomID)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		next := patchMemberPermissionsFromSDI(current, in.MemberPermissions)
		merged = &next
	}
	perms, err := h.Chat.UpdateChatRoomSettings(
		r.Context(), actorID, wsID, roomID,
		service.UpdateChatRoomSettingsInput{Name: in.Name, MemberPermissions: merged},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatRoomMemberPermissionsDTO{
		AllowChangeProfile: perms.AllowChangeProfile,
		AllowPinContent:    perms.AllowPinContent,
		AllowCreateNotes:   perms.AllowCreateNotes,
		AllowCreatePolls:   perms.AllowCreatePolls,
		AllowSendMessages:  perms.AllowSendMessages,
	})
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

func (h *handlers) getChatRoomMessage(w http.ResponseWriter, r *http.Request) {
	wsID := chi.URLParam(r, "workspaceID")
	roomID := chi.URLParam(r, "roomID")
	messageID := chi.URLParam(r, "messageID")
	msg, err := h.Chat.GetRoomMessage(r.Context(), middleware.UserID(r.Context()), wsID, roomID, messageID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"message": toChatMessageDTO(msg)})
}

func (h *handlers) sendChatRoomMessage(w http.ResponseWriter, r *http.Request) {
	var in sdi.SendChatMessageSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	userID := middleware.UserID(r.Context())
	workspaceID := chi.URLParam(r, "workspaceID")
	roomID := chi.URLParam(r, "roomID")
	var (
		msg service.ChatMessageRow
		err error
	)
	if in.Poll != nil {
		msg, err = h.Chat.SendPollMessage(
			r.Context(),
			userID,
			workspaceID,
			roomID,
			service.SendPollMessageInput{
				Question: in.Poll.Question,
				Options:  in.Poll.Options,
				Settings: service.ChatPollSettings{
					DeadlineAt:           in.Poll.Settings.DeadlineAt,
					PinToTop:             in.Poll.Settings.PinToTop,
					AllowMultiple:        in.Poll.Settings.AllowMultiple,
					AllowAddOptions:      in.Poll.Settings.AllowAddOptions,
					HideResultsUntilVote: in.Poll.Settings.HideResultsUntilVote,
					HideVoters:           in.Poll.Settings.HideVoters,
				},
				ReplyToMessageID: in.ReplyToMessageID,
			},
		)
	} else if in.Reminder != nil {
		msg, err = h.Chat.SendReminderMessage(
			r.Context(),
			userID,
			workspaceID,
			roomID,
			service.SendReminderMessageInput{
				Body:             in.Reminder.Body,
				RemindAt:         in.Reminder.RemindAt,
				Repeat:           in.Reminder.Repeat,
				ReplyToMessageID: in.ReplyToMessageID,
			},
		)
	} else if in.Note != nil {
		msg, err = h.Chat.SendNoteMessage(
			r.Context(),
			userID,
			workspaceID,
			roomID,
			service.SendNoteMessageInput{
				Body:             in.Note.Body,
				PinToTop:         in.Note.PinToTop,
				ReplyToMessageID: in.ReplyToMessageID,
			},
		)
	} else {
		msg, err = h.Chat.SendRoomMessage(
			r.Context(),
			userID,
			workspaceID,
			roomID,
			service.SendChatMessageInput{
				Body:             in.Body,
				ReplyToMessageID: in.ReplyToMessageID,
				Priority:         in.Priority,
				ClientMsgID:      in.ClientMsgID,
			},
		)
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"message": toChatMessageDTO(msg)})
}

func (h *handlers) voteChatPollMessage(w http.ResponseWriter, r *http.Request) {
	var in sdi.VoteChatPollSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	msg, err := h.Chat.VoteChatPollMessage(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "messageID"),
		in.OptionID,
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

func (h *handlers) editChatMessage(w http.ResponseWriter, r *http.Request) {
	var in sdi.EditChatMessageSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	msg, err := h.Chat.EditChatMessage(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "messageID"),
		in.Body,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"message": toChatMessageDTO(msg)})
}

func (h *handlers) deleteChatMessage(w http.ResponseWriter, r *http.Request) {
	err := h.Chat.DeleteChatMessage(
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
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) toggleChatMessagePin(w http.ResponseWriter, r *http.Request) {
	msg, err := h.Chat.ToggleChatMessagePin(
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

func parseChatSearchQuery(r *http.Request) (service.SearchChatMessagesInput, error) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := defaultChatSearchLimit
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	var before *time.Time
	if raw := strings.TrimSpace(r.URL.Query().Get("before")); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return service.SearchChatMessagesInput{}, err
		}
		before = &t
	}
	return service.SearchChatMessagesInput{Query: query, Limit: limit, Before: before}, nil
}

const defaultChatSearchLimit = 20

func (h *handlers) searchChatRoomMessages(w http.ResponseWriter, r *http.Request) {
	in, err := parseChatSearchQuery(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "before must be RFC3339")
		return
	}
	msgs, err := h.Chat.SearchRoomMessages(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		in,
	)
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

func (h *handlers) listChatRoomMessagesAround(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	msgs, err := h.Chat.ListRoomMessagesAround(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "messageID"),
		limit,
	)
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

func (h *handlers) listChatNicknames(w http.ResponseWriter, r *http.Request) {
	nicknames, err := h.Chat.ListChatNicknames(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatNicknameMapSDO{Nicknames: nicknames})
}

func (h *handlers) setChatNickname(w http.ResponseWriter, r *http.Request) {
	var in sdi.SetChatNicknameSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.Chat.SetChatNickname(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "userID"),
		in.Nickname,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func toChatGifListSDO(items []service.ChatGifItem) sdo.ChatGifListSDO {
	out := make([]sdo.ChatGifItemSDO, 0, len(items))
	for _, item := range items {
		out = append(out, sdo.ChatGifItemSDO{
			ID:         item.ID,
			Label:      item.Label,
			URL:        item.URL,
			PreviewURL: item.PreviewURL,
		})
	}
	return sdo.ChatGifListSDO{Items: out}
}

func (h *handlers) searchChatGifs(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := h.Chat.SearchChatGifs(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		query,
		limit,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toChatGifListSDO(items))
}

func (h *handlers) trendingChatGifs(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := h.Chat.TrendingChatGifs(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		limit,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toChatGifListSDO(items))
}

func (h *handlers) searchChatStickers(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := h.Chat.SearchChatStickers(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		query,
		limit,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toChatGifListSDO(items))
}

func (h *handlers) trendingChatStickers(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := h.Chat.TrendingChatStickers(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		limit,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toChatGifListSDO(items))
}

func (h *handlers) getChatMediaStatus(w http.ResponseWriter, r *http.Request) {
	enabled, err := h.Chat.ChatMediaStatus(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatMediaStatusSDO{TenorEnabled: enabled})
}
