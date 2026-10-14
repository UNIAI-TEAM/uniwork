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
// Office change feed (G5-01a snapshot, G5-01b incremental feed). No cursor
// opens a snapshot; the cursor is opaque and only the service reads it. A
// snapshot page fills `changes`; a feed page fills `feed` (change kind and,
// for a removal, its ids-only reason). The handler makes no membership, flag
// or database decision of its own, and never logs the cursor.
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
		Feed:    make([]sdo.DocumentChangeFeedSDO, 0, len(page.Feed)),
		HasMore: page.HasMore, NextCursor: page.NextCursor, ExpiresAt: page.ExpiresAt.UTC().Format(time.RFC3339),
	}
	for _, c := range page.Changes {
		row := sdo.DocumentChangeSDO{
			DocumentID: c.DocumentID, Kind: c.Kind, Revision: changeRevisionWire(c.Revision),
			CurrentVersion: c.CurrentVersion,
		}
		if c.FileVersionID != "" {
			v := c.FileVersionID
			row.VersionID = &v
		}
		out.Changes = append(out.Changes, row)
	}
	for _, f := range page.Feed {
		row := sdo.DocumentChangeFeedSDO{
			DocumentID: f.DocumentID, ChangeKind: f.ChangeKind, Kind: f.Kind,
			Revision: changeRevisionWire(f.Revision), CurrentVersion: f.CurrentVersion,
			Archived: f.Archived, Removal: f.Removal,
		}
		if f.FileVersionID != "" {
			v := f.FileVersionID
			row.VersionID = &v
		}
		out.Feed = append(out.Feed, row)
	}
	respondJSON(w, http.StatusOK, out)
}

// changeRevisionWire formats a revision for the wire: always a decimal string,
// never a JSON number. A BIGINT revision above JavaScript's 2^53 would lose
// precision as a number and corrupt the client's sync base (spec §3 invariant
// 2, BE-F1-1), so every document SDO ships it as a string.
func changeRevisionWire(revision int64) string {
	return strconv.FormatInt(revision, 10)
}
