package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
)

type organizationDTO struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
	Role string `json:"role,omitempty"`
}

func (h *handlers) listOrganizations(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Organizations.ListForUser(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]organizationDTO, 0, len(rows))
	for _, o := range rows {
		out = append(out, organizationDTO{ID: o.ID, Slug: o.Slug, Name: o.Name, Role: o.Role})
	}
	respondJSON(w, 200, map[string]any{"organizations": out})
}

func (h *handlers) createOrganization(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	o, err := h.Organizations.Create(r.Context(), middleware.UserID(r.Context()), in.Name, in.Slug)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, map[string]any{"organization": organizationDTO{ID: o.ID, Slug: o.Slug, Name: o.Name, Role: "owner"}})
}

// GET /orgs/{org} — {org} là slug.
func (h *handlers) getOrganization(w http.ResponseWriter, r *http.Request) {
	o, m, err := h.Organizations.GetBySlug(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "org"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"organization": organizationDTO{ID: o.ID, Slug: o.Slug, Name: o.Name, Role: m.Role}})
}

// GET /orgs/{org}/workspaces — {org} là id.
func (h *handlers) listOrgWorkspaces(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Organizations.ListWorkspaces(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "org"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]workspaceDTO, 0, len(rows))
	for _, x := range rows {
		out = append(out, workspaceDTO{ID: x.ID, Slug: x.Slug, Name: x.Name, OrganizationID: x.OrganizationID,
			OrganizationSlug: x.OrganizationSlug, OrganizationName: x.OrganizationName})
	}
	respondJSON(w, 200, map[string]any{"workspaces": out})
}

// POST /orgs/{org}/workspaces — {org} là id.
func (h *handlers) createOrgWorkspace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	ws, err := h.Workspaces.CreateInOrg(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "org"), in.Name, in.Slug)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, map[string]any{"workspace": toWorkspaceDTO(ws)})
}
