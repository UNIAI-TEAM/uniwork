package service

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type AdmissionContext struct {
	MeetingID    string
	WorkspaceID  string // unused; meeting row is authoritative
	UserID       string
	GuestID      string
	DisplayName  string
	InviteLinkID string
	InviteSecret string
}

type AdmissionDecision struct {
	Decision            string
	Reason              string
	Meeting             db.Meeting
	Participant         db.MeetingParticipant
	JoinRequestID       string
	ConferenceSessionID string
	Credential          *meetings.JoinCredential
}

func (s *MeetingService) Join(ctx context.Context, in AdmissionContext) (AdmissionDecision, error) {
	dec, err := s.Evaluate(ctx, in)
	if err != nil {
		return AdmissionDecision{}, err
	}
	defer s.recordJoinDecision(dec.Decision)
	if dec.Decision != DecisionAdmit {
		return dec, nil
	}
	if s.provider == nil {
		return AdmissionDecision{}, coded(http.StatusServiceUnavailable, "livekit_not_configured", "LiveKit chưa được cấu hình trên server")
	}
	sess, err := s.q.GetOpenConferenceSession(ctx, dec.Meeting.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdmissionDecision{}, coded(http.StatusConflict, "meeting_not_started", "cuộc họp chưa bắt đầu")
	}
	if err != nil {
		return AdmissionDecision{}, err
	}
	if !conferenceSessionReady(sess) {
		return AdmissionDecision{
			Decision:            DecisionWaitingForProvider,
			Reason:              "PROVIDER_NOT_READY",
			Meeting:             dec.Meeting,
			Participant:         dec.Participant,
			ConferenceSessionID: sess.ID,
		}, nil
	}
	perms := meetings.MediaPermissionsForRole(dec.Participant.Role)
	cred, err := s.provider.IssueJoinCredential(ctx, meetings.IssueJoinCredentialRequest{
		RoomName: sess.ProviderRoomName, Identity: meetings.IdentityForParticipant(dec.Participant.ID),
		DisplayName: dec.Participant.DisplayNameSnapshot, TTL: s.rt.TokenTTL,
		CanSubscribe: perms.CanSubscribe, CanPublish: perms.CanPublish, CanPublishData: perms.CanPublishData,
	})
	if err != nil {
		return AdmissionDecision{}, coded(http.StatusServiceUnavailable, "provider_unavailable", "không cấp được thông tin vào phòng")
	}
	if cred.ServerURL == "" {
		cred.ServerURL = s.rt.LiveKitURL
	}
	dec.ConferenceSessionID = sess.ID
	dec.Credential = &cred
	return dec, nil
}

func (s *MeetingService) Evaluate(ctx context.Context, in AdmissionContext) (AdmissionDecision, error) {
	m, err := s.q.GetMeeting(ctx, in.MeetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdmissionDecision{Decision: DecisionDeny, Reason: "MEETING_NOT_FOUND"}, ErrNotFound
	}
	if err != nil {
		return AdmissionDecision{}, err
	}
	if in.UserID != "" {
		if _, err := s.ws.RequireMember(ctx, m.WorkspaceID, in.UserID); err != nil && in.InviteLinkID == "" {
			return AdmissionDecision{Decision: DecisionDeny, Reason: "FORBIDDEN", Meeting: m}, err
		}
	}
	if m.Status == MeetingEnded {
		return AdmissionDecision{Decision: DecisionDeny, Reason: "MEETING_ENDED", Meeting: m}, coded(http.StatusForbidden, "meeting_ended", "cuộc họp đã kết thúc")
	}
	if m.Status == MeetingCanceled {
		return AdmissionDecision{Decision: DecisionDeny, Reason: "MEETING_CANCELED", Meeting: m}, coded(http.StatusForbidden, "meeting_canceled", "cuộc họp đã bị huỷ")
	}
	if meetingPastScheduledEnd(m, time.Now().UTC()) {
		return AdmissionDecision{Decision: DecisionDeny, Reason: "MEETING_PAST_SCHEDULED_END", Meeting: m}, errMeetingPastScheduledEnd()
	}

	if in.InviteLinkID != "" {
		return s.evaluateInviteLink(ctx, m, in)
	}

	p, perr := s.lookupPrincipal(ctx, m.ID, in)
	if perr == nil && p.Status == ParticipantRemoved {
		return AdmissionDecision{Decision: DecisionDeny, Reason: "PARTICIPANT_REMOVED", Meeting: m, Participant: p},
			coded(http.StatusForbidden, "participant_removed", "bạn đã bị gỡ khỏi cuộc họp")
	}

	if in.UserID != "" && in.UserID == m.HostUserID {
		return s.decisionForStatus(m, p, "HOST")
	}

	if perr == nil {
		grants, gerr := s.q.ListActiveGrantsForParticipant(ctx, p.ID)
		if gerr == nil && len(grants) > 0 {
			return s.decisionForStatus(m, p, "GRANT")
		}
	}

	if m.AllowJoinRequest && in.UserID != "" {
		jr, err := s.ensureJoinRequest(ctx, m, in)
		if err != nil {
			return AdmissionDecision{}, err
		}
		return AdmissionDecision{Decision: DecisionWaitingApproval, Reason: "JOIN_REQUEST_PENDING", Meeting: m, JoinRequestID: jr.ID}, nil
	}
	return AdmissionDecision{Decision: DecisionDeny, Reason: "ACCESS_GRANT_NOT_FOUND", Meeting: m},
		coded(http.StatusForbidden, "access_grant_not_found", "không có quyền vào cuộc họp")
}

func (s *MeetingService) decisionForStatus(m db.Meeting, p db.MeetingParticipant, _ string) (AdmissionDecision, error) {
	if m.Status == MeetingScheduled {
		return AdmissionDecision{Decision: DecisionWaitingForHost, Reason: "MEETING_NOT_STARTED", Meeting: m, Participant: p}, nil
	}
	return AdmissionDecision{Decision: DecisionAdmit, Meeting: m, Participant: p}, nil
}

func conferenceSessionReady(sess db.MeetingConferenceSession) bool {
	if sess.ProviderSyncStatus != "SYNCED" {
		return false
	}
	switch sess.Status {
	case "READY", "ACTIVE":
		return true
	default:
		return false
	}
}

func (s *MeetingService) lookupPrincipal(ctx context.Context, meetingID string, in AdmissionContext) (db.MeetingParticipant, error) {
	if in.UserID != "" {
		return s.q.GetUserParticipantAnyStatus(ctx, db.GetUserParticipantAnyStatusParams{MeetingID: meetingID, UserID: strText(in.UserID)})
	}
	if in.GuestID != "" {
		return s.q.GetActiveGuestParticipant(ctx, db.GetActiveGuestParticipantParams{MeetingID: meetingID, GuestID: strText(in.GuestID)})
	}
	return db.MeetingParticipant{}, pgx.ErrNoRows
}

func (s *MeetingService) evaluateInviteLink(ctx context.Context, m db.Meeting, in AdmissionContext) (AdmissionDecision, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AdmissionDecision{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	link, err := s.verifyInviteLink(ctx, q, in.InviteLinkID, in.InviteSecret)
	if err != nil {
		return AdmissionDecision{}, err
	}
	if link.MeetingID != m.ID {
		return AdmissionDecision{}, coded(http.StatusNotFound, "invite_link_invalid", "liên kết không hợp lệ")
	}
	p, perr := s.lookupPrincipal(ctx, m.ID, in)
	if perr == nil && p.Status == ParticipantRemoved {
		return AdmissionDecision{Decision: DecisionDeny, Reason: "PARTICIPANT_REMOVED", Meeting: m},
			coded(http.StatusForbidden, "participant_removed", "bạn đã bị gỡ khỏi cuộc họp")
	}
	if link.AccessMode == LinkRequestApproval {
		jr, err := s.ensureJoinRequestTx(ctx, q, m, in, link.ID)
		if err != nil {
			return AdmissionDecision{}, err
		}
		s.record(ctx, q, m, joinActor(in), "join_request.created",
			meetingRelatedPayload(m, map[string]string{"join_request_id": jr.ID}), nil)
		if err := tx.Commit(ctx); err != nil {
			return AdmissionDecision{}, err
		}
		return AdmissionDecision{Decision: DecisionWaitingApproval, Reason: "JOIN_REQUEST_PENDING", Meeting: m, JoinRequestID: jr.ID}, nil
	}
	if errors.Is(perr, pgx.ErrNoRows) {
		if _, err := q.ConsumeInviteLinkUse(ctx, link.ID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return AdmissionDecision{}, coded(http.StatusForbidden, "invite_link_limit_reached", "liên kết đã hết lượt")
			}
			return AdmissionDecision{}, err
		}
		p, err = s.materializeFromLink(ctx, q, m, in, link.ID)
		if err != nil {
			return AdmissionDecision{}, err
		}
		_ = s.writeAudit(ctx, q, m.ID, "INVITE_LINK_USED", actorID(in), "", link.ID, "{}")
	}
	if err := tx.Commit(ctx); err != nil {
		return AdmissionDecision{}, err
	}
	return s.decisionForStatus(m, p, "LINK")
}

func actorID(in AdmissionContext) string {
	if in.UserID != "" {
		return in.UserID
	}
	return in.GuestID
}

func (s *MeetingService) materializeFromLink(ctx context.Context, q *db.Queries, m db.Meeting, in AdmissionContext, linkID string) (db.MeetingParticipant, error) {
	params := db.CreateMeetingParticipantParams{
		ID: util.NewID(), MeetingID: m.ID, Role: RoleAttendee, SourceType: GrantInviteLink,
		SourceID: strText(linkID), AddedBy: actorID(in), DisplayNameSnapshot: in.DisplayName,
	}
	if in.UserID != "" {
		u, err := q.GetUserByID(ctx, in.UserID)
		if err != nil {
			return db.MeetingParticipant{}, err
		}
		params.PrincipalType = PrincipalUser
		params.UserID = strText(in.UserID)
		params.DisplayNameSnapshot = u.DisplayName
		params.EmailSnapshot = strText(u.Email)
	} else {
		if in.GuestID == "" {
			g, err := q.CreateMeetingGuest(ctx, util.NewID())
			if err != nil {
				return db.MeetingParticipant{}, err
			}
			in.GuestID = g.ID
		}
		params.PrincipalType = PrincipalGuest
		params.GuestID = strText(in.GuestID)
	}
	p, err := q.CreateMeetingParticipant(ctx, params)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	_, err = q.CreateAccessGrant(ctx, db.CreateAccessGrantParams{
		ID: util.NewID(), MeetingID: m.ID, ParticipantID: p.ID,
		SourceType: GrantInviteLink, SourceID: strText(linkID), GrantedBy: actorID(in),
	})
	return p, err
}

func (s *MeetingService) ensureJoinRequest(ctx context.Context, m db.Meeting, in AdmissionContext) (db.MeetingJoinRequest, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingJoinRequest{}, err
	}
	defer tx.Rollback(ctx)
	jr, err := s.ensureJoinRequestTx(ctx, s.q.WithTx(tx), m, in, in.InviteLinkID)
	if err != nil {
		return db.MeetingJoinRequest{}, err
	}
	s.record(ctx, s.q.WithTx(tx), m, joinActor(in), "join_request.created",
		meetingRelatedPayload(m, map[string]string{"join_request_id": jr.ID}), nil)
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingJoinRequest{}, err
	}
	return jr, nil
}

func (s *MeetingService) ensureJoinRequestTx(ctx context.Context, q *db.Queries, m db.Meeting, in AdmissionContext, linkID string) (db.MeetingJoinRequest, error) {
	if in.UserID != "" {
		jr, err := q.GetPendingJoinRequestForUser(ctx, db.GetPendingJoinRequestForUserParams{MeetingID: m.ID, RequesterUserID: strText(in.UserID)})
		if err == nil {
			return jr, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return db.MeetingJoinRequest{}, err
		}
	} else if in.GuestID != "" {
		jr, err := q.GetPendingJoinRequestForGuest(ctx, db.GetPendingJoinRequestForGuestParams{MeetingID: m.ID, RequesterGuestID: strText(in.GuestID)})
		if err == nil {
			return jr, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return db.MeetingJoinRequest{}, err
		}
	}
	jr, err := q.CreateJoinRequest(ctx, db.CreateJoinRequestParams{
		ID: util.NewID(), MeetingID: m.ID, RequesterUserID: strText(in.UserID),
		RequesterGuestID: strText(in.GuestID), DisplayNameSnapshot: in.DisplayName,
		InviteLinkID: strText(linkID), ExpiresAt: pgtype.Timestamptz{},
	})
	if err != nil {
		return db.MeetingJoinRequest{}, err
	}
	_ = s.writeAudit(ctx, q, m.ID, "JOIN_REQUESTED", actorID(in), "", jr.ID, "{}")
	return jr, nil
}

func (s *MeetingService) RequestJoin(ctx context.Context, in AdmissionContext) (db.MeetingJoinRequest, error) {
	m, err := s.q.GetMeeting(ctx, in.MeetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingJoinRequest{}, ErrNotFound
	}
	if err != nil {
		return db.MeetingJoinRequest{}, err
	}
	if in.UserID != "" {
		if _, err := s.ws.RequireMember(ctx, m.WorkspaceID, in.UserID); err != nil {
			return db.MeetingJoinRequest{}, err
		}
	}
	if !m.AllowJoinRequest {
		return db.MeetingJoinRequest{}, ErrForbidden
	}
	if meetingPastScheduledEnd(m, time.Now().UTC()) {
		return db.MeetingJoinRequest{}, errMeetingPastScheduledEnd()
	}
	return s.ensureJoinRequest(ctx, m, in)
}

func (s *MeetingService) ListJoinRequests(ctx context.Context, userID, meetingID string) ([]db.MeetingJoinRequest, error) {
	if _, err := s.requireHostOrAdmin(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListJoinRequests(ctx, meetingID)
}

func (s *MeetingService) ApproveJoinRequest(ctx context.Context, actorID, requestID string) error {
	jr, err := s.q.GetJoinRequest(ctx, requestID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	m, err := s.requireHostOrAdmin(ctx, actorID, jr.MeetingID)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	decided, err := q.DecideJoinRequest(ctx, db.DecideJoinRequestParams{
		ID: requestID, Status: JoinApproved, ReviewedBy: strText(actorID),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return coded(http.StatusConflict, "join_request_already_decided", "yêu cầu đã được xử lý")
	}
	if err != nil {
		return err
	}
	var p db.MeetingParticipant
	if decided.RequesterUserID.Valid {
		existing, eerr := q.GetUserParticipantAnyStatus(ctx, db.GetUserParticipantAnyStatusParams{
			MeetingID: m.ID, UserID: decided.RequesterUserID,
		})
		if eerr == nil && existing.Status == ParticipantRemoved {
			return coded(http.StatusConflict, "participant_removed", "không tự khôi phục người đã bị gỡ")
		}
		if eerr == nil && existing.Status == ParticipantActive {
			p = existing
		} else {
			u, uerr := q.GetUserByID(ctx, decided.RequesterUserID.String)
			if uerr != nil {
				return uerr
			}
			p, err = q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
				ID: util.NewID(), MeetingID: m.ID, PrincipalType: PrincipalUser,
				UserID: decided.RequesterUserID, DisplayNameSnapshot: u.DisplayName,
				EmailSnapshot: strText(u.Email), Role: RoleAttendee, SourceType: GrantJoinApproval,
				SourceID: strText(requestID), AddedBy: actorID,
			})
			if err != nil {
				return err
			}
		}
	} else {
		p, err = q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
			ID: util.NewID(), MeetingID: m.ID, PrincipalType: PrincipalGuest,
			GuestID: decided.RequesterGuestID, DisplayNameSnapshot: decided.DisplayNameSnapshot,
			Role: RoleAttendee, SourceType: GrantJoinApproval, SourceID: strText(requestID), AddedBy: actorID,
		})
		if err != nil {
			return err
		}
	}
	_, err = q.CreateAccessGrant(ctx, db.CreateAccessGrantParams{
		ID: util.NewID(), MeetingID: m.ID, ParticipantID: p.ID,
		SourceType: GrantJoinApproval, SourceID: strText(requestID), GrantedBy: actorID,
	})
	if err != nil {
		return err
	}
	_ = s.writeAudit(ctx, q, m.ID, "JOIN_REQUEST_APPROVED", actorID, JoinPending, JoinApproved, "{}")
	s.record(ctx, q, m, audit.User(actorID), "join_request.approved",
		meetingRelatedPayload(m, map[string]string{"join_request_id": requestID}),
		audit.Diff(map[string]any{"status": JoinPending}, map[string]any{"status": JoinApproved}))
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

func (s *MeetingService) RejectJoinRequest(ctx context.Context, actorID, requestID, reason string) error {
	jr, err := s.q.GetJoinRequest(ctx, requestID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	m, err := s.requireHostOrAdmin(ctx, actorID, jr.MeetingID)
	if err != nil {
		return err
	}
	_, err = s.q.DecideJoinRequest(ctx, db.DecideJoinRequestParams{
		ID: requestID, Status: JoinRejected, ReviewedBy: strText(actorID), DecisionReason: strText(reason),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return coded(http.StatusConflict, "join_request_already_decided", "yêu cầu đã được xử lý")
	}
	if err != nil {
		return err
	}
	_ = s.writeAudit(ctx, s.q, m.ID, "JOIN_REQUEST_REJECTED", actorID, JoinPending, JoinRejected, "{}")
	s.record(ctx, s.q, m, audit.User(actorID), "join_request.rejected",
		meetingRelatedPayload(m, map[string]string{"join_request_id": requestID}),
		audit.Diff(map[string]any{"status": JoinPending}, map[string]any{"status": JoinRejected}))
	return nil
}

func (s *MeetingService) CancelJoinRequest(ctx context.Context, in AdmissionContext, requestID string) error {
	jr, err := s.q.GetJoinRequest(ctx, requestID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if jr.RequesterUserID.Valid {
		if in.UserID == "" || jr.RequesterUserID.String != in.UserID {
			return ErrForbidden
		}
	} else if jr.RequesterGuestID.Valid {
		if in.GuestID == "" || jr.RequesterGuestID.String != in.GuestID {
			return ErrForbidden
		}
	} else {
		return ErrForbidden
	}
	_, err = s.q.CancelJoinRequest(ctx, requestID)
	if errors.Is(err, pgx.ErrNoRows) {
		return coded(http.StatusConflict, "join_request_already_decided", "yêu cầu đã được xử lý")
	}
	if err != nil {
		return err
	}
	m, _ := s.q.GetMeeting(ctx, jr.MeetingID)
	_ = s.writeAudit(ctx, s.q, jr.MeetingID, "JOIN_REQUEST_CANCELED", actorID(in), JoinPending, JoinCanceled, "{}")
	s.record(ctx, s.q, m, joinActor(in), "join_request.canceled",
		meetingRelatedPayload(m, map[string]string{"join_request_id": requestID}),
		audit.Diff(map[string]any{"status": JoinPending}, map[string]any{"status": JoinCanceled}))
	return nil
}

// joinActor names who asked to join. A guest has no user row, so the audit
// actor is the system with the guest id in the event payload rather than a
// human id that does not exist.
func joinActor(in AdmissionContext) audit.Actor {
	if in.UserID != "" {
		return audit.User(in.UserID)
	}
	return audit.System("meeting-guest")
}
