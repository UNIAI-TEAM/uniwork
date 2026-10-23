package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Personal AI provider credentials HTTP (UNI-1008, ADR 0029). The rows are the
// caller's own, scoped to one organization; no answer ever carries a key, only
// its hint. A non-member of the organization sees 404 from the service.

// maxAICredentialBody caps a credential PUT: a key, a URL, a label and a model.
const maxAICredentialBody = 16 << 10

func aiCredentialDTO(c service.AICredential) sdo.AICredentialSDO {
	modelUpdatedAt := ""
	if !c.ModelUpdatedAt.IsZero() {
		modelUpdatedAt = c.ModelUpdatedAt.UTC().Format(time.RFC3339)
	}
	return sdo.AICredentialSDO{
		Provider: c.Provider, Label: c.Label, BaseURL: c.BaseURL, KeyHint: c.KeyHint,
		Model: c.Model, ModelUpdatedAt: modelUpdatedAt,
		CreatedAt: c.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: c.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func respondAICredentialsUnavailable(w http.ResponseWriter) {
	respondError(w, http.StatusServiceUnavailable, "ai_credentials_unavailable", "AI credentials are not configured")
}

// listAICredentials is GET /orgs/{orgID}/ai/credentials (and the frame
// mount's .../ai/credentials): the resolver names the caller and organization.
func (h *aiHandlers) listAICredentials(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if h.AICredentials == nil {
		respondAICredentialsUnavailable(w)
		return
	}
	rows, err := h.AICredentials.ListAICredentials(r.Context(), service.Human(userID), orgID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	var byok sdo.AIBYOKStatusDTO
	if h.AIBYOK != nil {
		enabled, reason, err := h.AIBYOK.Status(r.Context(), userID, orgID)
		if err != nil {
			log := h.Log
			if log == nil {
				log = slog.Default()
			}
			log.ErrorContext(r.Context(), "ai: byok status lookup failed", "organization_id", orgID, "user_id", userID, "err", err)
		} else {
			byok = sdo.AIBYOKStatusDTO{Enabled: enabled, Reason: reason}
		}
	}
	providers := service.AIProviders()
	out := sdo.AICredentialListSDO{
		Items:     make([]sdo.AICredentialSDO, 0, len(rows)),
		Providers: make([]sdo.AIProviderSDO, 0, len(providers)),
		BYOK:      byok,
	}
	for _, c := range rows {
		out.Items = append(out.Items, aiCredentialDTO(c))
	}
	for _, p := range providers {
		out.Providers = append(out.Providers, sdo.AIProviderSDO{
			ID: p.ID, Protocol: p.Protocol, RequiresBaseURL: p.RequiresBaseURL, DefaultBaseURL: p.DefaultBaseURL,
		})
	}
	respondJSON(w, http.StatusOK, out)
}

// saveAICredential is PUT /orgs/{orgID}/ai/credentials/{aiProvider}: 201 when
// it created the credential, 200 when it replaced one.
func (h *aiHandlers) saveAICredential(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if h.AICredentials == nil {
		respondAICredentialsUnavailable(w)
		return
	}
	var in sdi.SaveAICredentialSDI
	if !decode(w, r, &in, maxAICredentialBody) {
		return
	}
	cred, created, err := h.AICredentials.SaveAICredential(r.Context(), service.Human(userID),
		orgID, chi.URLParam(r, "aiProvider"), service.SaveAICredentialInput{
			APIKey: in.APIKey, BaseURL: in.BaseURL, Label: in.Label, Model: in.Model,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	respondJSON(w, status, aiCredentialDTO(cred))
}

// deleteAICredential is DELETE /orgs/{orgID}/ai/credentials/{aiProvider}.
func (h *aiHandlers) deleteAICredential(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if h.AICredentials == nil {
		respondAICredentialsUnavailable(w)
		return
	}
	if err := h.AICredentials.DeleteAICredential(r.Context(), service.Human(userID),
		orgID, chi.URLParam(r, "aiProvider")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
