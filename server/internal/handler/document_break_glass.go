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

// Break-glass HTTP (DOC-05; UNI-1628): emergency view access for a workspace
// admin on a restricted document, its revoke, and the metadata-only admin
// summary. Every rule lives in DocumentService.

// documentBreakGlassGrantDTO renders one grant.
func documentBreakGlassGrantDTO(v service.DocumentBreakGlassGrantView) sdo.DocumentBreakGlassGrantDTO {
	g := v.Grant
	out := sdo.DocumentBreakGlassGrantDTO{
		ID: g.ID, DocumentID: g.DocumentID, ActorID: g.ActorID, ActorName: v.ActorName,
		Level: g.Level, Reason: g.Reason,
	}
	if g.GrantedAt.Valid {
		out.GrantedAt = g.GrantedAt.Time.UTC().Format(time.RFC3339)
	}
	if g.ExpiresAt.Valid {
		out.ExpiresAt = g.ExpiresAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

// createDocumentBreakGlass is POST /documents/{documentID}/break-glass: 201
// for a new grant, 200 with the same body when the caller already holds a live
// one.
func (h *handlers) createDocumentBreakGlass(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.BreakGlassSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	grant, created, err := h.Documents.GrantDocumentBreakGlass(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), in.Reason)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	respondJSON(w, status, sdo.DocumentBreakGlassSDO{Grant: documentBreakGlassGrantDTO(grant)})
}

// revokeDocumentBreakGlass is DELETE /documents/{documentID}/break-glass/{grantID}.
func (h *handlers) revokeDocumentBreakGlass(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	err := h.Documents.RevokeDocumentBreakGlass(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), chi.URLParam(r, "grantID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

// getDocumentAdminSummary is GET /documents/{documentID}/admin-summary.
func (h *handlers) getDocumentAdminSummary(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	sum, err := h.Documents.DocumentAdminSummary(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	doc := sum.Document
	out := sdo.DocumentAdminSummarySDO{
		Document: sdo.DocumentAdminSummaryDocumentDTO{
			ID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			Kind: doc.Kind, Title: doc.Title, Visibility: doc.Visibility, SizeBytes: sum.SizeBytes,
			CreatedBy: doc.CreatedBy,
		},
		MyLevel:    string(sum.My.Level),
		Via:        string(sum.My.Via),
		AdminScope: sum.My.AdminScope,
	}
	if doc.ParentID.Valid {
		out.Document.ParentID = &doc.ParentID.String
	}
	if doc.Icon.Valid && doc.Icon.String != "" {
		out.Document.Icon = &doc.Icon.String
	}
	if doc.ArchivedAt.Valid {
		at := doc.ArchivedAt.Time.UTC().Format(time.RFC3339)
		out.Document.ArchivedAt = &at
	}
	if doc.CreatedAt.Valid {
		out.Document.CreatedAt = doc.CreatedAt.Time.UTC().Format(time.RFC3339)
	}
	if doc.UpdatedAt.Valid {
		out.Document.UpdatedAt = doc.UpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	if sum.ACLOwner != nil {
		out.ACLOwner = &sdo.DocumentPersonAccessDTO{
			UserID: sum.ACLOwner.UserID,
			Level:  string(sum.ACLOwner.Access.Level),
			Via:    string(sum.ACLOwner.Access.Via),
		}
	}
	if sum.MyGrant != nil {
		g := documentBreakGlassGrantDTO(*sum.MyGrant)
		out.MyGrant = &g
	}
	respondJSON(w, http.StatusOK, out)
}
