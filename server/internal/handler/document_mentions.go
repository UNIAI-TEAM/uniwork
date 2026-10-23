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

// Document mention candidates HTTP (G8-06, UNI-1401). The handler owns no
// decision: it forwards the path param and the query string to
// DocumentService, which authorizes the caller (view) and answers the people
// who hold at least view - so whether the caller sees emails is part of that
// answer, never of this mapping.

// listDocumentMentionCandidates is GET /documents/{documentID}/mention-candidates:
// the mention picker's people (view level). q is folded and matched against
// the display name and the email; limit clamps in the service (default 20,
// cap 50), so the wire never carries more than the cap.
func (h *handlers) listDocumentMentionCandidates(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	q := r.URL.Query()
	// include=no_access adds the people who cannot read the document; any
	// other value is ignored, and the service ignores it too for a caller who
	// may not list the workspace's members.
	in := service.MentionCandidateQuery{
		Query:           strings.TrimSpace(q.Get("q")),
		IncludeNoAccess: strings.TrimSpace(q.Get("include")) == "no_access",
	}
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be an integer")
			return
		}
		// The pointer is what tells "no limit asked for" (default page) from
		// an explicit value, which the service clamps into [1, 50].
		in.Limit = &n
	}
	candidates, err := h.Documents.MentionCandidates(
		r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.MentionCandidateListSDO{Candidates: make([]sdo.MentionCandidateDTO, 0, len(candidates))}
	for _, c := range candidates {
		row := sdo.MentionCandidateDTO{UserID: c.UserID, DisplayName: c.DisplayName, CanView: c.CanView}
		if c.AvatarURL != "" {
			avatar := c.AvatarURL
			row.AvatarURL = &avatar
		}
		if c.Email != "" {
			email := c.Email
			row.Email = &email
		}
		out.Candidates = append(out.Candidates, row)
	}
	respondJSON(w, http.StatusOK, out)
}
