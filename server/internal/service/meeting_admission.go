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
	// RequestAgain files a new join request even though the requester's last
	// one was rejected; automatic re-joins leave it false so a rejection sticks.
	RequestAgain bool
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
		s.requeueIdleProviderSession(ctx, dec.Meeting, sess)
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
	// Standing first, before anything about the meeting is answered: a member
	// of its workspace, the holder of one of its own invite links, or a
	// principal it already knows. The status checks below would otherwise tell
	// anyone holding an id - another organization included - whether the
	// meeting exists, ended or was canceled (ADR 0008 isolation matrix).
	member := false
	if in.UserID != "" {
		_, err := s.ws.RequireMember(ctx, m.WorkspaceID, in.UserID)
		if err != nil && in.InviteLinkID == "" {
			return AdmissionDecision{Decision: DecisionDeny, Reason: "FORBIDDEN", Meeting: m}, err
		}
		member = err == nil
	}
	if !member {
		if in.InviteLinkID != "" {
			link, err := s.verifyInviteLink(ctx, s.q, in.InviteLinkID, in.InviteSecret)
			if err != nil {
				return AdmissionDecision{Decision: DecisionDeny, Reason: "INVITE_LINK_INVALID"}, err
			}
			if link.MeetingID != m.ID {
				return AdmissionDecision{Decision: DecisionDeny, Reason: "INVITE_LINK_INVALID"},
					coded(http.StatusNotFound, "invite_link_invalid", "liên kết không hợp lệ")
			}
		} else if _, err := s.lookupPrincipal(ctx, m.ID, in); err != nil {
			return AdmissionDecision{Decision: DecisionDeny, Reason: "MEETING_NOT_FOUND"}, ErrNotFound
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
		jr, err := s.ensureJoinRequest(ctx, m, in, in.InviteLinkID)
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

// requeueIdleProviderSession re-queues the room of a session the provider
// closed behind UniWork's back — LiveKit's empty timeout is the usual cause,
// and nobody can join a room that no longer exists. The outbox worker owns the
// provider call, so join stays off the provider's critical path; the claim in
// MarkConferenceSessionResyncing is what keeps the lobby's retries from
// queueing the same instruction over and over. ReconcileProviderDesync stays
// the backstop for the case where the queued row dies.
func (s *MeetingService) requeueIdleProviderSession(ctx context.Context, m db.Meeting, sess db.MeetingConferenceSession) {
	if sess.Status != "IDLE" || sess.ProviderSyncStatus != "SYNCED" {
		return
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := q.MarkConferenceSessionResyncing(ctx, sess.ID); err != nil {
		return
	}
	if err := s.enqueue(ctx, q, m.WorkspaceID, "provider.ensure_session", map[string]string{
		"meeting_id": m.ID, "session_id": sess.ID, "room_name": sess.ProviderRoomName,
	}); err != nil {
		return
	}
	_ = s.writeAudit(ctx, q, m, "PROVIDER_ROOM_IDLE_DESYNC", "", m.Status, "IDLE", "{}")
	if err := tx.Commit(ctx); err != nil {
		return
	}
	if s.metrics != nil {
		s.metrics.IncProviderDesync()
	}
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

// lookupPrincipal returns the viewer's latest participant row in any status,
// so callers can refuse a removed one. Guests included: an active-only lookup
// let a removed guest open the same link again and get a fresh row (UNI-883).
func (s *MeetingService) lookupPrincipal(ctx context.Context, meetingID string, in AdmissionContext) (db.MeetingParticipant, error) {
	if in.UserID != "" {
		return s.q.GetUserParticipantAnyStatus(ctx, db.GetUserParticipantAnyStatusParams{MeetingID: meetingID, UserID: strText(in.UserID)})
	}
	if in.GuestID != "" {
		return s.q.GetGuestParticipantAnyStatus(ctx, db.GetGuestParticipantAnyStatusParams{MeetingID: meetingID, GuestID: strText(in.GuestID)})
	}
	return db.MeetingParticipant{}, pgx.ErrNoRows
}

// evaluateInviteLink answers a join through an invite link. Every read that
// decides the answer runs on the pool before any transaction opens, and the
// transaction - opened only to file a join request or to materialize a
// first-time principal - reads through its own q. A request therefore never
// holds one connection while waiting for another: with that pattern, as many
// concurrent link joins as the pool has connections would each hold one and
// wait forever for a second (token refreshes take this path too).
func (s *MeetingService) evaluateInviteLink(ctx context.Context, m db.Meeting, in AdmissionContext) (AdmissionDecision, error) {
	link, err := s.verifyInviteLink(ctx, s.q, in.InviteLinkID, in.InviteSecret)
	if err != nil {
		return AdmissionDecision{}, err
	}
	if link.MeetingID != m.ID {
		return AdmissionDecision{}, coded(http.StatusNotFound, "invite_link_invalid", "liên kết không hợp lệ")
	}
	p, perr := s.lookupPrincipal(ctx, m.ID, in)
	if perr != nil && !errors.Is(perr, pgx.ErrNoRows) {
		return AdmissionDecision{}, perr
	}
	if perr == nil && p.Status == ParticipantRemoved {
		return AdmissionDecision{Decision: DecisionDeny, Reason: "PARTICIPANT_REMOVED", Meeting: m},
			coded(http.StatusForbidden, "participant_removed", "bạn đã bị gỡ khỏi cuộc họp")
	}
	if perr == nil {
		grants, gerr := s.q.ListActiveGrantsForParticipant(ctx, p.ID)
		if gerr == nil && len(grants) > 0 {
			return s.decisionForStatus(m, p, "GRANT")
		}
	}
	if link.AccessMode == LinkRequestApproval {
		jr, err := s.ensureJoinRequest(ctx, m, in, link.ID)
		if err != nil {
			return AdmissionDecision{}, err
		}
		return AdmissionDecision{Decision: DecisionWaitingApproval, Reason: "JOIN_REQUEST_PENDING", Meeting: m, JoinRequestID: jr.ID}, nil
	}
	if perr == nil {
		return s.decisionForStatus(m, p, "LINK")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AdmissionDecision{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	p, err = s.materializeFromLink(ctx, q, m, in, link.ID)
	if err != nil {
		return AdmissionDecision{}, err
	}
	// The use is counted last: the UPDATE locks the link row until commit,
	// and every first-time join through the same link queues on that lock.
	if _, err := q.ConsumeInviteLinkUse(ctx, link.ID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AdmissionDecision{}, coded(http.StatusForbidden, "invite_link_limit_reached", "liên kết đã hết lượt")
		}
		return AdmissionDecision{}, err
	}
	_ = s.writeAudit(ctx, q, m, "INVITE_LINK_USED", actorID(in), "", link.ID, "{}")
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
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, Role: RoleAttendee, SourceType: GrantInviteLink,
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
	if in.UserID != "" {
		if p, err = s.settleAdmittedStanding(ctx, q, m, p); err != nil {
			return db.MeetingParticipant{}, err
		}
	}
	_, err = q.CreateAccessGrant(ctx, db.CreateAccessGrantParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, ParticipantID: p.ID,
		SourceType: GrantInviteLink, SourceID: strText(linkID), GrantedBy: actorID(in),
	})
	return p, err
}

// settleAdmittedStanding makes an account from outside the workspace an
// observer when an invite link or an approved join request brings it in (spec
// D2, update 2026-10-01): it may sit in a formal meeting but is not on a vote's
// roll or counted for quorum until the host makes it a member. A workspace
// member keeps the MEMBER standing the row was created with. Membership is
// decided by the workspace gate, through the caller's transaction.
func (s *MeetingService) settleAdmittedStanding(ctx context.Context, q *db.Queries, m db.Meeting, p db.MeetingParticipant) (db.MeetingParticipant, error) {
	_, err := s.ws.RequireMemberQ(ctx, q, m.WorkspaceID, p.UserID.String)
	var ce CodedError
	switch {
	case err == nil:
		return p, nil
	case errors.Is(err, ErrForbidden), errors.As(err, &ce) && ce.Status == http.StatusForbidden:
		return q.UpdateParticipantDuties(ctx, db.UpdateParticipantDutiesParams{Standing: strText(StandingObserver), ID: p.ID})
	default:
		return db.MeetingParticipant{}, err
	}
}

// ensureJoinRequest returns the requester's PENDING join request, filing one
// when there is none. A lobby retry finds its request on the pool and opens
// no transaction; only the knock that files the request writes anything.
func (s *MeetingService) ensureJoinRequest(ctx context.Context, m db.Meeting, in AdmissionContext, linkID string) (db.MeetingJoinRequest, error) {
	jr, err := pendingJoinRequest(ctx, s.q, m.ID, in)
	if err == nil {
		return jr, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingJoinRequest{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingJoinRequest{}, err
	}
	defer tx.Rollback(ctx)
	jr, err = s.ensureJoinRequestTx(ctx, s.q.WithTx(tx), m, in, linkID)
	if err != nil {
		return db.MeetingJoinRequest{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingJoinRequest{}, err
	}
	return jr, nil
}

// ensureJoinRequestTx files the request inside the caller's transaction and
// records it (timeline row, audit row and join_request.created) only when it
// created one, so a retry that finds its PENDING request writes nothing.
func (s *MeetingService) ensureJoinRequestTx(ctx context.Context, q *db.Queries, m db.Meeting, in AdmissionContext, linkID string) (db.MeetingJoinRequest, error) {
	jr, err := pendingJoinRequest(ctx, q, m.ID, in)
	if err == nil {
		return jr, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingJoinRequest{}, err
	}
	if !in.RequestAgain {
		if err := latestJoinRequestRejected(ctx, q, m.ID, in); err != nil {
			return db.MeetingJoinRequest{}, err
		}
	}
	jr, err = q.CreateJoinRequest(ctx, db.CreateJoinRequestParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, RequesterUserID: strText(in.UserID),
		RequesterGuestID: strText(in.GuestID), DisplayNameSnapshot: in.DisplayName,
		InviteLinkID: strText(linkID), ExpiresAt: pgtype.Timestamptz{},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// A concurrent knock by the same requester filed it first (the insert
		// waited for that commit); its request is the one the host sees.
		return pendingJoinRequest(ctx, q, m.ID, in)
	}
	if err != nil {
		return db.MeetingJoinRequest{}, err
	}
	_ = s.writeAudit(ctx, q, m, "JOIN_REQUESTED", actorID(in), "", jr.ID, "{}")
	s.record(ctx, q, m, joinActor(in), "join_request.created",
		meetingRelatedPayload(m, map[string]string{"join_request_id": jr.ID}), nil)
	return jr, nil
}

// pendingJoinRequest reads the requester's PENDING request through q;
// pgx.ErrNoRows when there is none or no requester to look up.
func pendingJoinRequest(ctx context.Context, q *db.Queries, meetingID string, in AdmissionContext) (db.MeetingJoinRequest, error) {
	switch {
	case in.UserID != "":
		return q.GetPendingJoinRequestForUser(ctx, db.GetPendingJoinRequestForUserParams{MeetingID: meetingID, RequesterUserID: strText(in.UserID)})
	case in.GuestID != "":
		return q.GetPendingJoinRequestForGuest(ctx, db.GetPendingJoinRequestForGuestParams{MeetingID: meetingID, RequesterGuestID: strText(in.GuestID)})
	default:
		return db.MeetingJoinRequest{}, pgx.ErrNoRows
	}
}

func (s *MeetingService) RequestJoin(ctx context.Context, in AdmissionContext) (db.MeetingJoinRequest, error) {
	// A guest knocks through an invite link (Evaluate on POST /join), never by
	// the bare meeting id: the id travels in URLs, and a knock puts a row in
	// the host's queue and admits the knocker to the lobby socket. Only a
	// member of the meeting's workspace may ask without a link.
	if in.UserID == "" {
		return db.MeetingJoinRequest{}, ErrNotFound
	}
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
	in.RequestAgain = true
	return s.ensureJoinRequest(ctx, m, in, in.InviteLinkID)
}

// latestJoinRequestRejected refuses to re-file a request whose last answer was
// a rejection: a lobby retry would otherwise put the requester straight back
// in the host's queue and leave them waiting on a decision already made.
func latestJoinRequestRejected(ctx context.Context, q *db.Queries, meetingID string, in AdmissionContext) error {
	var (
		last db.MeetingJoinRequest
		err  error
	)
	switch {
	case in.UserID != "":
		last, err = q.GetLatestJoinRequestForUser(ctx, db.GetLatestJoinRequestForUserParams{MeetingID: meetingID, RequesterUserID: strText(in.UserID)})
	case in.GuestID != "":
		last, err = q.GetLatestJoinRequestForGuest(ctx, db.GetLatestJoinRequestForGuestParams{MeetingID: meetingID, RequesterGuestID: strText(in.GuestID)})
	default:
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if last.Status == JoinRejected {
		return coded(http.StatusForbidden, "join_request_rejected", "người chủ trì đã từ chối yêu cầu vào phòng")
	}
	return nil
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
				ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, PrincipalType: PrincipalUser,
				UserID: decided.RequesterUserID, DisplayNameSnapshot: u.DisplayName,
				EmailSnapshot: strText(u.Email), Role: RoleAttendee, SourceType: GrantJoinApproval,
				SourceID: strText(requestID), AddedBy: actorID,
			})
			if err != nil {
				return err
			}
			if p, err = s.settleAdmittedStanding(ctx, q, m, p); err != nil {
				return err
			}
		}
	} else {
		existing, eerr := q.GetGuestParticipantAnyStatus(ctx, db.GetGuestParticipantAnyStatusParams{
			MeetingID: m.ID, GuestID: decided.RequesterGuestID,
		})
		if eerr == nil && existing.Status == ParticipantRemoved {
			return coded(http.StatusConflict, "participant_removed", "không tự khôi phục người đã bị gỡ")
		}
		if eerr == nil && existing.Status == ParticipantActive {
			p = existing
		} else {
			p, err = q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
				ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, PrincipalType: PrincipalGuest,
				GuestID: decided.RequesterGuestID, DisplayNameSnapshot: decided.DisplayNameSnapshot,
				Role: RoleAttendee, SourceType: GrantJoinApproval, SourceID: strText(requestID), AddedBy: actorID,
			})
			if err != nil {
				return err
			}
		}
	}
	_, err = q.CreateAccessGrant(ctx, db.CreateAccessGrantParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, ParticipantID: p.ID,
		SourceType: GrantJoinApproval, SourceID: strText(requestID), GrantedBy: actorID,
	})
	if err != nil {
		return err
	}
	_ = s.writeAudit(ctx, q, m, "JOIN_REQUEST_APPROVED", actorID, JoinPending, JoinApproved, "{}")
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
	_ = s.writeAudit(ctx, s.q, m, "JOIN_REQUEST_REJECTED", actorID, JoinPending, JoinRejected, "{}")
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
	// Read before the cancel so the timeline row below has the meeting's
	// organization, and a failed read changes nothing.
	m, err := s.q.GetMeeting(ctx, jr.MeetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	_, err = s.q.CancelJoinRequest(ctx, requestID)
	if errors.Is(err, pgx.ErrNoRows) {
		return coded(http.StatusConflict, "join_request_already_decided", "yêu cầu đã được xử lý")
	}
	if err != nil {
		return err
	}
	_ = s.writeAudit(ctx, s.q, m, "JOIN_REQUEST_CANCELED", actorID(in), JoinPending, JoinCanceled, "{}")
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
