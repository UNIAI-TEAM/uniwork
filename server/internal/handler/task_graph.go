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
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (h *handlers) listMyTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.ParseInt(q.Get("limit"), 10, 32)
	offset, _ := strconv.ParseInt(q.Get("offset"), 10, 32)
	page, err := h.Tasks.ListMyTasks(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.TaskQuery{
			Status: q.Get("status"), Relation: q.Get("relation"),
			Limit: int32(limit), Offset: int32(offset),
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	tasks, err := h.taskDTOs(r, page.Tasks)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskQueryPageSDO{
		Tasks: tasks, Total: page.Total, Limit: page.Limit, Offset: page.Offset,
	})
}

func (h *handlers) listTaskChildren(w http.ResponseWriter, r *http.Request) {
	kids, err := h.Tasks.ListChildren(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "taskID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	tasks, err := h.taskDTOs(r, kids)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskListSDO{Tasks: tasks})
}

func (h *handlers) listChildrenByParents(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("parent_ids")
	var parentIDs []string
	if raw != "" {
		for _, p := range strings.Split(raw, ",") {
			if s := strings.TrimSpace(p); s != "" {
				parentIDs = append(parentIDs, s)
			}
		}
	}
	kids, err := h.Tasks.ListChildrenByParents(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), parentIDs)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	tasks, err := h.taskDTOs(r, kids)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskListSDO{Tasks: tasks})
}

func (h *handlers) childTaskProgress(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Tasks.ChildProgress(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChildProgressDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, sdo.ChildProgressDTO{
			ParentTaskID: row.ParentTaskID, Total: row.Total, Done: row.Done,
		})
	}
	respondJSON(w, 200, sdo.ChildProgressListSDO{Progress: out})
}

func (h *handlers) setTaskParent(w http.ResponseWriter, r *http.Request) {
	var in sdi.SetTaskParentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	task, err := h.Tasks.SetParent(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "taskID"), in.ParentTaskID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	dto, err := h.taskDTOs(r, []db.Task{task})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskSDO{Task: dto[0]})
}

func (h *handlers) setTaskDependency(w http.ResponseWriter, r *http.Request) {
	var in sdi.SetTaskDependencySDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	dep, err := h.Tasks.SetDependency(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "taskID"), service.SetDependencyInput{
			DependsOnTaskID: in.DependsOnTaskID, Type: in.Type,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskDependencySDO{Dependency: toDependencyDTO(dep)})
}

func (h *handlers) removeTaskDependency(w http.ResponseWriter, r *http.Request) {
	err := h.Tasks.RemoveDependency(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "taskID"), chi.URLParam(r, "dependsOnTaskID"), r.URL.Query().Get("type"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func toDependencyDTO(d db.TaskDependency) sdo.TaskDependencyDTO {
	return sdo.TaskDependencyDTO{
		ID:              d.ID,
		OrganizationID:  d.OrganizationID,
		WorkspaceID:     d.WorkspaceID,
		TaskID:          d.TaskID,
		DependsOnTaskID: d.DependsOnTaskID,
		Type:            d.Type,
		CreatedAt:       d.CreatedAt.Time.Format(time.RFC3339),
	}
}
