package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

const onboardingBodyLimit = 16 * 1024

func (h *handlers) patchOnboarding(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchOnboardingSDI
	if !decode(w, r, &in, onboardingBodyLimit) {
		return
	}
	u, err := h.Onboarding.PatchQuestionnaire(r.Context(), middleware.UserID(r.Context()), in.Questionnaire)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"user": toUserDTO(u)})
}

func (h *handlers) completeOnboarding(w http.ResponseWriter, r *http.Request) {
	var in sdi.CompleteOnboardingSDI
	if r.ContentLength != 0 && !decode(w, r, &in, maxJSONBody) {
		return
	}
	u, err := h.Onboarding.Complete(r.Context(), middleware.UserID(r.Context()), in.CompletionPath, in.WorkspaceID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.Log.Info("onboarding completed", "user", u.ID, "path", in.CompletionPath, "workspace", in.WorkspaceID)
	respondJSON(w, 200, map[string]any{"user": toUserDTO(u)})
}

func (h *handlers) seedWelcomeTask(w http.ResponseWriter, r *http.Request) {
	task, created, err := h.Onboarding.SeedWelcomeTask(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	status := 200
	if created {
		status = 201
	}
	respondJSON(w, status, map[string]any{"task": toTaskDTO(task)})
}

func (h *handlers) myInvitations(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Workspaces.PendingInvitations(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, x := range rows {
		out = append(out, map[string]any{
			"id": x.ID, "role": x.Role, "token": x.Token,
			"expires_at":   x.ExpiresAt.Time.Format(time.RFC3339),
			"workspace":    map[string]string{"id": x.WorkspaceID, "slug": x.WorkspaceSlug, "name": x.WorkspaceName},
			"organization": map[string]string{"id": x.OrganizationID, "slug": x.OrganizationSlug, "name": x.OrganizationName},
			"invited_by":   map[string]string{"display_name": x.InvitedByName},
		})
	}
	respondJSON(w, 200, map[string]any{"invitations": out})
}
