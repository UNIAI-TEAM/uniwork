package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) listChatThreadMessages(w http.ResponseWriter, r *http.Request) {
	in := service.ListChatMessagesInput{Limit: 50}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			in.Limit = n
		}
	}
	if v := r.URL.Query().Get("before"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			in.Before = &t
		}
	}
	msgs, err := h.Chat.ListThreadMessages(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "messageID"),
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

func (h *handlers) sendChatThreadMessage(w http.ResponseWriter, r *http.Request) {
	var in sdi.SendChatMessageSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	msg, err := h.Chat.SendThreadReply(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "messageID"),
		service.SendChatMessageInput{
			Body: in.Body, ReplyToMessageID: in.ReplyToMessageID,
			Priority: in.Priority, ClientMsgID: in.ClientMsgID,
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, map[string]any{"message": toChatMessageDTO(msg)})
}

func (h *handlers) followChatThread(w http.ResponseWriter, r *http.Request) {
	if err := h.Chat.FollowThread(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "messageID"),
	); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *handlers) unfollowChatThread(w http.ResponseWriter, r *http.Request) {
	if err := h.Chat.UnfollowThread(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "messageID"),
	); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *handlers) markChatThreadRead(w http.ResponseWriter, r *http.Request) {
	if err := h.Chat.MarkThreadRead(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "messageID"),
	); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *handlers) listChatThreads(w http.ResponseWriter, r *http.Request) {
	unreadOnly := r.URL.Query().Get("unread") == "1"
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	rows, err := h.Chat.ListFollowedThreads(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		unreadOnly,
		limit,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatThreadDTO, 0, len(rows))
	for _, t := range rows {
		dto := sdo.ChatThreadDTO{
			ThreadRootID: t.ThreadRootID,
			RoomID:       t.RoomID,
			WorkspaceID:  t.WorkspaceID,
			RootBody:     t.RootBody,
			RootSenderID: t.RootSenderID,
			ReplyCount:   t.ReplyCount,
			RootCreated:  t.RootCreated.Format(time.RFC3339),
			Unread:       t.Unread,
			Reason:       t.Reason,
		}
		if t.LastReplyAt != nil {
			dto.LastReplyAt = t.LastReplyAt.Format(time.RFC3339)
		}
		out = append(out, dto)
	}
	respondJSON(w, http.StatusOK, sdo.ChatThreadListSDO{Threads: out})
}
