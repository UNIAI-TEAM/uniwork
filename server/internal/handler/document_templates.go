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

// Document templates HTTP (UNI-2225): mark/unmark a workspace file as a
// template and list the workspace's Templates section.

// templateMarkFields renders template_marked_at/by for a document payload;
// both are nil for a document that is not a template.
func templateMarkFields(doc db.Document) (at, by *string) {
	if !doc.TemplateMarkedAt.Valid {
		return nil, nil
	}
	s := doc.TemplateMarkedAt.Time.UTC().Format(time.RFC3339)
	at = &s
	if doc.TemplateMarkedBy.Valid && doc.TemplateMarkedBy.String != "" {
		b := doc.TemplateMarkedBy.String
		by = &b
	}
	return at, by
}

// markDocumentTemplate is POST /documents/{documentID}/template. The body is
// optional: none (or {}) reads as widen_to_workspace=false.
func (h *handlers) markDocumentTemplate(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	emptyBodyAsObject(r)
	var in sdi.MarkDocumentTemplateSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	view, err := h.Documents.MarkDocumentTemplate(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"),
		service.MarkDocumentTemplateInput{WidenToWorkspace: in.WidenToWorkspace})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentSDO{Document: documentDTO(view)})
}

// unmarkDocumentTemplate is DELETE /documents/{documentID}/template.
func (h *handlers) unmarkDocumentTemplate(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	view, err := h.Documents.UnmarkDocumentTemplate(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentSDO{Document: documentDTO(view)})
}

// listTemplateDocuments is GET /workspaces/{workspaceID}/documents/templates.
// Only kind, format, type, cursor and limit are read; the order is the
// service's own.
func (h *handlers) listTemplateDocuments(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	q := r.URL.Query()
	in := service.ListDocumentsInput{
		Kind:        strings.TrimSpace(q.Get("kind")),
		Format:      strings.TrimSpace(q.Get("format")),
		Types:       documentTypesFromQuery(q),
		Cursor:      strings.TrimSpace(q.Get("cursor")),
		WithEditors: true,
	}
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be a non-negative integer")
			return
		}
		in.Limit = n
	}
	page, err := h.Documents.ListTemplateDocuments(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, documentListSDO(page))
}
