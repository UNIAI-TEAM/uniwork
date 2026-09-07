package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// orgIDFromSlug resolves the {org} path segment for a caller who must be an
// active member. Every failure — unknown slug, outsider, deactivated,
// suspended tenant — is already shaped by the service, so the handler only
// forwards it.
// pgText unwraps a nullable text column for a DTO field that omits when empty.
func pgText(v pgtype.Text) string {
	if !v.Valid {
		return ""
	}
	return v.String
}

func (h *handlers) orgIDFromSlug(w http.ResponseWriter, r *http.Request) (string, bool) {
	o, _, err := h.Organizations.GetBySlug(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "org"))
	if err != nil {
		h.mapServiceError(w, err)
		return "", false
	}
	return o.ID, true
}

func (h *handlers) listOrgMembers(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil {
		limit = 0
	}
	page, err := h.OrgMembers.Members(r.Context(), middleware.UserID(r.Context()), orgID,
		r.URL.Query().Get("status"), r.URL.Query().Get("cursor"), int32(limit))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.OrgMemberDTO, 0, len(page.Members))
	for _, m := range page.Members {
		out = append(out, sdo.OrgMemberDTO{
			UserID: m.UserID, Email: m.Email, DisplayName: m.DisplayName,
			AvatarURL: pgText(m.AvatarUrl), Role: m.Role,
			DeactivatedAt: rfc3339(m.DeactivatedAt), InvitedBy: pgText(m.InvitedBy),
			CreatedAt: m.CreatedAt.Time.UTC().Format(time.RFC3339),
		})
	}
	respondJSON(w, http.StatusOK, sdo.OrgMemberListSDO{Members: out, NextCursor: page.NextCursor})
}

func (h *handlers) getOrgMembershipMe(w http.ResponseWriter, r *http.Request) {
	_, m, err := h.OrgMembers.Membership(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "org"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.OrgMembershipSDO{
		Role: m.Role, DeactivatedAt: rfc3339(m.DeactivatedAt),
	})
}

func (h *handlers) patchOrgMember(w http.ResponseWriter, r *http.Request) {
	var in sdi.OrgMemberRoleSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	m, err := h.OrgMembers.UpdateRole(r.Context(), middleware.UserID(r.Context()), orgID, chi.URLParam(r, "userID"), in.Role)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondOrgMember(w, r, m)
}

func (h *handlers) deactivateOrgMember(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	m, err := h.OrgMembers.Deactivate(r.Context(), middleware.UserID(r.Context()), orgID, chi.URLParam(r, "userID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondOrgMember(w, r, m)
}

func (h *handlers) reactivateOrgMember(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	m, err := h.OrgMembers.Reactivate(r.Context(), middleware.UserID(r.Context()), orgID, chi.URLParam(r, "userID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondOrgMember(w, r, m)
}

func (h *handlers) leaveOrganization(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	if err := h.OrgMembers.Leave(r.Context(), middleware.UserID(r.Context()), orgID); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

// respondOrgMember returns the membership row with the identity columns filled
// in, so the client can render the updated row without a second request.
func (h *handlers) respondOrgMember(w http.ResponseWriter, r *http.Request, m db.OrganizationMember) {
	dto := sdo.OrgMemberDTO{
		UserID: m.UserID, Role: m.Role,
		DeactivatedAt: rfc3339(m.DeactivatedAt), InvitedBy: pgText(m.InvitedBy),
		CreatedAt: m.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
	if infos, err := h.Actors.Resolve(r.Context(), []service.ActorRef{{Kind: audit.KindHuman, ID: m.UserID}}); err == nil {
		if info, ok := infos[service.ActorRef{Kind: audit.KindHuman, ID: m.UserID}]; ok {
			dto.DisplayName = info.DisplayName
			dto.AvatarURL = info.AvatarURL
		}
	}
	respondJSON(w, http.StatusOK, sdo.OrgMemberSDO{Member: dto})
}

func (h *handlers) inviteToOrganization(w http.ResponseWriter, r *http.Request) {
	var in sdi.OrgInviteSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	invs, skipped, err := h.OrgMembers.InviteToOrg(r.Context(), middleware.UserID(r.Context()), orgID, in.Emails, in.OrgRole)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.OrgInvitationDTO, 0, len(invs))
	for _, inv := range invs {
		out = append(out, sdo.OrgInvitationDTO{
			ID: inv.ID, Email: inv.Email, OrgRole: inv.OrgRole,
			ExpiresAt: rfc3339(inv.ExpiresAt), CreatedAt: rfc3339(inv.CreatedAt),
		})
	}
	if skipped == nil {
		skipped = []string{}
	}
	respondJSON(w, http.StatusOK, sdo.OrgInvitationListSDO{Invitations: out, Skipped: skipped})
}

func (h *handlers) listOrgInvitations(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	rows, err := h.OrgMembers.PendingInvitations(r.Context(), middleware.UserID(r.Context()), orgID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.OrgInvitationDTO, 0, len(rows))
	for _, inv := range rows {
		out = append(out, sdo.OrgInvitationDTO{
			ID: inv.ID, Email: inv.Email, OrgRole: inv.OrgRole,
			InvitedByName: pgText(inv.InvitedByName),
			ExpiresAt:     rfc3339(inv.ExpiresAt), CreatedAt: rfc3339(inv.CreatedAt),
		})
	}
	respondJSON(w, http.StatusOK, sdo.OrgInvitationListSDO{Invitations: out, Skipped: []string{}})
}

func (h *handlers) revokeOrgInvitation(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	if err := h.OrgMembers.RevokeInvitation(r.Context(), middleware.UserID(r.Context()), orgID, chi.URLParam(r, "invitationId")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) transferOrgOwnership(w http.ResponseWriter, r *http.Request) {
	var in sdi.TransferOwnershipSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	m, err := h.OrgMembers.TransferOwnership(r.Context(), middleware.UserID(r.Context()), orgID, in.ToUserID, in.Password)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondOrgMember(w, r, m)
}
