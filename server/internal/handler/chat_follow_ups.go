package handler

import (
	"encoding/json"
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

func (h *handlers) listChatFollowUps(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	includeCompleted := q.Get("include_completed") == "1" || strings.EqualFold(q.Get("include_completed"), "true")
	limit, _ := strconv.Atoi(q.Get("limit"))
	rows, err := h.Chat.ListFollowUps(
		r.Context(),
		chi.URLParam(r, "workspaceID"),
		middleware.UserID(r.Context()),
		includeCompleted,
		limit,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatFollowUpDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toChatFollowUpDTO(row))
	}
	respondJSON(w, http.StatusOK, sdo.ChatFollowUpListSDO{FollowUps: out})
}

func (h *handlers) createChatFollowUp(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateChatFollowUpSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	dueAt, err := parseOptionalRFC3339(in.DueAt)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_due_at", "due_at không hợp lệ")
		return
	}
	row, err := h.Chat.CreateFollowUp(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "messageID"),
		in.Note,
		dueAt,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.ChatFollowUpSDO{FollowUp: toChatFollowUpDTO(row)})
}

func (h *handlers) patchChatFollowUp(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw, maxJSONBody) {
		return
	}
	in := service.PatchFollowUpInput{}
	if v, ok := raw["note"]; ok {
		var note string
		if err := json.Unmarshal(v, &note); err != nil {
			respondError(w, http.StatusBadRequest, "invalid_note", "note không hợp lệ")
			return
		}
		in.Note = &note
	}
	if v, ok := raw["due_at"]; ok {
		if string(v) == "null" {
			in.ClearDueAt = true
		} else {
			var s string
			if err := json.Unmarshal(v, &s); err != nil {
				respondError(w, http.StatusBadRequest, "invalid_due_at", "due_at không hợp lệ")
				return
			}
			t, err := time.Parse(time.RFC3339, s)
			if err != nil {
				respondError(w, http.StatusBadRequest, "invalid_due_at", "due_at không hợp lệ")
				return
			}
			in.DueAt = &t
			in.DueAtSet = true
		}
	}
	if v, ok := raw["completed"]; ok {
		var completed bool
		if err := json.Unmarshal(v, &completed); err != nil {
			respondError(w, http.StatusBadRequest, "invalid_completed", "completed không hợp lệ")
			return
		}
		in.Completed = &completed
	}
	row, err := h.Chat.PatchFollowUp(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "followUpID"),
		in,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatFollowUpSDO{FollowUp: toChatFollowUpDTO(row)})
}

func (h *handlers) deleteChatFollowUp(w http.ResponseWriter, r *http.Request) {
	if err := h.Chat.DeleteFollowUp(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "followUpID"),
	); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *handlers) convertChatFollowUpToTask(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateTaskFromMessageSDI
	if r.ContentLength > 0 && !decode(w, r, &in, maxJSONBody) {
		return
	}
	task, _, err := h.Chat.ConvertFollowUpToTask(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "followUpID"),
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

func parseOptionalRFC3339(raw *string) (*time.Time, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(*raw))
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func toChatFollowUpDTO(row service.ChatFollowUpRow) sdo.ChatFollowUpDTO {
	out := sdo.ChatFollowUpDTO{
		ID: row.ID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
		RoomID: row.RoomID, MessageID: row.MessageID, UserID: row.UserID, Note: row.Note,
		CreatedBy: row.CreatedBy, CreatedByKind: row.CreatedByKind,
		CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: row.UpdatedAt.UTC().Format(time.RFC3339),
		RoomKind:  row.RoomKind, RoomName: row.RoomName, RoomVisibility: row.RoomVisibility,
		PeerDisplayName:   row.PeerDisplayName,
		MessageBody:       row.MessageBody,
		MessageKind:       row.MessageKind,
		MessageSenderID:   row.MessageSenderID,
		MessageSenderName: row.MessageSenderName,
	}
	if row.DueAt != nil {
		s := row.DueAt.UTC().Format(time.RFC3339)
		out.DueAt = &s
	}
	if row.CompletedAt != nil {
		s := row.CompletedAt.UTC().Format(time.RFC3339)
		out.CompletedAt = &s
	}
	return out
}
