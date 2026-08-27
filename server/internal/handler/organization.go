package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

func (h *handlers) listOrganizations(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Organizations.ListForUser(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.OrganizationDTO, 0, len(rows))
	for _, o := range rows {
		out = append(out, sdo.OrganizationDTO{ID: o.ID, Slug: o.Slug, Name: o.Name, Role: o.Role})
	}
	respondJSON(w, 200, map[string]any{"organizations": out})
}

func (h *handlers) createOrganization(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateOrganizationSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	o, err := h.Organizations.Create(r.Context(), middleware.UserID(r.Context()), in.Name, in.Slug)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, map[string]any{"organization": sdo.OrganizationDTO{ID: o.ID, Slug: o.Slug, Name: o.Name, Role: "owner"}})
}

func (h *handlers) getOrganization(w http.ResponseWriter, r *http.Request) {
	o, m, err := h.Organizations.GetBySlug(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "org"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"organization": sdo.OrganizationDTO{ID: o.ID, Slug: o.Slug, Name: o.Name, Role: m.Role}})
}

func (h *handlers) listOrgWorkspaces(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Organizations.ListWorkspaces(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "org"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.WorkspaceDTO, 0, len(rows))
	for _, x := range rows {
		out = append(out, sdo.WorkspaceDTO{ID: x.ID, Slug: x.Slug, Name: x.Name, OrganizationID: x.OrganizationID,
			OrganizationSlug: x.OrganizationSlug, OrganizationName: x.OrganizationName})
	}
	respondJSON(w, 200, map[string]any{"workspaces": out})
}

func (h *handlers) createOrgWorkspace(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateWorkspaceSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	ws, err := h.Workspaces.CreateInOrg(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "org"), in.Name, in.Slug)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, map[string]any{"workspace": toWorkspaceDTO(ws)})
}
