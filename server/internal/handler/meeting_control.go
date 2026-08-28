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

func toParticipantDTO(p db.MeetingParticipant) sdo.ParticipantDTO {
	return sdo.ParticipantDTO{
		ID: p.ID, MeetingID: p.MeetingID, PrincipalType: p.PrincipalType,
		UserID: p.UserID.String, GuestID: p.GuestID.String,
		DisplayNameSnapshot: p.DisplayNameSnapshot, Role: p.Role, Status: p.Status,
	}
}

func (h *handlers) listParticipants(w http.ResponseWriter, r *http.Request) {
	ps, err := h.Meetings.ListParticipants(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ParticipantDTO, 0, len(ps))
	for _, p := range ps {
		out = append(out, toParticipantDTO(p))
	}
	respondJSON(w, 200, map[string]any{"participants": out})
}

func (h *handlers) inviteParticipant(w http.ResponseWriter, r *http.Request) {
	var in sdi.InviteParticipantSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	p, err := h.Meetings.Invite(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), in.UserID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"participant": toParticipantDTO(p)})
}

func (h *handlers) listInvitations(w http.ResponseWriter, r *http.Request) {
	is, err := h.Meetings.ListInvitations(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.InvitationDTO, 0, len(is))
	for _, inv := range is {
		out = append(out, sdo.InvitationDTO{ID: inv.ID, MeetingID: inv.MeetingID, ParticipantID: inv.ParticipantID, ResponseStatus: inv.ResponseStatus})
	}
	respondJSON(w, 200, map[string]any{"invitations": out})
}

func (h *handlers) respondInvitation(w http.ResponseWriter, r *http.Request) {
	var in sdi.InvitationResponseSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	inv, err := h.Meetings.RespondInvitation(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "invitationID"), in.Response)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"invitation": sdo.InvitationDTO{ID: inv.ID, MeetingID: inv.MeetingID, ParticipantID: inv.ParticipantID, ResponseStatus: inv.ResponseStatus}})
}

func (h *handlers) removeParticipant(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.RemoveParticipant(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "participantID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func toLinkDTO(l db.MeetingInviteLink, secret string) sdo.InviteLinkDTO {
	d := sdo.InviteLinkDTO{
		ID: l.ID, MeetingID: l.MeetingID, Name: l.Name, AccessMode: l.AccessMode,
		ExpiresAt: rfc3339(l.ExpiresAt), UsedCount: l.UsedCount, Secret: secret,
	}
	if l.MaxUses.Valid {
		v := l.MaxUses.Int32
		d.MaxUses = &v
	}
	if l.RevokedAt.Valid {
		d.RevokedAt = rfc3339(l.RevokedAt)
	}
	return d
}

func (h *handlers) listInviteLinks(w http.ResponseWriter, r *http.Request) {
	ls, err := h.Meetings.ListInviteLinks(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.InviteLinkDTO, 0, len(ls))
	for _, l := range ls {
		out = append(out, toLinkDTO(l, ""))
	}
	respondJSON(w, 200, map[string]any{"invite_links": out})
}

func (h *handlers) createInviteLink(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateInviteLinkSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	created, err := h.Meetings.CreateInviteLink(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), in.Name, in.AccessMode, in.ExpiresAt, in.MaxUses)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"invite_link": toLinkDTO(created.Link, created.RawSecret)})
}

func (h *handlers) revokeInviteLink(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.RevokeInviteLink(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "linkId")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) resolveInviteLink(w http.ResponseWriter, r *http.Request) {
	var in sdi.ResolveInviteLinkSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	v, err := h.Meetings.ResolveInviteLink(r.Context(), in.LinkID, in.Secret)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.PublicInviteLinkSDO{
		LinkID: v.LinkID, MeetingID: v.MeetingID, Title: v.Title, StartsAt: v.StartsAt.UTC().Format(time.RFC3339),
		AccessMode: v.AccessMode, Expired: v.Expired,
	})
}

func (h *handlers) listJoinRequests(w http.ResponseWriter, r *http.Request) {
	rs, err := h.Meetings.ListJoinRequests(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.JoinRequestDTO, 0, len(rs))
	for _, jr := range rs {
		out = append(out, sdo.JoinRequestDTO{
			ID: jr.ID, MeetingID: jr.MeetingID, RequesterUserID: jr.RequesterUserID.String,
			DisplayNameSnapshot: jr.DisplayNameSnapshot, Status: jr.Status,
		})
	}
	respondJSON(w, 200, map[string]any{"join_requests": out})
}

func (h *handlers) createJoinRequest(w http.ResponseWriter, r *http.Request) {
	jr, err := h.Meetings.RequestJoin(r.Context(), service.AdmissionContext{
		MeetingID: chi.URLParam(r, "meetingID"), UserID: middleware.UserID(r.Context()),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"join_request": sdo.JoinRequestDTO{
		ID: jr.ID, MeetingID: jr.MeetingID, RequesterUserID: jr.RequesterUserID.String,
		DisplayNameSnapshot: jr.DisplayNameSnapshot, Status: jr.Status,
	}})
}

func (h *handlers) approveJoinRequest(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.ApproveJoinRequest(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "requestId")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) rejectJoinRequest(w http.ResponseWriter, r *http.Request) {
	var in sdi.RejectJoinRequestSDI
	if r.ContentLength > 0 && !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Meetings.RejectJoinRequest(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "requestId"), in.Reason); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) cancelJoinRequest(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.CancelJoinRequest(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "requestId")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) joinMeeting(w http.ResponseWriter, r *http.Request) {
	var in sdi.JoinMeetingSDI
	if r.ContentLength > 0 && r.Header.Get("Content-Type") != "" {
		if !decode(w, r, &in, maxJSONBody) {
			return
		}
	}
	uName := ""
	if u, err := h.Auth.Me(r.Context(), middleware.UserID(r.Context())); err == nil {
		uName = u.DisplayName
	}
	dec, err := h.Meetings.Join(r.Context(), service.AdmissionContext{
		MeetingID: chi.URLParam(r, "meetingID"), UserID: middleware.UserID(r.Context()),
		DisplayName: uName, InviteLinkID: in.InviteLinkID, InviteSecret: in.Secret,
	})
	if err != nil && dec.Decision == "" {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.JoinDecisionSDO{Decision: dec.Decision, Reason: dec.Reason, MeetingStatus: dec.Meeting.Status, JoinRequestID: dec.JoinRequestID}
	if dec.Credential != nil {
		w.Header().Set("Cache-Control", "no-store")
		out.ConferenceSessionID = dec.ConferenceSessionID
		out.Provider = "livekit"
		out.ServerURL = dec.Credential.ServerURL
		out.ParticipantToken = dec.Credential.Token
		out.ExpiresAt = dec.Credential.ExpiresAt.UTC().Format(time.RFC3339)
	}
	respondJSON(w, 200, out)
}
