package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// listDocumentShareCandidates is GET /api/v1/documents/{documentID}/share-candidates
// (SH-S2, UNI-1781): organization-scoped share candidates (people, workspaces,
// organization) with case- and accent-insensitive search and cursor paging.
func (h *handlers) listDocumentShareCandidates(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	q := r.URL.Query()
	limit := 0
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit phải là số nguyên không âm")
			return
		}
		limit = n
	}
	page, err := h.Documents.ListShareCandidates(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"),
		service.DocumentShareCandidateFilter{
			Q:      q.Get("q"),
			Cursor: q.Get("cursor"),
			Limit:  limit,
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	items := make([]sdo.DocumentShareCandidateDTO, 0, len(page.Items))
	for _, c := range page.Items {
		dto := sdo.DocumentShareCandidateDTO{
			PrincipalType:   c.PrincipalType,
			PrincipalID:     c.PrincipalID,
			Name:            c.Name,
			Subtitle:        c.Subtitle,
			IsHomeWorkspace: c.IsHomeWorkspace,
		}
		if c.AvatarURL != "" {
			v := c.AvatarURL
			dto.AvatarURL = &v
		}
		if c.IconEmoji != "" {
			v := c.IconEmoji
			dto.IconEmoji = &v
		}
		if c.DirectLevel != "" {
			v := c.DirectLevel
			dto.DirectLevel = &v
		}
		items = append(items, dto)
	}
	var nextCursor *string
	if page.NextCursor != "" {
		c := page.NextCursor
		nextCursor = &c
	}
	respondJSON(w, http.StatusOK, sdo.DocumentShareCandidateListSDO{
		Items:      items,
		NextCursor: nextCursor,
	})
}
