package handler

import (
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

// pageExportTypes are the media types of the two page export targets.
var pageExportTypes = map[string]string{
	"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"pdf":  "application/pdf",
}

// exportDocumentPage is POST /documents/{documentID}/export (UNI-2004): the
// page as DOCX or PDF, rendered by the Office engine and answered as the file
// itself, like the frame's PDF export.
func (h *handlers) exportDocumentPage(w http.ResponseWriter, r *http.Request) {
	if h.Office == nil {
		respondError(w, http.StatusServiceUnavailable, "office_not_configured", "office engine is not configured")
		return
	}
	var in sdi.ExportDocumentPageSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	documentID := chi.URLParam(r, "documentID")
	out, err := h.Office.ExportPage(r.Context(), service.Human(middleware.UserID(r.Context())), documentID, in.Format)
	if err != nil {
		h.mapOfficeError(w, err)
		return
	}
	defer out.Reader.Close()
	w.Header().Set("Content-Type", pageExportTypes[in.Format])
	w.Header().Set("Content-Disposition", storage.AttachmentContentDisposition(out.Filename))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.FormatInt(out.Reader.File.SizeBytes, 10))
	w.Header().Set("X-Office-Job-Id", out.Job.ID)
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, out.Reader.Body); err != nil && r.Context().Err() == nil {
		h.Log.Error("page export stream", "err", err, "document_id", documentID)
	}
}
