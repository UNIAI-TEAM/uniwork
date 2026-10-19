package handler

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// createDocumentShareBatch is POST /documents/{documentID}/shares/batch: one
// level for 1-50 users, all or nothing (UNI-1641).
func (h *handlers) createDocumentShareBatch(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.ShareDocumentBatchSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	shares, err := h.Documents.ShareDocumentBatch(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"),
		in.PrincipalIDs,
		service.DocumentLevel(strings.TrimSpace(in.Level)),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentShareBatchSDO{Shares: make([]sdo.DocumentShareDTO, 0, len(shares))}
	for _, sh := range shares {
		out.Shares = append(out.Shares, documentShareDTO(service.DocumentShareAccess{Share: sh, Active: true}))
	}
	respondJSON(w, http.StatusCreated, out)
}
