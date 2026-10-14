package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// The web side of the MCP connector (ADR 0031): the consent screen, the
// connected apps of a person and of an organization, and the organization's
// switch. These are ordinary session routes, so they go through the api
// wrapper and SDI/SDO; the OAuth protocol routes are in mcp_oauth.go. Every
// decision, including who may see which grant, is the service's.

// mcpTimePtr is an RFC 3339 timestamp, or null when there is none.
func mcpTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

func consentSDO(c service.McpConsent) sdo.McpConsentSDO {
	out := sdo.McpConsentSDO{
		AttemptID: c.AttemptID, Status: c.Status, RedirectHost: c.RedirectHost, Scope: c.Scope,
		CSRFToken: c.CSRFToken, Organizations: []sdo.McpConsentOrgSDO{},
	}
	if c.Client.ClientID != "" { // an attempt that has ended names no client
		out.Client = &sdo.McpConsentClientSDO{ClientID: c.Client.ClientID, Name: c.Client.Name, LogoURI: c.Client.LogoURI, Verified: c.Client.Verified}
	}
	for _, o := range c.Organizations {
		out.Organizations = append(out.Organizations, sdo.McpConsentOrgSDO{ID: o.ID, Slug: o.Slug, Name: o.Name, Enabled: o.Enabled, Reason: o.Reason})
	}
	return out
}

func (h *handlers) grantsSDO(gs []service.McpGrantView) sdo.McpGrantListSDO {
	out := sdo.McpGrantListSDO{Grants: make([]sdo.McpGrantSDO, 0, len(gs)), McpURL: h.McpAuth.ResourceURL()}
	for _, g := range gs {
		created := g.CreatedAt
		out.Grants = append(out.Grants, sdo.McpGrantSDO{
			ID: g.ID, OrganizationID: g.OrganizationID, OrganizationName: g.OrganizationName, UserID: g.UserID, UserName: g.UserName,
			ClientID: g.ClientID, ClientName: g.ClientName, Verified: g.Verified, Scope: g.Scope,
			CreatedAt: *mcpTimePtr(&created), LastUsedAt: mcpTimePtr(g.LastUsedAt),
		})
	}
	return out
}

func (h *handlers) policySDO(p service.McpPolicy) sdo.McpPolicySDO {
	return sdo.McpPolicySDO{Enabled: p.Enabled, Available: p.Available, EnabledAt: mcpTimePtr(p.EnabledAt), EnabledBy: p.EnabledBy, McpURL: h.McpAuth.ResourceURL()}
}

// mcpConsent shows an attempt and issues a fresh CSRF token. Reading never
// approves; an attempt that is another person's or does not exist is the same
// 404.
func (h *handlers) mcpConsent(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.mcpReady(w) {
		return
	}
	c, err := h.McpAuth.Consent(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "attemptID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, consentSDO(c))
}

// mcpConsentCommand is the person's decision. The answer carries the URL the
// browser follows back to the AI app: the code (or access_denied) is in it,
// so the response is never cached.
func (h *handlers) mcpConsentCommand(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.mcpReady(w) {
		return
	}
	var in sdi.McpConsentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	userID, attempt := middleware.UserID(r.Context()), chi.URLParam(r, "attemptID")
	var to, status string
	var err error
	switch strings.ToLower(strings.TrimSpace(in.Decision)) {
	case "approve":
		orgID := strings.TrimSpace(in.OrganizationID)
		if orgID == "" {
			respondError(w, http.StatusBadRequest, "invalid_request", "organization_id is required to approve")
			return
		}
		to, err = h.McpAuth.Approve(r.Context(), userID, attempt, in.CSRFToken, orgID)
		status = "approved"
	case "cancel": // the organization is not read
		to, err = h.McpAuth.Cancel(r.Context(), userID, attempt, in.CSRFToken)
		status = "cancelled"
	default:
		respondError(w, http.StatusBadRequest, "invalid_request", "decision must be approve or cancel")
		return
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.McpConsentResultSDO{Status: status, RedirectTo: to})
}

func (h *handlers) myConnectedApps(w http.ResponseWriter, r *http.Request) {
	if !h.mcpReady(w) {
		return
	}
	gs, err := h.McpAuth.ListMyGrants(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, h.grantsSDO(gs))
}

// revokeMyConnectedApp: a grant that is not the caller's reads as absent.
func (h *handlers) revokeMyConnectedApp(w http.ResponseWriter, r *http.Request) {
	if !h.mcpReady(w) {
		return
	}
	if err := h.McpAuth.RevokeMyGrant(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "grantID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) orgConnectedApps(w http.ResponseWriter, r *http.Request) {
	if !h.mcpReady(w) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	gs, err := h.McpAuth.ListOrgGrants(r.Context(), middleware.UserID(r.Context()), orgID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, h.grantsSDO(gs))
}

func (h *handlers) revokeOrgConnectedApp(w http.ResponseWriter, r *http.Request) {
	if !h.mcpReady(w) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	if err := h.McpAuth.RevokeOrgGrant(r.Context(), middleware.UserID(r.Context()), orgID, chi.URLParam(r, "grantID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) orgMcpPolicy(w http.ResponseWriter, r *http.Request) {
	if !h.mcpReady(w) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	p, err := h.McpAuth.Policy(r.Context(), middleware.UserID(r.Context()), orgID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, h.policySDO(p))
}

func (h *handlers) setOrgMcpPolicy(w http.ResponseWriter, r *http.Request) {
	if !h.mcpReady(w) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	var in sdi.McpPolicySDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	p, err := h.McpAuth.SetPolicy(r.Context(), middleware.UserID(r.Context()), orgID, in.Enabled)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, h.policySDO(p))
}
