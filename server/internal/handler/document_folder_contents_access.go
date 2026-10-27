package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Folder bulk access HTTP handlers (UNI-2244 §3).

// updateFolderContentsAccess is PUT /api/v1/documents/{folderID}/contents-access.
func (h *handlers) updateFolderContentsAccess(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.UpdateFolderContentsAccessSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	items := make([]service.FolderContentsAccessItem, len(in.Items))
	for i, it := range in.Items {
		items[i] = service.FolderContentsAccessItem{
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Level:         service.DocumentLevel(it.Level),
		}
	}
	res, err := h.Documents.UpdateFolderContentsAccess(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "folderID"),
		service.UpdateFolderContentsAccessInput{
			Mode:   in.Mode,
			Items:  items,
			DryRun: in.DryRun,
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	if res.DryRun {
		warnings := res.Preview.Warnings
		if warnings == nil {
			warnings = []string{}
		}
		respondJSON(w, http.StatusOK, sdo.FolderContentsAccessDryRunSDO{
			Total: res.Total,
			Preview: sdo.FolderContentsAccessPreviewSDO{
				Changed:              res.Preview.Changed,
				Unchanged:            res.Preview.Unchanged,
				SkippedNotManageable: res.Preview.SkippedNotManageable,
				SkippedLocked:        res.Preview.SkippedLocked,
				LosingUsers:          res.Preview.LosingUsers,
				DowngradedUsers:      res.Preview.DowngradedUsers,
				Warnings:             warnings,
			},
		})
		return
	}
	if res.ExecMode == service.FolderContentsAccessExecBackground {
		respondJSON(w, http.StatusAccepted, sdo.FolderContentsAccessBackgroundSDO{
			BatchID: res.BatchID,
			Mode:    sdo.FolderContentsAccessExecBackground,
			Total:   res.Total,
		})
		return
	}
	respondJSON(w, http.StatusOK, sdo.FolderContentsAccessSyncSDO{
		BatchID:              res.BatchID,
		Mode:                 sdo.FolderContentsAccessExecSync,
		Total:                res.Total,
		Changed:              res.Changed,
		Unchanged:            res.Unchanged,
		SkippedNotManageable: res.SkippedNotManageable,
		SkippedLocked:        res.SkippedLocked,
	})
}

// getFolderContentsAccessBatch is GET /api/v1/documents/{folderID}/contents-access/{batchID}.
func (h *handlers) getFolderContentsAccessBatch(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	batch, err := h.Documents.GetFolderContentsAccessBatch(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "folderID"),
		chi.URLParam(r, "batchID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.FolderContentsAccessBatchSDO{
		BatchID:              batch.BatchID,
		Status:               batch.Status,
		Total:                batch.Total,
		Processed:            batch.Processed,
		Changed:              batch.Changed,
		Unchanged:            batch.Unchanged,
		SkippedNotManageable: batch.SkippedNotManageable,
		SkippedLocked:        batch.SkippedLocked,
	}
	if batch.FinishedAt != nil {
		s := batch.FinishedAt.UTC().Format(time.RFC3339)
		out.FinishedAt = &s
	}
	respondJSON(w, http.StatusOK, out)
}
