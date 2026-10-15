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

func toWorkspaceDTO(w service.WorkspaceView) sdo.WorkspaceDTO {
	return sdo.WorkspaceDTO{ID: w.ID, Slug: w.Slug, Name: w.Name, OrganizationID: w.OrganizationID,
		OrganizationSlug: w.OrganizationSlug, OrganizationName: w.OrganizationName,
		Description: w.Description, IconEmoji: w.IconEmoji.String, IconURL: w.IconURL, TaskPrefix: w.TaskPrefix}
}

func toMemberDTO(m db.ListWorkspaceMembersRow) sdo.MemberDTO {
	out := sdo.MemberDTO{
		WorkspaceID: m.WorkspaceID, UserID: m.UserID, Role: m.Role,
		Email: m.Email, DisplayName: m.DisplayName,
	}
	if m.CreatedAt.Valid {
		out.CreatedAt = m.CreatedAt.Time.Format(time.RFC3339)
	}
	if m.AvatarUrl.Valid {
		out.AvatarURL = m.AvatarUrl.String
	}
	return out
}

func toWorkspaceMemberDTO(m db.WorkspaceMember) sdo.WorkspaceMemberDTO {
	out := sdo.WorkspaceMemberDTO{WorkspaceID: m.WorkspaceID, UserID: m.UserID, Role: m.Role}
	if m.CreatedAt.Valid {
		out.CreatedAt = m.CreatedAt.Time.Format(time.RFC3339)
	}
	return out
}

func (h *handlers) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.ListForUser(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.WorkspaceDTO, 0, len(ws))
	for _, x := range ws {
		out = append(out, toWorkspaceDTO(x))
	}
	respondJSON(w, 200, sdo.WorkspaceListSDO{Workspaces: out})
}

// GET /orgs/{org}/workspaces/{wsSlug} — {org} là slug.
func (h *handlers) getWorkspaceBySlugs(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.GetBySlugs(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "org"), chi.URLParam(r, "wsSlug"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.WorkspaceSDO{Workspace: toWorkspaceDTO(ws)})
}

func (h *handlers) patchWorkspace(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchWorkspaceSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	ws, err := h.Workspaces.Update(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), service.UpdateWorkspaceInput{Name: in.Name, Description: in.Description, IconEmoji: in.IconEmoji, TaskPrefix: in.TaskPrefix, Slug: in.Slug})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.WorkspaceSDO{Workspace: toWorkspaceDTO(ws)})
}

func (h *handlers) listMembers(w http.ResponseWriter, r *http.Request) {
	ms, err := h.Workspaces.Members(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.MemberDTO, 0, len(ms))
	for _, m := range ms {
		out = append(out, toMemberDTO(m))
	}
	respondJSON(w, 200, sdo.MemberListSDO{Members: out})
}

func (h *handlers) getWorkspaceMe(w http.ResponseWriter, r *http.Request) {
	m, err := h.Workspaces.CurrentMembership(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MembershipSDO{Membership: sdo.MembershipDTO{
		UserID: m.UserID, Role: m.Role, Source: string(m.Source),
	}})
}

func (h *handlers) patchMember(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchMemberSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	m, err := h.Workspaces.UpdateMemberRole(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "userID"), in.Role)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MemberSDO{Member: toWorkspaceMemberDTO(m)})
}

func (h *handlers) deleteMember(w http.ResponseWriter, r *http.Request) {
	err := h.Workspaces.RemoveMember(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "userID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /workspaces/{id}/invitations — nhận `emails: []` (mới) hoặc `email` đơn (tương thích).
func (h *handlers) createInvitation(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateInvitationSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	emails := in.Emails
	if in.Email != "" {
		emails = append(emails, in.Email)
	}
	invs, skipped, err := h.Workspaces.InviteMany(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), emails, in.Role)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.InvitationCreatedDTO, 0, len(invs))
	for _, inv := range invs {
		out = append(out, sdo.InvitationCreatedDTO{ID: inv.ID, Email: inv.Email, Role: inv.Role})
	}
	if skipped == nil {
		skipped = []string{}
	}
	respondJSON(w, 200, sdo.InvitationCreateSDO{Invitations: out, Skipped: skipped})
}

// GET /invitations/{token} — the invitation page reads it before anything is
// accepted (spec §4.3).
func (h *handlers) previewInvitation(w http.ResponseWriter, r *http.Request) {
	p, err := h.Workspaces.PreviewInvitation(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "token"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.InvitationPreviewSDO{
		Invitation: sdo.InvitationPreviewDTO{
			ID: p.ID, Status: p.Status, ExpiresAt: p.ExpiresAt.UTC().Format(time.RFC3339),
			Organization: sdo.InvitationOrgDTO{ID: p.Organization.ID, Slug: p.Organization.Slug, Name: p.Organization.Name},
			OrgRole:      p.OrgRole, InviterName: p.InviterName,
			Workspaces: toInvitationWorkspaceDTOs(p.Workspaces),
		},
		Conflicts: make([]sdo.MembershipConflictDTO, 0, len(p.Conflicts)),
	}
	if p.Workspace != nil {
		out.Invitation.Workspace = &sdo.InvitationWorkspaceDTO{ID: p.Workspace.ID, Slug: p.Workspace.Slug, Name: p.Workspace.Name}
	}
	for _, c := range p.Conflicts {
		out.Conflicts = append(out.Conflicts, sdo.MembershipConflictDTO{
			Organization: sdo.InvitationOrgDTO{ID: c.Organization.ID, Slug: c.Organization.Slug, Name: c.Organization.Name},
			Role:         c.Role, RequiredAction: c.RequiredAction, BlockedReason: c.BlockedReason,
			TransferCandidatesCount: c.TransferCandidatesCount,
		})
	}
	respondJSON(w, 200, out)
}

// POST /invitations/{token}/accept — the body is optional, so a client that
// sends nothing still joins when nothing stands in the way.
func (h *handlers) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	var in sdi.AcceptInvitationSDI
	if !decodeOptionalBody(w, r, &in) {
		return
	}
	resolve := make([]service.SwitchResolution, 0, len(in.Resolve))
	for _, x := range in.Resolve {
		resolve = append(resolve, service.SwitchResolution{
			OrganizationID: x.OrganizationID, Action: x.Action,
			TransferToUserID: x.TransferToUserID, Password: x.Password, ConfirmSlug: x.ConfirmSlug,
		})
	}
	result, err := h.Workspaces.AcceptInvite(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "token"), resolve)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.AcceptInviteSDO{Organization: sdo.OrganizationDTO{
		ID: result.Organization.ID, Slug: result.Organization.Slug, Name: result.Organization.Name,
	}}
	// With nowhere to land - no workspace granted and none the person may
	// open - `workspace` is absent and the client says so (UNI-1472) rather
	// than sending them into a workspace they do not have.
	if result.Workspace != nil {
		dto := toWorkspaceDTO(*result.Workspace)
		out.Workspace = &dto
	}
	respondJSON(w, 200, out)
}
