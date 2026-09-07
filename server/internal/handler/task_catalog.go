package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func catalogArchivedAt(t pgtype.Timestamptz) *string {
	if !t.Valid {
		return nil
	}
	s := t.Time.UTC().Format("2006-01-02T15:04:05Z")
	return &s
}

func catalogTime(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.UTC().Format("2006-01-02T15:04:05Z")
}

func taskStatusDTO(st db.TaskStatus) sdo.TaskStatusDTO {
	return sdo.TaskStatusDTO{
		ID: st.ID, OrganizationID: st.OrganizationID, WorkspaceID: st.WorkspaceID,
		Key: st.Key, Name: st.Name, Description: st.Description, Category: st.Category,
		Color: st.Color, IsSystem: st.IsSystem, Position: st.Position,
		ArchivedAt: catalogArchivedAt(st.ArchivedAt),
		CreatedAt:  catalogTime(st.CreatedAt), UpdatedAt: catalogTime(st.UpdatedAt),
	}
}

func taskLabelDTO(l db.TaskLabel, usage int64) sdo.TaskLabelDTO {
	return sdo.TaskLabelDTO{
		ID: l.ID, OrganizationID: l.OrganizationID, WorkspaceID: l.WorkspaceID,
		Name: l.Name, Description: l.Description, Color: l.Color, UsageCount: usage,
		ArchivedAt: catalogArchivedAt(l.ArchivedAt),
		CreatedAt:  catalogTime(l.CreatedAt), UpdatedAt: catalogTime(l.UpdatedAt),
	}
}

func taskPropertyDTO(p db.TaskProperty, usage int64) sdo.TaskPropertyDTO {
	cfg := map[string]any{}
	if len(p.Config) > 0 {
		_ = json.Unmarshal(p.Config, &cfg)
	}
	return sdo.TaskPropertyDTO{
		ID: p.ID, OrganizationID: p.OrganizationID, WorkspaceID: p.WorkspaceID,
		Name: p.Name, Type: p.Type, Description: p.Description, Config: cfg,
		Position: p.Position, UsageCount: usage,
		ArchivedAt: catalogArchivedAt(p.ArchivedAt),
		CreatedAt:  catalogTime(p.CreatedAt), UpdatedAt: catalogTime(p.UpdatedAt),
	}
}

func (h *handlers) listTaskStatuses(w http.ResponseWriter, r *http.Request) {
	include := strings.EqualFold(r.URL.Query().Get("include_archived"), "true")
	list, err := h.Tasks.ListTaskStatuses(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), include)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.TaskStatusDTO, 0, len(list))
	for _, st := range list {
		out = append(out, taskStatusDTO(st))
	}
	cats := make([]string, 0, len(service.BuiltInTaskStatuses()))
	for _, st := range service.BuiltInTaskStatuses() {
		cats = append(cats, st.Key)
	}
	respondJSON(w, 200, sdo.TaskStatusListSDO{Statuses: out, Categories: cats, Total: len(out)})
}

func (h *handlers) createTaskStatus(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateTaskStatusSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	st, err := h.Tasks.CreateTaskStatus(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.CreateTaskStatusInput{
			Key: in.Key, Name: in.Name, Description: in.Description, Category: in.Category, Color: in.Color,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, sdo.TaskStatusSDO{Status: taskStatusDTO(st)})
}

func (h *handlers) patchTaskStatus(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchTaskStatusSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	st, err := h.Tasks.UpdateTaskStatus(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "id"), service.UpdateTaskStatusInput{
			Name: in.Name, Description: in.Description, Color: in.Color, Position: in.Position,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskStatusSDO{Status: taskStatusDTO(st)})
}

func (h *handlers) deleteTaskStatus(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.DeleteTaskStatus(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "id")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) reorderTaskStatuses(w http.ResponseWriter, r *http.Request) {
	var in sdi.ReorderTaskStatusesSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	list, err := h.Tasks.ReorderTaskStatuses(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.ReorderTaskStatusesInput{Category: in.Category, IDs: in.IDs})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.TaskStatusDTO, 0, len(list))
	for _, st := range list {
		out = append(out, taskStatusDTO(st))
	}
	respondJSON(w, 200, sdo.TaskStatusListSDO{Statuses: out, Total: len(out)})
}

func (h *handlers) listTaskLabels(w http.ResponseWriter, r *http.Request) {
	include := strings.EqualFold(r.URL.Query().Get("include_archived"), "true")
	list, err := h.Tasks.ListTaskLabels(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), include)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.TaskLabelDTO, 0, len(list))
	for _, l := range list {
		out = append(out, taskLabelDTO(l.TaskLabel, l.UsageCount))
	}
	respondJSON(w, 200, sdo.TaskLabelListSDO{Labels: out, Total: len(out)})
}

func (h *handlers) getTaskLabel(w http.ResponseWriter, r *http.Request) {
	label, err := h.Tasks.GetTaskLabel(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "id"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskLabelSDO{Label: taskLabelDTO(label, 0)})
}

func (h *handlers) createTaskLabel(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateTaskLabelSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	label, err := h.Tasks.CreateTaskLabel(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.CreateTaskLabelInput{
			Name: in.Name, Description: in.Description, Color: in.Color,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, sdo.TaskLabelSDO{Label: taskLabelDTO(label, 0)})
}

func (h *handlers) putTaskLabel(w http.ResponseWriter, r *http.Request) {
	var in sdi.PutTaskLabelSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	label, err := h.Tasks.UpdateTaskLabel(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "id"), service.UpdateTaskLabelInput{
			Name: in.Name, Description: in.Description, Color: in.Color,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskLabelSDO{Label: taskLabelDTO(label, 0)})
}

func (h *handlers) deleteTaskLabel(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.DeleteTaskLabel(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "id")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) listTaskLabelsOnTask(w http.ResponseWriter, r *http.Request) {
	list, err := h.Tasks.ListTaskLabelsOnTask(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "taskID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.TaskLabelDTO, 0, len(list))
	for _, l := range list {
		out = append(out, taskLabelDTO(l, 0))
	}
	respondJSON(w, 200, sdo.TaskLabelListSDO{Labels: out, Total: len(out)})
}

func (h *handlers) attachTaskLabel(w http.ResponseWriter, r *http.Request) {
	var in sdi.AttachTaskLabelSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Tasks.AttachTaskLabel(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "taskID"), in.LabelID); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) detachTaskLabel(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.DetachTaskLabel(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "taskID"), chi.URLParam(r, "labelID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) listTaskProperties(w http.ResponseWriter, r *http.Request) {
	include := strings.EqualFold(r.URL.Query().Get("include_archived"), "true")
	list, err := h.Tasks.ListTaskProperties(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), include)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.TaskPropertyDTO, 0, len(list))
	for _, p := range list {
		out = append(out, taskPropertyDTO(p.TaskProperty, p.UsageCount))
	}
	respondJSON(w, 200, sdo.TaskPropertyListSDO{Properties: out, Total: len(out)})
}

func (h *handlers) createTaskProperty(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateTaskPropertySDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	prop, err := h.Tasks.CreateTaskProperty(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.CreateTaskPropertyInput{
			Name: in.Name, Type: in.Type, Description: in.Description, Config: in.Config,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, sdo.TaskPropertySDO{Property: taskPropertyDTO(prop, 0)})
}

func (h *handlers) patchTaskProperty(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchTaskPropertySDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	prop, err := h.Tasks.UpdateTaskProperty(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "id"), service.UpdateTaskPropertyInput{
			Name: in.Name, Description: in.Description, Config: in.Config, Archived: in.Archived,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskPropertySDO{Property: taskPropertyDTO(prop, 0)})
}

func (h *handlers) putTaskPropertyValue(w http.ResponseWriter, r *http.Request) {
	var in sdi.PutTaskPropertyValueSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	task, err := h.Tasks.SetTaskPropertyValue(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "taskID"), chi.URLParam(r, "propertyID"), in.Value)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	dtos, err := h.taskDTOs(r, []db.Task{task})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskSDO{Task: dtos[0]})
}

func (h *handlers) deleteTaskPropertyValue(w http.ResponseWriter, r *http.Request) {
	task, err := h.Tasks.DeleteTaskPropertyValue(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "taskID"), chi.URLParam(r, "propertyID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	dtos, err := h.taskDTOs(r, []db.Task{task})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskSDO{Task: dtos[0]})
}
