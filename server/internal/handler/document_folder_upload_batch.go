package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// getFolderUpload is GET /workspaces/{workspaceID}/documents/folder-uploads/{batchID}
// (UNI-2052): the creator's read of one batch, with a fresh target per pending
// file. Another member, or an unknown id, is 404; an expired batch is 410.
func (h *handlers) getFolderUpload(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	batch, err := h.Documents.GetFolderUpload(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "batchID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, folderUploadBatchSDO(batch))
}

// cancelFolderUpload is DELETE on the same path: 200 with the canceled batch,
// the same body again on a repeat.
func (h *handlers) cancelFolderUpload(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	batch, err := h.Documents.CancelFolderUpload(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "batchID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, folderUploadBatchSDO(batch))
}
