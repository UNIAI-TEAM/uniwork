package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// listDocumentChanges is GET /workspaces/{workspaceID}/documents/changes: the
// Office change feed (G5-01a). No cursor opens a snapshot; the cursor is
// opaque and only the service reads it. The handler makes no membership,
// flag or database decision of its own, and never logs the cursor.
func (h *handlers) listDocumentChanges(w http.ResponseWriter, r *http.Request) {
	if h.DocumentChanges == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	q := r.URL.Query()
	in := service.DocumentChangeListInput{Cursor: strings.TrimSpace(q.Get("cursor"))}
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be a non-negative integer")
			return
		}
		in.Limit = n
	}
	page, err := h.DocumentChanges.List(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentChangeListSDO{
		Phase: page.Phase, Changes: make([]sdo.DocumentChangeSDO, 0, len(page.Changes)),
		HasMore: page.HasMore, NextCursor: page.NextCursor, ExpiresAt: page.ExpiresAt.UTC().Format(time.RFC3339),
	}
	for _, c := range page.Changes {
		row := sdo.DocumentChangeSDO{DocumentID: c.DocumentID, Kind: c.Kind, Revision: c.Revision, CurrentVersion: c.CurrentVersion}
		if c.FileVersionID != "" {
			v := c.FileVersionID
			row.VersionID = &v
		}
		out.Changes = append(out.Changes, row)
	}
	respondJSON(w, http.StatusOK, out)
}
