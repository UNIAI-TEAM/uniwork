package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (s *MeetingService) CreateInstant(ctx context.Context, userID, workspaceID string, title string) (db.Meeting, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return db.Meeting{}, err
	}
	if title == "" {
		title = "Cuộc họp tức thì"
	}
	now := time.Now().UTC()
	id := util.NewID()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Meeting{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	m, err := q.CreateMeeting(ctx, db.CreateMeetingParams{
		ID: id, WorkspaceID: workspaceID, Title: title, Description: "",
		StartsAt: pgtype.Timestamptz{Time: now, Valid: true},
		EndsAt:   pgtype.Timestamptz{Time: now.Add(time.Hour), Valid: true},
		RoomName: meetings.RoomNameForMeeting(id), CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
		Status: MeetingScheduled, MeetingType: MeetingTypeInstant,
		HostUserID: userID, Timezone: "UTC", AllowJoinRequest: true,
	})
	if err != nil {
		return db.Meeting{}, err
	}
	if _, err := s.addHostParticipant(ctx, q, m, userID); err != nil {
		return db.Meeting{}, err
	}
	if err := s.writeAudit(ctx, q, m.ID, "MEETING_CREATED", userID, "", MeetingScheduled, `{"meeting_type":"INSTANT"}`); err != nil {
		return db.Meeting{}, err
	}
	sess, err := q.CreateConferenceSession(ctx, db.CreateConferenceSessionParams{
		ID: util.NewID(), MeetingID: m.ID, ProviderKey: s.rt.ProviderKey,
		ProviderRoomName: meetings.RoomNameForMeeting(m.ID),
	})
	if err != nil {
		return db.Meeting{}, err
	}
	started, err := q.StartMeeting(ctx, db.StartMeetingParams{UpdatedBy: strText(userID), ID: m.ID, Version: m.Version})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, errInvalidState()
	}
	if err != nil {
		return db.Meeting{}, err
	}
	if err := s.writeAudit(ctx, q, m.ID, "MEETING_STARTED", userID, MeetingScheduled, MeetingInProgress, "{}"); err != nil {
		return db.Meeting{}, err
	}
	_ = s.writeAudit(ctx, q, m.ID, "CONFERENCE_SESSION_CREATED", userID, "", sess.Status, "{}")
	if err := s.enqueue(ctx, q, workspaceID, "provider.ensure_session", map[string]string{
		"meeting_id": m.ID, "session_id": sess.ID, "room_name": sess.ProviderRoomName,
	}); err != nil {
		return db.Meeting{}, err
	}
	s.record(ctx, q, m, audit.User(userID), "meeting.created", nil, audit.Diff(nil, map[string]any{"meeting_type": MeetingTypeInstant, "title": m.Title}))
	s.record(ctx, q, started, audit.User(userID), "meeting.started", nil,
		audit.Diff(map[string]any{"status": MeetingScheduled}, map[string]any{"status": MeetingInProgress}))
	if err := tx.Commit(ctx); err != nil {
		return db.Meeting{}, err
	}
	s.ensureProviderSession(ctx, sess)
	return started, nil
}

func (s *MeetingService) Start(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.Status != MeetingScheduled {
		return db.Meeting{}, errInvalidState()
	}
	if meetingPastScheduledEnd(m, time.Now().UTC()) {
		return db.Meeting{}, errMeetingPastScheduledEnd()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Meeting{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	sess, err := q.GetOpenConferenceSession(ctx, m.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		sess, err = q.CreateConferenceSession(ctx, db.CreateConferenceSessionParams{
			ID: util.NewID(), MeetingID: m.ID, ProviderKey: s.rt.ProviderKey,
			ProviderRoomName: meetings.RoomNameForMeeting(m.ID),
		})
	}
	if err != nil {
		return db.Meeting{}, err
	}
	started, err := q.StartMeeting(ctx, db.StartMeetingParams{UpdatedBy: strText(userID), ID: m.ID, Version: m.Version})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, errInvalidState()
	}
	if err != nil {
		return db.Meeting{}, err
	}
	if err := s.writeAudit(ctx, q, m.ID, "MEETING_STARTED", userID, MeetingScheduled, MeetingInProgress, "{}"); err != nil {
		return db.Meeting{}, err
	}
	if err := s.enqueue(ctx, q, m.WorkspaceID, "provider.ensure_session", map[string]string{
		"meeting_id": m.ID, "session_id": sess.ID, "room_name": sess.ProviderRoomName,
	}); err != nil {
		return db.Meeting{}, err
	}
	s.record(ctx, q, started, audit.User(userID), "meeting.started", nil,
		audit.Diff(map[string]any{"status": MeetingScheduled}, map[string]any{"status": MeetingInProgress}))
	if err := tx.Commit(ctx); err != nil {
		return db.Meeting{}, err
	}
	s.count("started")
	s.ensureProviderSession(ctx, sess)
	return started, nil
}

func (s *MeetingService) ensureProviderSession(ctx context.Context, sess db.MeetingConferenceSession) {
	if s.provider == nil {
		return
	}
	ref, err := s.provider.EnsureSession(ctx, meetings.EnsureSessionRequest{
		MeetingID: sess.MeetingID, RoomName: sess.ProviderRoomName, EmptyTimeout: s.rt.EmptyTimeout,
	})
	s.recordConferenceEnsure(ctx, sess.ID, ref, err)
}

func (s *MeetingService) End(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	return s.endMeeting(ctx, m, userID, "MEETING_ENDED")
}

// endMeeting is the IN_PROGRESS → ENDED transition shared by End (host) and
// AutoEndOverdue (system). eventType names the audit row.
func (s *MeetingService) endMeeting(ctx context.Context, m db.Meeting, actorID, eventType string) (db.Meeting, error) {
	// AutoEndOverdue passes no actor: the scheduler ended the meeting, and the
	// audit row says so rather than blaming the last host.
	actor := audit.User(actorID)
	if actorID == "" {
		actor = audit.System("meeting-auto-end")
	}
	if m.Status != MeetingInProgress {
		return db.Meeting{}, errInvalidState()
	}
	// Best effort: a recording that fails to stop must not keep the meeting open.
	_, _ = s.stopActiveRecording(ctx, m, actorID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Meeting{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	ended, err := q.EndMeeting(ctx, db.EndMeetingParams{UpdatedBy: strText(actorID), ID: m.ID, Version: m.Version})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, errInvalidState()
	}
	if err != nil {
		return db.Meeting{}, err
	}
	_ = q.RevokeGrantsForMeeting(ctx, db.RevokeGrantsForMeetingParams{MeetingID: m.ID, RevokedBy: strText(actorID), RevokeReason: strText("meeting_ended")})
	_ = q.ExpirePendingJoinRequests(ctx, m.ID)
	if err := s.writeAudit(ctx, q, m.ID, eventType, actorID, MeetingInProgress, MeetingEnded, "{}"); err != nil {
		return db.Meeting{}, err
	}
	sess, serr := q.GetOpenConferenceSession(ctx, m.ID)
	if serr == nil {
		_, _ = q.EndConferenceSession(ctx, sess.ID)
		_ = s.enqueue(ctx, q, m.WorkspaceID, "provider.end_session", map[string]string{
			"meeting_id": m.ID, "room_name": sess.ProviderRoomName, "session_id": sess.ID,
		})
		_ = s.writeAudit(ctx, q, m.ID, "CONFERENCE_SESSION_ENDED", actorID, sess.Status, "ENDED", "{}")
	}
	s.record(ctx, q, ended, actor, "meeting.ended", nil,
		audit.Diff(map[string]any{"status": MeetingInProgress}, map[string]any{"status": MeetingEnded}))
	if err := tx.Commit(ctx); err != nil {
		return db.Meeting{}, err
	}
	s.count("ended")
	return ended, nil
}

func (s *MeetingService) Cancel(ctx context.Context, userID, meetingID, reason string) error {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return err
	}
	if m.Status != MeetingScheduled {
		return errInvalidState()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	canceled, err := q.CancelMeeting(ctx, db.CancelMeetingParams{
		CanceledBy: strText(userID), CancelReason: strText(reason), ID: m.ID, Version: m.Version,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return errInvalidState()
	}
	if err != nil {
		return err
	}
	_ = q.ExpirePendingJoinRequests(ctx, m.ID)
	if err := s.writeAudit(ctx, q, m.ID, "MEETING_CANCELED", userID, MeetingScheduled, MeetingCanceled, "{}"); err != nil {
		return err
	}
	if sess, serr := q.GetOpenConferenceSession(ctx, m.ID); serr == nil {
		_, _ = q.EndConferenceSession(ctx, sess.ID)
		_ = s.enqueue(ctx, q, m.WorkspaceID, "provider.end_session", map[string]string{
			"meeting_id": m.ID, "room_name": sess.ProviderRoomName, "session_id": sess.ID,
		})
	}
	// Two topics for one command: the list view treats a cancellation as a
	// removal, and both names are in the catalogue the client switches on.
	changes := audit.Diff(map[string]any{"status": MeetingScheduled}, map[string]any{"status": MeetingCanceled})
	s.record(ctx, q, canceled, audit.User(userID), "meeting.canceled", nil, changes)
	s.record(ctx, q, canceled, audit.User(userID), "meeting.deleted", nil, changes)
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

func (s *MeetingService) TransferHost(ctx context.Context, userID, meetingID, newHostUserID string) (db.Meeting, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.Status != MeetingScheduled && m.Status != MeetingInProgress {
		return db.Meeting{}, errInvalidState()
	}
	if _, err := s.ws.RequireMember(ctx, m.WorkspaceID, newHostUserID); err != nil {
		return db.Meeting{}, coded(403, "invalid_host_transferee", "người nhận phải là thành viên workspace")
	}
	p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: meetingID, UserID: strText(newHostUserID)})
	if errors.Is(err, pgx.ErrNoRows) || p.PrincipalType != PrincipalUser {
		return db.Meeting{}, coded(409, "invalid_host_transferee", "người nhận phải là người tham dự đang hoạt động")
	}
	if err != nil {
		return db.Meeting{}, err
	}
	up, err := s.q.TransferMeetingHost(ctx, db.TransferMeetingHostParams{
		HostUserID: newHostUserID, UpdatedBy: strText(userID), ID: m.ID, Version: m.Version,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, ErrConflict
	}
	if err != nil {
		return db.Meeting{}, err
	}
	payload, _ := json.Marshal(map[string]string{"old_host_user_id": m.HostUserID, "new_host_user_id": newHostUserID})
	_ = s.writeAudit(ctx, s.q, m.ID, "HOST_TRANSFERRED", userID, m.HostUserID, newHostUserID, string(payload))
	s.record(ctx, s.q, up, audit.User(userID), "host.transferred",
		meetingRelatedPayload(up, map[string]string{"old_host_user_id": m.HostUserID, "new_host_user_id": newHostUserID}),
		audit.Diff(map[string]any{"host_user_id": m.HostUserID}, map[string]any{"host_user_id": newHostUserID}))
	return up, nil
}
