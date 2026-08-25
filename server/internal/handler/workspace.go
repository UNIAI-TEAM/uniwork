package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type workspaceDTO struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

func toWorkspaceDTO(w db.Workspace) workspaceDTO {
	return workspaceDTO{ID: w.ID, Slug: w.Slug, Name: w.Name}
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

func (h *handlers) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	ws, err := h.Workspaces.Create(r.Context(), middleware.UserID(r.Context()), in.Name, in.Slug)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"workspace": toWorkspaceDTO(ws)})
}

func (h *handlers) getWorkspace(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.GetBySlug(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "slug"))
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

func (h *handlers) createInvitation(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	inv, err := h.Workspaces.Invite(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), in.Email, in.Role)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"invitation": map[string]string{
		"id": inv.ID, "email": inv.Email, "role": inv.Role, "token": inv.Token,
	}})
}

func (h *handlers) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.AcceptInvite(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "token"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"workspace": toWorkspaceDTO(ws)})
}
