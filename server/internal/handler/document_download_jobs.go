package handler

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

// createDocumentDownloadJob is POST /workspaces/{workspaceID}/documents/download-jobs
// (UNI-2045 SV-9): 202 with the queued job.
func (h *handlers) createDocumentDownloadJob(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CreateDocumentDownloadJobSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	wsID := chi.URLParam(r, "workspaceID")
	job, err := h.Documents.CreateDocumentDownloadJob(r.Context(), service.Human(middleware.UserID(r.Context())), wsID, in.DocumentIDs)
	if err != nil {
		// download_jobs_busy carries fields.retry_after; the header repeats it.
		if retry, ok := uniworkRetryAfter(err); ok {
			w.Header().Set("Retry-After", retry)
		}
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusAccepted, documentDownloadJobDTO(wsID, job))
}

// getDocumentDownloadJob is GET .../download-jobs/{jobID}; only the creator reads it.
func (h *handlers) getDocumentDownloadJob(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	wsID := chi.URLParam(r, "workspaceID")
	job, err := h.Documents.GetDocumentDownloadJob(r.Context(), service.Human(middleware.UserID(r.Context())), wsID, chi.URLParam(r, "jobID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, documentDownloadJobDTO(wsID, job))
}

// downloadDocumentDownloadJob is GET .../download-jobs/{jobID}/download: the
// proxy the job's download_url names, as the privacy export download is.
func (h *handlers) downloadDocumentDownloadJob(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	jobID := chi.URLParam(r, "jobID")
	zip, err := h.Documents.OpenDocumentDownloadJob(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), jobID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	defer zip.Reader.Close()
	w.Header().Set("Content-Type", zip.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(zip.Reader.File.SizeBytes, 10))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", storage.AttachmentContentDisposition(zip.Filename))
	if _, err := io.Copy(w, zip.Reader.Body); err != nil {
		h.Log.Error("document download stream", "err", err, "job_id", jobID)
	}
}

func documentDownloadJobDTO(workspaceID string, job service.DocumentDownloadJob) sdo.DocumentDownloadJobSDO {
	out := sdo.DocumentDownloadJobSDO{
		ID: job.ID, Status: job.Status, CreatedAt: job.CreatedAt.UTC().Format(time.RFC3339),
		FileCount: job.FileCount, Skipped: make([]sdo.DocumentDownloadSkipSDO, 0, len(job.Skipped)),
	}
	for _, s := range job.Skipped {
		out.Skipped = append(out.Skipped, sdo.DocumentDownloadSkipSDO{DocumentID: s.DocumentID, Reason: s.Reason})
	}
	if job.ExpiresAt != nil {
		s := job.ExpiresAt.UTC().Format(time.RFC3339)
		out.ExpiresAt = &s
	}
	if job.Error != "" {
		msg := job.Error
		out.Error = &msg
	}
	if job.DownloadReady {
		url := fmt.Sprintf("/api/v1/workspaces/%s/documents/download-jobs/%s/download", workspaceID, job.ID)
		out.DownloadURL = &url
	}
	return out
}
