package handler

import (
	"errors"
	"fmt"
	"net/http"
	"path"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

// maxWorkspaceIconBytes mirrors the workspace_icon purpose cap.
const maxWorkspaceIconBytes = 2 << 20

func (h *handlers) uploadWorkspaceIcon(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxWorkspaceIconBytes+64<<10)
	file, header, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			respondError(w, http.StatusRequestEntityTooLarge, "too_large", fmt.Sprintf("icon must be at most %d bytes", maxWorkspaceIconBytes))
			return
		}
		respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" is required`)
		return
	}
	defer file.Close()

	filename := "icon"
	if header != nil {
		if base := path.Base(header.Filename); base != "" && base != "." && base != ".." {
			filename = base
		}
	}
	ws, err := h.Workspaces.UploadIcon(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), filename, file)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.WorkspaceSDO{Workspace: toWorkspaceDTO(ws)})
}

func (h *handlers) removeWorkspaceIcon(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.RemoveIcon(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.WorkspaceSDO{Workspace: toWorkspaceDTO(ws)})
}
