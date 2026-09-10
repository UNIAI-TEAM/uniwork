package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func toTaskDTO(task db.Task, prefix string) sdo.TaskDTO {
	out := sdo.TaskDTO{
		ID: task.ID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Number: task.Number, Identifier: fmt.Sprintf("%s-%d", prefix, task.Number),
		Revision: task.Revision,
	}
	return fillLegacyTaskDTOFields(out, task)
}

// fillLegacyTaskDTOFields keeps the MVP task payload fields so additive
// foundation columns never drop title/status/assignee/due/timestamps.
func fillLegacyTaskDTOFields(out sdo.TaskDTO, t db.Task) sdo.TaskDTO {
	out.Title = t.Title
	out.Description = t.Description
	out.Status = t.Status
	out.Priority = t.Priority
	out.AssigneeKind = t.AssigneeKind
	out.Position = t.Position
	out.Kind = t.Kind
	out.CreatedBy = t.CreatedBy
	out.CreatedByKind = t.CreatedByKind
	out.CreatedAt = t.CreatedAt.Time.Format(time.RFC3339)
	out.UpdatedAt = t.UpdatedAt.Time.Format(time.RFC3339)
	if t.AssigneeID.Valid {
		s := t.AssigneeID.String
		out.AssigneeID = &s
	}
	if t.DueDate.Valid {
		s := t.DueDate.Time.Format("2006-01-02")
		out.DueDate = &s
	}
	if t.StartDate.Valid {
		s := t.StartDate.Time.Format("2006-01-02")
		out.StartDate = &s
	}
	if t.ProjectID.Valid {
		s := t.ProjectID.String
		out.ProjectID = &s
	}
	if t.ParentTaskID.Valid {
		s := t.ParentTaskID.String
		out.ParentTaskID = &s
	}
	return out
}

// taskDTOs maps rows and resolves every assignee in one batch, so a board of
// 200 tasks costs two lookups, not 200. Workspace-scoped lists load the
// task_prefix once and reuse it for every identifier.
func (h *handlers) taskDTOs(r *http.Request, ts []db.Task) ([]sdo.TaskDTO, error) {
	out := make([]sdo.TaskDTO, 0, len(ts))
	if len(ts) == 0 {
		return out, nil
	}
	view, err := h.Workspaces.GetView(r.Context(), middleware.UserID(r.Context()), ts[0].WorkspaceID)
	if err != nil {
		return nil, err
	}
	prefix := view.TaskPrefix
	refs := make([]service.ActorRef, 0, len(ts))
	for _, t := range ts {
		out = append(out, toTaskDTO(t, prefix))
		if t.AssigneeID.Valid {
			refs = append(refs, service.ActorRef{Kind: audit.Kind(t.AssigneeKind), ID: t.AssigneeID.String})
		}
	}
	actors, err := h.Actors.Resolve(r.Context(), refs)
	if err != nil {
		return nil, err
	}
	for i, t := range ts {
		if !t.AssigneeID.Valid {
			continue
		}
		if a, ok := actors[service.ActorRef{Kind: audit.Kind(t.AssigneeKind), ID: t.AssigneeID.String}]; ok {
			dto := toActorDTO(a)
			out[i].Assignee = &dto
		}
	}
	return out, nil
}

func (h *handlers) respondTask(w http.ResponseWriter, r *http.Request, status int, t db.Task) {
	dtos, err := h.taskDTOs(r, []db.Task{t})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, status, map[string]any{"task": dtos[0]})
}

func (h *handlers) listTasks(w http.ResponseWriter, r *http.Request) {
	ts, err := h.Tasks.List(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out, err := h.taskDTOs(r, ts)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"tasks": out})
}

func (h *handlers) getTask(w http.ResponseWriter, r *http.Request) {
	t, err := h.Tasks.GetByRef(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondTask(w, r, 200, t)
}

// PATCH body: field vắng mặt = không đổi; assignee_id/due_date gửi null = xóa.
// Dùng json.RawMessage để phân biệt "vắng mặt" và "null". Suite revision
// checks live on PUT (UpdateTaskSuite); board drag keeps PATCH without If-Match.
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
	t, err := h.Tasks.Update(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondTask(w, r, 200, t)
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
	out := make([]sdo.CommentDTO, 0, len(cs))
	for _, c := range cs {
		out = append(out, commentDTOFromListRow(c))
	}
	respondJSON(w, 200, sdo.CommentListSDO{Comments: out})
}

func (h *handlers) createComment(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateCommentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	c, err := h.Tasks.AddCommentSuite(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"), service.AddCommentInput{
		Body: in.Body, ParentID: in.ParentID, CommentType: in.CommentType,
	}, r.Header.Get("Idempotency-Key"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondComment(w, r, c)
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
	if kind, kerr := str("assignee_kind"); kerr != nil {
		return in, kerr
	} else if kind != nil {
		in.AssigneeKind = *kind
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
	if in.ProjectID, err = nullable("project_id"); err != nil {
		return in, err
	}
	return in, nil
}
