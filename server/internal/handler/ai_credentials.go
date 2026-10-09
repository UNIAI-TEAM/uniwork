package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Personal AI provider credentials HTTP (UNI-1008, ADR 0029). The rows are the
// caller's own, scoped to one organization; no answer ever carries a key, only
// its hint. A non-member of the organization sees 404 from the service.

// maxAICredentialBody caps a credential PUT: a key, a URL and a label.
const maxAICredentialBody = 16 << 10

func aiCredentialDTO(c service.AICredential) sdo.AICredentialSDO {
	return sdo.AICredentialSDO{
		Provider: c.Provider, Label: c.Label, BaseURL: c.BaseURL, KeyHint: c.KeyHint,
		CreatedAt: c.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: c.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func respondAICredentialsUnavailable(w http.ResponseWriter) {
	respondError(w, http.StatusServiceUnavailable, "ai_credentials_unavailable", "AI credentials are not configured")
}

// listAICredentials is GET /orgs/{orgID}/ai/credentials.
func (h *handlers) listAICredentials(w http.ResponseWriter, r *http.Request) {
	if h.AICredentials == nil {
		respondAICredentialsUnavailable(w)
		return
	}
	rows, err := h.AICredentials.ListAICredentials(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "orgID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	providers := service.AIProviders()
	out := sdo.AICredentialListSDO{
		Items:     make([]sdo.AICredentialSDO, 0, len(rows)),
		Providers: make([]sdo.AIProviderSDO, 0, len(providers)),
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
func (h *handlers) saveAICredential(w http.ResponseWriter, r *http.Request) {
	if h.AICredentials == nil {
		respondAICredentialsUnavailable(w)
		return
	}
	var in sdi.SaveAICredentialSDI
	if !decode(w, r, &in, maxAICredentialBody) {
		return
	}
	cred, created, err := h.AICredentials.SaveAICredential(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "orgID"), chi.URLParam(r, "aiProvider"), service.SaveAICredentialInput{
			APIKey: in.APIKey, BaseURL: in.BaseURL, Label: in.Label,
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
func (h *handlers) deleteAICredential(w http.ResponseWriter, r *http.Request) {
	if h.AICredentials == nil {
		respondAICredentialsUnavailable(w)
		return
	}
	if err := h.AICredentials.DeleteAICredential(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "orgID"), chi.URLParam(r, "aiProvider")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
