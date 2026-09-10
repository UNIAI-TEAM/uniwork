package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) createTaskFromChatMessage(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateTaskFromMessageSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	task, err := h.Chat.CreateTaskFromMessage(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "messageID"),
		service.CreateTaskFromMessageInput{
			Title: in.Title, ProjectID: in.ProjectID, AssigneeID: in.AssigneeID,
			AssigneeKind: in.AssigneeKind, DueDate: in.DueDate, SyncThread: in.SyncThread,
			Priority: in.Priority,
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondTask(w, r, http.StatusCreated, task)
}

func (h *handlers) createChatMessageLink(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateChatMessageLinkSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	link, err := h.Chat.LinkChatMessage(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "messageID"),
		service.CreateChatMessageLinkInput{TargetType: in.TargetType, TargetID: in.TargetID},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"link": toChatMessageLinkDTO(link)})
}

func (h *handlers) listChatMessageLinks(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Chat.ListChatMessageLinks(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "messageID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatMessageLinkDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toChatMessageLinkDTO(row))
	}
	respondJSON(w, http.StatusOK, sdo.ChatMessageLinkListSDO{Links: out})
}

func (h *handlers) deleteChatMessageLink(w http.ResponseWriter, r *http.Request) {
	if err := h.Chat.UnlinkChatMessage(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "messageID"),
		chi.URLParam(r, "linkID"),
	); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *handlers) syncChatThreadTask(w http.ResponseWriter, r *http.Request) {
	var in sdi.SyncThreadTaskSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if _, err := h.Chat.SyncThreadTask(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "messageID"),
		service.SyncThreadTaskInput{TaskID: in.TaskID, Direction: in.Direction},
	); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *handlers) unsyncChatThreadTask(w http.ResponseWriter, r *http.Request) {
	if err := h.Chat.UnsyncThreadTask(
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

func toChatMessageLinkDTO(row service.ChatMessageLinkRow) sdo.ChatMessageLinkDTO {
	return sdo.ChatMessageLinkDTO{
		ID: row.ID, MessageID: row.MessageID, TargetType: row.TargetType,
		TargetID: row.TargetID, Relation: row.Relation, CreatedBy: row.CreatedBy,
		CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339),
	}
}
