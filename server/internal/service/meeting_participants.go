package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// InvitationResponse is independent of AccessGrant. DECLINED does not revoke
// access; only RemoveParticipant or RevokeAccess does.
func (s *MeetingService) inviteUserTx(ctx context.Context, q *db.Queries, m db.Meeting, actorID, userID string) (db.MeetingParticipant, error) {
	if _, err := s.ws.RequireMember(ctx, m.WorkspaceID, userID); err != nil {
		return db.MeetingParticipant{}, coded(http.StatusBadRequest, "invalid_request", "chỉ mời thành viên workspace")
	}
	existing, err := q.GetUserParticipantAnyStatus(ctx, db.GetUserParticipantAnyStatusParams{MeetingID: m.ID, UserID: strText(userID)})
	if err == nil && existing.Status == ParticipantActive {
		return existing, nil
	}
	if err == nil && existing.Status == ParticipantRemoved {
		return db.MeetingParticipant{}, coded(http.StatusConflict, "participant_removed", "người này đã bị gỡ; hãy mời lại bằng lệnh riêng")
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingParticipant{}, err
	}
	u, err := q.GetUserByID(ctx, userID)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	p, err := q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: util.NewID(), MeetingID: m.ID, PrincipalType: PrincipalUser,
		UserID: strText(userID), DisplayNameSnapshot: u.DisplayName,
		EmailSnapshot: strText(u.Email), Role: RoleAttendee, SourceType: GrantDirectInvite, AddedBy: actorID,
	})
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	_, err = q.CreateMeetingInvitation(ctx, db.CreateMeetingInvitationParams{
		ID: util.NewID(), MeetingID: m.ID, ParticipantID: p.ID, InvitedBy: actorID,
	})
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	_, err = q.CreateAccessGrant(ctx, db.CreateAccessGrantParams{
		ID: util.NewID(), MeetingID: m.ID, ParticipantID: p.ID,
		SourceType: GrantDirectInvite, GrantedBy: actorID,
	})
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	_ = s.writeAudit(ctx, q, m.ID, "PARTICIPANT_INVITED", actorID, "", p.ID, "{}")
	return p, nil
}

func (s *MeetingService) Invite(ctx context.Context, actorID, meetingID, userID string) (db.MeetingParticipant, error) {
	m, err := s.requireHostOrAdmin(ctx, actorID, meetingID)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	if m.Status != MeetingScheduled && m.Status != MeetingInProgress {
		return db.MeetingParticipant{}, errInvalidState()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	defer tx.Rollback(ctx)
	p, err := s.inviteUserTx(ctx, s.q.WithTx(tx), m, actorID, userID)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	s.record(ctx, s.q.WithTx(tx), m, audit.User(actorID), "participant.invited",
		meetingRelatedPayload(m, map[string]string{"participant_id": p.ID}), nil)
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingParticipant{}, err
	}
	return p, nil
}

func (s *MeetingService) ListParticipants(ctx context.Context, userID, guestID, meetingID string) ([]db.MeetingParticipant, error) {
	if _, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingParticipants(ctx, meetingID)
}

func (s *MeetingService) ListInvitations(ctx context.Context, userID, meetingID string) ([]db.MeetingInvitation, error) {
	if _, _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingInvitations(ctx, meetingID)
}

func (s *MeetingService) RespondInvitation(ctx context.Context, userID, meetingID, invitationID, response string) (db.MeetingInvitation, error) {
	switch response {
	case InviteAccepted, InviteDeclined, InviteTentative, InvitePending:
	default:
		return db.MeetingInvitation{}, Invalid("phản hồi không hợp lệ")
	}
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return db.MeetingInvitation{}, err
	}
	inv, err := s.q.GetMeetingInvitation(ctx, invitationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingInvitation{}, ErrNotFound
	}
	if err != nil {
		return db.MeetingInvitation{}, err
	}
	if inv.MeetingID != meetingID {
		return db.MeetingInvitation{}, ErrNotFound
	}
	p, err := s.q.GetMeetingParticipant(ctx, inv.ParticipantID)
	if err != nil {
		return db.MeetingInvitation{}, err
	}
	if p.UserID.String != userID {
		return db.MeetingInvitation{}, ErrForbidden
	}
	up, err := s.q.UpdateInvitationResponse(ctx, db.UpdateInvitationResponseParams{ID: invitationID, ResponseStatus: response})
	if err != nil {
		return db.MeetingInvitation{}, err
	}
	_ = s.writeAudit(ctx, s.q, m.ID, "INVITATION_RESPONDED", userID, inv.ResponseStatus, response, "{}")
	s.record(ctx, s.q, m, audit.User(userID), "invitation.responded",
		meetingRelatedPayload(m, map[string]string{"invitation_id": invitationID}),
		audit.Diff(map[string]any{"response": inv.ResponseStatus}, map[string]any{"response": response}))
	return up, nil
}

func (s *MeetingService) RemoveParticipant(ctx context.Context, actorID, meetingID, participantID string) error {
	m, err := s.requireHostOrAdmin(ctx, actorID, meetingID)
	if err != nil {
		return err
	}
	if m.Status != MeetingScheduled && m.Status != MeetingInProgress {
		return errInvalidState()
	}
	p, err := s.q.GetMeetingParticipant(ctx, participantID)
	if errors.Is(err, pgx.ErrNoRows) || p.MeetingID != meetingID {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if p.PrincipalType == PrincipalUser && p.UserID.Valid && p.UserID.String == m.HostUserID {
		return coded(http.StatusConflict, "cannot_remove_current_host", "phải chuyển chủ tọa trước khi gỡ")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := q.RemoveMeetingParticipant(ctx, db.RemoveMeetingParticipantParams{
		ID: participantID, RemovedBy: strText(actorID), RemoveReason: strText("removed"),
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	_ = q.RevokeGrantsForParticipant(ctx, db.RevokeGrantsForParticipantParams{
		ParticipantID: participantID, RevokedBy: strText(actorID), RevokeReason: strText("participant_removed"),
	})
	_ = s.writeAudit(ctx, q, m.ID, "PARTICIPANT_REMOVED", actorID, ParticipantActive, ParticipantRemoved, "{}")
	room := meetings.RoomNameForMeeting(m.ID)
	if sess, err := q.GetOpenConferenceSession(ctx, m.ID); err == nil {
		room = sess.ProviderRoomName
	}
	_ = s.enqueue(ctx, q, m.WorkspaceID, "provider.remove_participant", map[string]string{
		"meeting_id": m.ID, "room_name": room, "identity": meetings.IdentityForParticipant(participantID),
	})
	s.record(ctx, q, m, audit.User(actorID), "participant.removed",
		meetingRelatedPayload(m, map[string]string{"participant_id": participantID}), nil)
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}
