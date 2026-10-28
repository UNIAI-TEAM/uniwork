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

func daysToDuration(days *int) *time.Duration {
	if days == nil {
		return nil
	}
	d := time.Duration(*days) * 24 * time.Hour
	return &d
}

func toMembershipInviteLinkDTO(v service.MembershipInviteLinkView) sdo.MembershipInviteLinkDTO {
	wsID := ""
	if v.Link.WorkspaceID.Valid {
		wsID = v.Link.WorkspaceID.String
	}
	workspaces := make([]sdo.InvitationWorkspaceDTO, 0, len(v.Workspaces))
	for _, w := range v.Workspaces {
		workspaces = append(workspaces, sdo.InvitationWorkspaceDTO{ID: w.ID, Slug: w.Slug, Name: w.Name})
	}
	return sdo.MembershipInviteLinkDTO{
		ID: v.Link.ID, OrganizationID: v.Link.OrganizationID, WorkspaceID: wsID,
		Status: v.Status, ExpiresAt: v.Link.ExpiresAt.Time.UTC().Format(time.RFC3339),
		Secret: v.Secret, Workspaces: workspaces,
		CreatedAt: v.Link.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
}

func (h *handlers) listWorkspaceInviteLinks(w http.ResponseWriter, r *http.Request) {
	links, err := h.Workspaces.ListWorkspaceInviteLinks(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.MembershipInviteLinkDTO, 0, len(links))
	for _, l := range links {
		out = append(out, toMembershipInviteLinkDTO(l))
	}
	respondJSON(w, http.StatusOK, sdo.MembershipInviteLinkListSDO{InviteLinks: out})
}

func (h *handlers) createWorkspaceInviteLink(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateMembershipInviteLinkSDI
	if !decodeOptionalBody(w, r, &in) {
		return
	}
	view, err := h.Workspaces.CreateWorkspaceInviteLink(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), daysToDuration(in.ExpiresInDays))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.MembershipInviteLinkSDO{InviteLink: toMembershipInviteLinkDTO(view)})
}

func (h *handlers) revokeWorkspaceInviteLink(w http.ResponseWriter, r *http.Request) {
	view, err := h.Workspaces.RevokeWorkspaceInviteLink(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "linkID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.MembershipInviteLinkSDO{InviteLink: toMembershipInviteLinkDTO(view)})
}

func (h *handlers) regenerateWorkspaceInviteLink(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateMembershipInviteLinkSDI
	if !decodeOptionalBody(w, r, &in) {
		return
	}
	view, err := h.Workspaces.RegenerateWorkspaceInviteLink(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), daysToDuration(in.ExpiresInDays))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.MembershipInviteLinkSDO{InviteLink: toMembershipInviteLinkDTO(view)})
}

func (h *handlers) listOrgInviteLinks(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	links, err := h.OrgMembers.ListOrganizationInviteLinks(r.Context(), middleware.UserID(r.Context()), orgID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.MembershipInviteLinkDTO, 0, len(links))
	for _, l := range links {
		out = append(out, toMembershipInviteLinkDTO(l))
	}
	respondJSON(w, http.StatusOK, sdo.MembershipInviteLinkListSDO{InviteLinks: out})
}

func (h *handlers) createOrgInviteLink(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	var in sdi.CreateMembershipInviteLinkSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	view, err := h.OrgMembers.CreateOrganizationInviteLink(r.Context(), middleware.UserID(r.Context()),
		orgID, in.WorkspaceIDs, daysToDuration(in.ExpiresInDays))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.MembershipInviteLinkSDO{InviteLink: toMembershipInviteLinkDTO(view)})
}

func (h *handlers) revokeOrgInviteLink(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	view, err := h.OrgMembers.RevokeOrganizationInviteLink(r.Context(), middleware.UserID(r.Context()),
		orgID, chi.URLParam(r, "linkID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.MembershipInviteLinkSDO{InviteLink: toMembershipInviteLinkDTO(view)})
}

func (h *handlers) regenerateOrgInviteLink(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	var in sdi.CreateMembershipInviteLinkSDI
	if !decodeOptionalBody(w, r, &in) {
		return
	}
	view, err := h.OrgMembers.RegenerateOrganizationInviteLink(r.Context(), middleware.UserID(r.Context()),
		orgID, chi.URLParam(r, "linkID"), daysToDuration(in.ExpiresInDays))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.MembershipInviteLinkSDO{InviteLink: toMembershipInviteLinkDTO(view)})
}

func (h *handlers) previewMembershipInviteLink(w http.ResponseWriter, r *http.Request) {
	var in sdi.PreviewMembershipInviteLinkSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	p, err := h.Workspaces.PreviewMembershipInviteLink(r.Context(), middleware.UserID(r.Context()), in.LinkID, in.Secret)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.MembershipInvitePreviewSDO{
		LinkID: p.LinkID, Status: p.Status,
		Organization: sdo.InvitationOrgDTO{ID: p.OrganizationID, Slug: p.OrganizationSlug, Name: p.OrganizationName},
		Workspaces:   make([]sdo.MembershipInviteWorkspaceStateDTO, 0, len(p.Workspaces)),
		NeedsJoin:    p.NeedsJoin, AlreadyMember: p.AlreadyMember,
		Conflicts: make([]sdo.MembershipConflictDTO, 0, len(p.Conflicts)),
	}
	for _, ws := range p.Workspaces {
		out.Workspaces = append(out.Workspaces, sdo.MembershipInviteWorkspaceStateDTO{
			ID: ws.ID, Slug: ws.Slug, Name: ws.Name, Joined: ws.Joined,
		})
	}
	for _, c := range p.Conflicts {
		out.Conflicts = append(out.Conflicts, sdo.MembershipConflictDTO{
			Organization: sdo.InvitationOrgDTO{ID: c.Organization.ID, Slug: c.Organization.Slug, Name: c.Organization.Name},
			Role:         c.Role, RequiredAction: c.RequiredAction, BlockedReason: c.BlockedReason,
			TransferCandidatesCount: c.TransferCandidatesCount,
		})
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *handlers) joinMembershipInviteLink(w http.ResponseWriter, r *http.Request) {
	var in sdi.JoinMembershipInviteLinkSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	resolve := make([]service.SwitchResolution, 0, len(in.Resolve))
	for _, x := range in.Resolve {
		resolve = append(resolve, service.SwitchResolution{
			OrganizationID: x.OrganizationID, Action: x.Action,
			TransferToUserID: x.TransferToUserID, Password: x.Password, ConfirmSlug: x.ConfirmSlug,
		})
	}
	result, err := h.Workspaces.JoinMembershipInviteLink(r.Context(), middleware.UserID(r.Context()), in.LinkID, in.Secret, resolve)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.MembershipInviteJoinSDO{
		Organization: sdo.OrganizationDTO{
			ID: result.Organization.ID, Slug: result.Organization.Slug, Name: result.Organization.Name,
		},
		JoinedIDs:  result.JoinedIDs,
		AlreadyAll: result.AlreadyAll,
	}
	if out.JoinedIDs == nil {
		out.JoinedIDs = []string{}
	}
	if result.Workspace != nil {
		dto := toWorkspaceDTO(*result.Workspace)
		out.Workspace = &dto
	}
	respondJSON(w, http.StatusOK, out)
}
