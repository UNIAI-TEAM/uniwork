package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

type workspaceDTO struct {
	ID               string `json:"id"`
	Slug             string `json:"slug"`
	Name             string `json:"name"`
	OrganizationID   string `json:"organization_id"`
	OrganizationSlug string `json:"organization_slug"`
	OrganizationName string `json:"organization_name"`
}

func toWorkspaceDTO(w service.WorkspaceView) workspaceDTO {
	return workspaceDTO{ID: w.ID, Slug: w.Slug, Name: w.Name, OrganizationID: w.OrganizationID,
		OrganizationSlug: w.OrganizationSlug, OrganizationName: w.OrganizationName}
}

func (h *handlers) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.ListForUser(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]workspaceDTO, 0, len(ws))
	for _, x := range ws {
		out = append(out, toWorkspaceDTO(x))
	}
	respondJSON(w, 200, map[string]any{"workspaces": out})
}

// GET /orgs/{org}/workspaces/{wsSlug} — {org} là slug.
func (h *handlers) getWorkspaceBySlugs(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.GetBySlugs(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "org"), chi.URLParam(r, "wsSlug"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"workspace": toWorkspaceDTO(ws)})
}

func (h *handlers) listMembers(w http.ResponseWriter, r *http.Request) {
	ms, err := h.Workspaces.Members(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"members": ms})
}

// POST /workspaces/{id}/invitations — nhận `emails: []` (mới) hoặc `email` đơn (tương thích).
func (h *handlers) createInvitation(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email  string   `json:"email"`
		Emails []string `json:"emails"`
		Role   string   `json:"role"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	emails := in.Emails
	if in.Email != "" {
		emails = append(emails, in.Email)
	}
	invs, skipped, err := h.Workspaces.InviteMany(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), emails, in.Role)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]map[string]string, 0, len(invs))
	for _, inv := range invs {
		out = append(out, map[string]string{"id": inv.ID, "email": inv.Email, "role": inv.Role, "token": inv.Token})
	}
	if skipped == nil {
		skipped = []string{}
	}
	respondJSON(w, 200, map[string]any{"invitations": out, "skipped": skipped})
}

func (h *handlers) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.AcceptInvite(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "token"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"workspace": toWorkspaceDTO(ws)})
}
