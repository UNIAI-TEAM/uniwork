package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func trashSDO(res service.TrashResult) sdo.TaskTrashSDO {
	ids := res.IDs
	if ids == nil {
		ids = []string{}
	}
	return sdo.TaskTrashSDO{TrashBatchID: res.BatchID, IDs: ids}
}

func (h *handlers) deleteTask(w http.ResponseWriter, r *http.Request) {
	res, err := h.Tasks.Trash(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, trashSDO(res))
}

func (h *handlers) restoreTask(w http.ResponseWriter, r *http.Request) {
	res, err := h.Tasks.Restore(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, trashSDO(res))
}

func (h *handlers) purgeTask(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.Purge(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) listTaskTrash(w http.ResponseWriter, r *http.Request) {
	page, err := h.Tasks.ListTrash(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), service.TrashFilter{}, r.URL.Query().Get("cursor"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	items := make([]sdo.TaskTrashItemDTO, 0, len(page.Items))
	for _, it := range page.Items {
		items = append(items, sdo.TaskTrashItemDTO{
			ID: it.ID, Identifier: it.Identifier, Title: it.Title, TrashedBy: it.TrashedBy,
			TrashedAt: it.TrashedAt.UTC().Format(time.RFC3339), PurgeAfter: it.PurgeAfter.UTC().Format(time.RFC3339),
			BatchSize: it.BatchSize,
		})
	}
	respondJSON(w, 200, sdo.TaskTrashPageSDO{Items: items, NextCursor: page.NextCursor})
}

func (h *handlers) restoreProject(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.RestoreProject(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "projectID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) purgeProject(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.PurgeProject(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "projectID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) listProjectTrash(w http.ResponseWriter, r *http.Request) {
	page, err := h.Tasks.ListProjectTrash(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), service.TrashFilter{}, r.URL.Query().Get("cursor"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	items := make([]sdo.ProjectTrashItemDTO, 0, len(page.Items))
	for _, it := range page.Items {
		items = append(items, sdo.ProjectTrashItemDTO{
			ID: it.ID, Title: it.Title, TrashedBy: it.TrashedBy,
			TrashedAt: it.TrashedAt.UTC().Format(time.RFC3339), PurgeAfter: it.PurgeAfter.UTC().Format(time.RFC3339),
			TaskCount: it.TaskCount,
		})
	}
	respondJSON(w, 200, sdo.ProjectTrashPageSDO{Items: items, NextCursor: page.NextCursor})
}
