package handler

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) queryTasks(w http.ResponseWriter, r *http.Request) {
	var in sdi.QueryTasksSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	page, err := h.Tasks.QueryTasks(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.TaskQuery{
			Status: in.Status, ProjectID: in.ProjectID, Limit: in.Limit, Offset: in.Offset,
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

func (h *handlers) groupedTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.ParseInt(q.Get("limit"), 10, 32)
	offset, _ := strconv.ParseInt(q.Get("offset"), 10, 32)
	groups, err := h.Tasks.GroupedTasks(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.TaskQuery{
			Status: q.Get("status"), ProjectID: q.Get("project_id"), Limit: int32(limit), Offset: int32(offset),
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.TaskGroupDTO, 0, len(groups))
	for _, g := range groups {
		tasks, err := h.taskDTOs(r, g.Tasks)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		out = append(out, sdo.TaskGroupDTO{Key: g.Key, Tasks: tasks})
	}
	respondJSON(w, 200, sdo.TaskGroupedSDO{Groups: out})
}
