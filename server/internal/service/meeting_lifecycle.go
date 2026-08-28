package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

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
		RoomName: meetings.RoomNameForMeeting(id), CreatedBy: userID,
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
	if err := tx.Commit(ctx); err != nil {
		return db.Meeting{}, err
	}
	s.pub.Publish(ctx, workspaceID, Event{Type: "meeting.created", Payload: map[string]string{"meeting_id": id}})
	s.pub.Publish(ctx, workspaceID, Event{Type: "meeting.started", Payload: map[string]string{"meeting_id": id}})
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
	if err := tx.Commit(ctx); err != nil {
		return db.Meeting{}, err
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "meeting.started", Payload: map[string]string{"meeting_id": m.ID}})
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
	sync := "SYNCED"
	sid := strText(ref.RoomSID)
	st := strText("READY")
	if err != nil {
		sync = "FAILED"
		st = pgtype.Text{}
	}
	_, _ = s.q.UpdateConferenceSessionStatus(ctx, db.UpdateConferenceSessionStatusParams{
		ID: sess.ID, Status: st, ProviderSyncStatus: strText(sync), ProviderRoomSid: sid,
	})
}

func (s *MeetingService) End(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.Status != MeetingInProgress {
		return db.Meeting{}, errInvalidState()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Meeting{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	ended, err := q.EndMeeting(ctx, db.EndMeetingParams{UpdatedBy: strText(userID), ID: m.ID, Version: m.Version})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, errInvalidState()
	}
	if err != nil {
		return db.Meeting{}, err
	}
	_ = q.RevokeGrantsForMeeting(ctx, db.RevokeGrantsForMeetingParams{MeetingID: m.ID, RevokedBy: strText(userID), RevokeReason: strText("meeting_ended")})
	_ = q.ExpirePendingJoinRequests(ctx, m.ID)
	if err := s.writeAudit(ctx, q, m.ID, "MEETING_ENDED", userID, MeetingInProgress, MeetingEnded, "{}"); err != nil {
		return db.Meeting{}, err
	}
	sess, serr := q.GetOpenConferenceSession(ctx, m.ID)
	if serr == nil {
		_, _ = q.EndConferenceSession(ctx, sess.ID)
		_ = s.enqueue(ctx, q, m.WorkspaceID, "provider.end_session", map[string]string{
			"meeting_id": m.ID, "room_name": sess.ProviderRoomName, "session_id": sess.ID,
		})
		_ = s.writeAudit(ctx, q, m.ID, "CONFERENCE_SESSION_ENDED", userID, sess.Status, "ENDED", "{}")
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Meeting{}, err
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "meeting.ended", Payload: map[string]string{"meeting_id": m.ID}})
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
	_, err = q.CancelMeeting(ctx, db.CancelMeetingParams{
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
		_ = s.enqueue(ctx, q, m.WorkspaceID, "provider.end_session", map[string]string{
			"meeting_id": m.ID, "room_name": sess.ProviderRoomName,
		})
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "meeting.canceled", Payload: map[string]string{"meeting_id": m.ID}})
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "meeting.deleted", Payload: map[string]string{"meeting_id": m.ID}})
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
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "host.transferred", Payload: map[string]string{
		"meeting_id": m.ID, "old_host_user_id": m.HostUserID, "new_host_user_id": newHostUserID,
	}})
	return up, nil
}
