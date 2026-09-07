package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func toAgentDTO(a db.Agent) sdo.AgentDTO {
	out := sdo.AgentDTO{
		ID: a.ID, OrganizationID: a.OrganizationID, Name: a.Name, Handle: a.Handle,
		Description: a.Description, Status: a.Status, OwnerUserID: a.OwnerUserID,
		CreatedAt: a.CreatedAt.Time.Format(time.RFC3339),
	}
	if a.AvatarUrl.Valid {
		out.AvatarURL = a.AvatarUrl.String
	}
	return out
}

func toActorDTO(a service.ActorInfo) sdo.ActorDTO {
	return sdo.ActorDTO{ID: a.ID, Kind: string(a.Kind), DisplayName: a.DisplayName, AvatarURL: a.AvatarURL}
}

func (h *handlers) listOrgAgents(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())
	o, _, err := h.Organizations.GetBySlug(r.Context(), userID, chi.URLParam(r, "org"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	rows, err := h.Agents.List(r.Context(), userID, o.ID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AgentDTO, 0, len(rows))
	for _, a := range rows {
		out = append(out, toAgentDTO(a))
	}
	respondJSON(w, 200, sdo.AgentListSDO{Agents: out})
}

func (h *handlers) createOrgAgent(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateAgentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	userID := middleware.UserID(r.Context())
	o, _, err := h.Organizations.GetBySlug(r.Context(), userID, chi.URLParam(r, "org"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	a, err := h.Agents.Create(r.Context(), userID, o.ID, service.CreateAgentInput{
		Name: in.Name, Handle: in.Handle, Description: in.Description, AvatarURL: in.AvatarURL,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, sdo.AgentSDO{Agent: toAgentDTO(a)})
}

func (h *handlers) patchAgent(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchAgentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	a, err := h.Agents.Update(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "agentID"), service.UpdateAgentInput{
		Name: in.Name, Description: in.Description, AvatarURL: in.AvatarURL, Status: in.Status,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AgentSDO{Agent: toAgentDTO(a)})
}

func (h *handlers) listWorkspaceAgents(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Agents.ListInWorkspace(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AgentDTO, 0, len(rows))
	for _, a := range rows {
		dto := sdo.AgentDTO{
			ID: a.ID, OrganizationID: a.OrganizationID, Name: a.Name, Handle: a.Handle,
			Description: a.Description, Status: a.Status, OwnerUserID: a.OwnerUserID,
			CreatedAt: a.JoinedAt.Time.Format(time.RFC3339),
		}
		if a.AvatarUrl.Valid {
			dto.AvatarURL = a.AvatarUrl.String
		}
		out = append(out, dto)
	}
	respondJSON(w, 200, sdo.AgentListSDO{Agents: out})
}

func (h *handlers) addWorkspaceAgent(w http.ResponseWriter, r *http.Request) {
	var in sdi.AddWorkspaceAgentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Agents.AddToWorkspace(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), in.AgentID); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, sdo.StatusSDO{Status: "ok"})
}
