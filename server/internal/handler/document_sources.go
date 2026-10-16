package handler

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

// Documents "other sources" HTTP (UNI-1305 item C). The service decides every
// row and byte through the owning domain's gate; the handlers only parse and
// shape.

func (h *handlers) documentSourcesReady(w http.ResponseWriter) bool {
	if h.DocumentSources == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return false
	}
	return true
}

// listDocumentSources is GET /workspaces/{workspaceID}/documents/sources.
func (h *handlers) listDocumentSources(w http.ResponseWriter, r *http.Request) {
	if !h.documentSourcesReady(w) {
		return
	}
	q := r.URL.Query()
	in := service.DocumentSourceFilter{
		Source: q.Get("source"), Type: q.Get("type"), Q: q.Get("q"), Cursor: strings.TrimSpace(q.Get("cursor")),
	}
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be a positive integer")
			return
		}
		in.Limit = n
	}
	page, err := h.DocumentSources.List(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentSourceListSDO{Items: make([]sdo.DocumentSourceDTO, 0, len(page.Items))}
	for _, it := range page.Items {
		out.Items = append(out.Items, documentSourceDTO(it))
	}
	if page.NextCursor != "" {
		next := page.NextCursor
		out.NextCursor = &next
	}
	respondJSON(w, http.StatusOK, out)
}

func documentSourceDTO(it service.DocumentSourceItem) sdo.DocumentSourceDTO {
	dto := sdo.DocumentSourceDTO{
		ID: it.ID, Source: it.Source,
		Parent: sdo.DocumentSourceParentDTO{
			Kind: it.Parent.Kind, ID: it.Parent.ID, Title: it.Parent.Title, MessageID: it.Parent.MessageID,
		},
		Name:     it.Name,
		MimeType: it.MimeType, Extension: it.Extension, SizeBytes: it.SizeBytes,
		UpdatedAt:    it.UpdatedAt.UTC().Format(time.RFC3339),
		CanOpenInApp: it.CanOpenInApp,
		CanSave:      it.CanSave,
	}
	if it.Owner != nil {
		dto.Owner = &sdo.DocumentSourceOwnerDTO{ID: it.Owner.ID, Kind: it.Owner.Kind, Name: it.Owner.Name}
	}
	return dto
}

// downloadDocumentSource is GET .../documents/sources/{sourceFileID}/download:
// the bytes, always as an attachment and never sniffed, since a source file
// may be any type its domain accepted.
func (h *handlers) downloadDocumentSource(w http.ResponseWriter, r *http.Request) {
	if !h.documentSourcesReady(w) {
		return
	}
	f, err := h.DocumentSources.Open(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "sourceFileID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	defer f.Body.Close()
	contentType := f.Item.MimeType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", storage.AttachmentContentDisposition(f.Item.Name))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	if f.Size >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(f.Size, 10))
	}
	w.WriteHeader(http.StatusOK)
	n, err := io.Copy(w, f.Body)
	if (err != nil || (f.Size >= 0 && n != f.Size)) && r.Context().Err() == nil && h.Log != nil {
		// Not a client that went away (its context is cancelled): the source
		// stream or the connection broke mid-body, which the client sees as a
		// truncated download.
		h.Log.Warn("document source download interrupted", "source", f.Item.Source, "source_file_id", f.Item.ID,
			"bytes_sent", n, "bytes_expected", f.Size, "err", err)
	}
}

// saveDocumentSource is POST .../documents/sources/{sourceFileID}/save. An
// empty body saves at the root under the source's own name.
func (h *handlers) saveDocumentSource(w http.ResponseWriter, r *http.Request) {
	if !h.documentSourcesReady(w) {
		return
	}
	var in sdi.SaveSourceFileSDI
	if !decodeOptionalBody(w, r, &in) {
		return
	}
	actor := service.Human(middleware.UserID(r.Context()))
	res, err := h.DocumentSources.Save(r.Context(), actor, chi.URLParam(r, "workspaceID"), chi.URLParam(r, "sourceFileID"), service.SaveSourceFileInput{
		ParentID:       optionalField(in.ParentID),
		Title:          optionalField(in.Title),
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	view, err := h.Documents.GetDocument(r.Context(), actor, res.Document.ID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.DocumentSDO{Document: documentDTO(view)})
}

// decodeOptionalBody is decode for a body that may be absent: an empty body -
// no content, or a chunked request that sends nothing - leaves dst as it is.
func decodeOptionalBody[T any](w http.ResponseWriter, r *http.Request, dst *T) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBody))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			respondError(w, http.StatusRequestEntityTooLarge, "payload_too_large", "request body too large")
		} else {
			respondError(w, http.StatusBadRequest, "invalid_request", "invalid json")
		}
		return false
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return true
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	return decode(w, r, dst, maxJSONBody)
}

func optionalField(v *string) string {
	if v == nil {
		return ""
	}
	return strings.TrimSpace(*v)
}
