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

func (h *handlers) listChatRoomMessageLinks(w http.ResponseWriter, r *http.Request) {
	var ids []string
	if raw := r.URL.Query().Get("message_ids"); raw != "" {
		ids = strings.Split(raw, ",")
	}
	rows, err := h.Chat.ListRoomMessageLinks(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		ids,
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

func (h *handlers) listChatRoomLinkedTasks(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, total, err := h.Chat.ListRoomLinkedTasks(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		limit,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatRoomLinkedTaskDTO, 0, len(rows))
	for _, row := range rows {
		dto := sdo.ChatRoomLinkedTaskDTO{
			ID: row.ID, WorkspaceID: row.WorkspaceID, Number: row.Number, Title: row.Title,
			Status: row.Status, Priority: row.Priority, LinkedAt: row.LinkedAt.Time.UTC().Format(time.RFC3339),
		}
		if row.AssigneeID.Valid && row.AssigneeID.String != "" {
			dto.AssigneeID, dto.AssigneeKind, dto.AssigneeName = row.AssigneeID.String, row.AssigneeKind, row.AssigneeName
		}
		if row.DueDate.Valid {
			dto.DueDate = row.DueDate.Time.Format(time.DateOnly)
		}
		out = append(out, dto)
	}
	respondJSON(w, http.StatusOK, sdo.ChatRoomLinkedTaskListSDO{Tasks: out, Total: total})
}

func (h *handlers) getChatRoomSharedSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.Chat.RoomSharedSummary(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	photos := make([]sdo.ChatSharedPhotoDTO, 0, len(summary.RecentPhotos))
	for _, p := range summary.RecentPhotos {
		photos = append(photos, sdo.ChatSharedPhotoDTO{
			MessageID: p.MessageID, FileID: p.FileID, Title: p.Title, URL: p.URL, ThumbURL: p.ThumbURL,
			URLExpiresAt: formatURLExpiry(p.URLExpiresAt), CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	respondJSON(w, http.StatusOK, sdo.ChatRoomSharedSummarySDO{
		Counts: sdo.ChatRoomSharedCountsDTO{
			Photo: summary.Photos, GIF: summary.GIFs, Video: summary.Videos,
			File: summary.Files, Link: summary.Links, Voice: summary.Voices,
		},
		RecentPhotos: photos,
	})
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
