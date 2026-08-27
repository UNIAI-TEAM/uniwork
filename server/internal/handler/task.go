package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func toTaskDTO(t db.Task) sdo.TaskDTO {
	out := sdo.TaskDTO{
		ID: t.ID, WorkspaceID: t.WorkspaceID, Title: t.Title, Description: t.Description,
		Status: t.Status, Priority: t.Priority,
		Position: t.Position, Kind: t.Kind, CreatedBy: t.CreatedBy,
		CreatedAt: t.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt: t.UpdatedAt.Time.Format(time.RFC3339),
	}
	if t.AssigneeID.Valid {
		s := t.AssigneeID.String
		out.AssigneeID = &s
	}
	if t.DueDate.Valid {
		s := t.DueDate.Time.Format("2006-01-02")
		out.DueDate = &s
	}
	return out
}

func (h *handlers) listTasks(w http.ResponseWriter, r *http.Request) {
	ts, err := h.Tasks.List(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.TaskDTO, 0, len(ts))
	for _, t := range ts {
		out = append(out, toTaskDTO(t))
	}
	respondJSON(w, 200, map[string]any{"tasks": out})
}

func (h *handlers) createTask(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateTaskSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	t, err := h.Tasks.Create(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"),
		service.CreateTaskInput{Title: in.Title, Description: in.Description, Priority: in.Priority,
			AssigneeID: in.AssigneeID, DueDate: in.DueDate})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"task": toTaskDTO(t)})
}

func (h *handlers) getTask(w http.ResponseWriter, r *http.Request) {
	t, err := h.Tasks.Get(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "taskID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"task": toTaskDTO(t)})
}

// PATCH body: field vắng mặt = không đổi; assignee_id/due_date gửi null = xóa.
// Dùng json.RawMessage để phân biệt "vắng mặt" và "null".
func (h *handlers) updateTask(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw, maxJSONBody) {
		return
	}
	in, err := parseTaskPatch(raw)
	if err != nil {
		respondError(w, 400, "invalid_request", err.Error())
		return
	}
	t, err := h.Tasks.Update(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "taskID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"task": toTaskDTO(t)})
}

func (h *handlers) deleteTask(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.Delete(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "taskID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) listComments(w http.ResponseWriter, r *http.Request) {
	cs, err := h.Tasks.Comments(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "taskID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"comments": cs})
}

func (h *handlers) createComment(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateCommentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	c, err := h.Tasks.AddComment(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "taskID"), in.Body)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"comment": c})
}

func parseTaskPatch(raw map[string]json.RawMessage) (service.UpdateTaskInput, error) {
	var in service.UpdateTaskInput
	str := func(k string) (*string, error) {
		v, ok := raw[k]
		if !ok {
			return nil, nil
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return nil, fmt.Errorf("%s phải là chuỗi", k)
		}
		return &s, nil
	}
	var err error
	if in.Title, err = str("title"); err != nil {
		return in, err
	}
	if in.Description, err = str("description"); err != nil {
		return in, err
	}
	if in.Status, err = str("status"); err != nil {
		return in, err
	}
	if in.Priority, err = str("priority"); err != nil {
		return in, err
	}
	if v, ok := raw["position"]; ok {
		var f float64
		if err := json.Unmarshal(v, &f); err != nil {
			return in, fmt.Errorf("position phải là số")
		}
		in.Position = &f
	}
	nullable := func(k string) (**string, error) {
		v, ok := raw[k]
		if !ok {
			return nil, nil
		}
		if string(v) == "null" {
			var p *string
			return &p, nil
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return nil, fmt.Errorf("%s phải là chuỗi hoặc null", k)
		}
		p := &s
		return &p, nil
	}
	if in.AssigneeID, err = nullable("assignee_id"); err != nil {
		return in, err
	}
	if in.DueDate, err = nullable("due_date"); err != nil {
		return in, err
	}
	return in, nil
}
