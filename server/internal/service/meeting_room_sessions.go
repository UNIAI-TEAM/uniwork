package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Room sessions (meeting_attendance_sessions) record when someone was in the
// conference room. One person has at most one open session; each one carries
// the provider's connection id (SID) so the join and leave webhooks of a
// reconnect — which LiveKit may deliver in either order — land on the right
// session instead of closing the new connection with the old one's leave.

const (
	leaveReasonReplaced     = "replaced"
	leaveReasonMeetingEnded = "meeting_ended"
)

// participantIDFromIdentity reads the participant id out of a provider
// identity (uw_participant_{id}); "" for anything else.
func participantIDFromIdentity(identity string) string {
	pid, ok := strings.CutPrefix(identity, "uw_participant_")
	if !ok {
		return ""
	}
	return pid
}

func eventTime(ev ProviderNeutralEvent) pgtype.Timestamptz {
	if ev.OccurredAt.IsZero() {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: ev.OccurredAt, Valid: true}
}

// sameConnection: the open session belongs to the connection the event is
// about. A session or an event without a SID (written before SIDs were kept,
// or from a provider that sends none) cannot be told apart, so it is taken as
// the same connection — the behaviour before SIDs.
func sameConnection(open db.MeetingAttendanceSession, ev ProviderNeutralEvent) bool {
	return !open.ProviderParticipantSid.Valid || ev.ParticipantSID == "" ||
		open.ProviderParticipantSid.String == ev.ParticipantSID
}

// olderConnection: the event's connection joined strictly before the open
// session's did, so it is an older connection whose join arrived late (the
// provider's times are whole seconds; a tie is taken as the newer one).
func olderConnection(open db.MeetingAttendanceSession, ev ProviderNeutralEvent) bool {
	return !ev.OccurredAt.IsZero() && open.JoinedAt.Valid && ev.OccurredAt.Before(open.JoinedAt.Time)
}

// roomTx begins a webhook transaction that holds the participant's room
// session lock, so their join and leave webhooks — processed concurrently,
// possibly by several workers — take turns.
func (s *MeetingService) roomTx(ctx context.Context, pid string) (pgx.Tx, *db.Queries, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	q := s.q.WithTx(tx)
	if err := q.LockRoomSessionsOfParticipant(ctx, pid); err != nil {
		_ = tx.Rollback(ctx)
		return nil, nil, err
	}
	return tx, q, nil
}

// roomParticipantJoined opens a room session. Webhooks can arrive in any
// order, so a join opens nothing when:
//   - the meeting is no longer in progress (End closed every session);
//   - its connection (SID) already has a session: a duplicate, or its leave
//     arrived first and was recorded;
//   - it is the same connection as the open session;
//   - it is an older connection than the open one (joined earlier): its time
//     in the room is recorded as a closed session ending when the newer one
//     joined, and the open session stays.
//
// A newer connection of someone whose old one is still open (a reconnect
// whose leave has not arrived) closes the old session as "replaced" first, in
// one transaction, so the one-open-session invariant holds throughout.
// Webhook processing is best effort, as before: the provider event id is
// already recorded, so a retry would be skipped.
func (s *MeetingService) roomParticipantJoined(ctx context.Context, sess db.MeetingConferenceSession, ev ProviderNeutralEvent) error {
	pid := participantIDFromIdentity(ev.Identity)
	if pid == "" {
		return nil
	}
	tx, q, err := s.roomTx(ctx, pid)
	if err != nil {
		return nil
	}
	defer tx.Rollback(ctx)
	// Share lock: End updates the meeting row before it closes the open
	// sessions, so this join either commits before that close or reads ENDED.
	if status, err := q.ShareLockMeetingStatus(ctx, sess.MeetingID); err != nil || status != MeetingInProgress {
		return nil
	}
	if ev.ParticipantSID != "" {
		seen, err := q.AttendanceConnectionSeen(ctx, db.AttendanceConnectionSeenParams{
			MeetingID: sess.MeetingID, ParticipantID: pid, ProviderParticipantSid: strText(ev.ParticipantSID),
		})
		if err != nil {
			return nil
		}
		if seen {
			return s.backdateConnectionJoin(ctx, tx, q, sess, pid, ev)
		}
	}
	var closed *db.MeetingAttendanceSession
	open, err := q.LockOpenAttendance(ctx, pid)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return nil
	case sameConnection(open, ev):
		return nil
	case olderConnection(open, ev):
		past, err := q.InsertClosedAttendanceSession(ctx, db.InsertClosedAttendanceSessionParams{
			ID: util.NewID(), MeetingID: sess.MeetingID, ConferenceSessionID: sess.ID,
			ParticipantID: pid, ProviderParticipantIdentity: ev.Identity,
			JoinedAt: eventTime(ev), LeftAt: open.JoinedAt, LeaveReason: strText(leaveReasonReplaced),
			ProviderEventID: strText(ev.ProviderEventID), ProviderParticipantSid: strText(ev.ParticipantSID),
		})
		if err != nil || tx.Commit(ctx) != nil {
			return nil
		}
		s.meterAttendance(ctx, sess.MeetingID, past)
		s.publishAttendanceChanged(ctx, sess.MeetingID)
		return nil
	default:
		replaced, err := q.CloseAttendanceSession(ctx, db.CloseAttendanceSessionParams{
			ID: open.ID, LeaveReason: strText(leaveReasonReplaced), LeftAt: eventTime(ev),
		})
		if err != nil {
			return nil
		}
		closed = &replaced
	}
	if _, err := q.OpenAttendanceSession(ctx, db.OpenAttendanceSessionParams{
		ID: util.NewID(), MeetingID: sess.MeetingID, ConferenceSessionID: sess.ID,
		ParticipantID: pid, ProviderParticipantIdentity: ev.Identity,
		JoinedAt: eventTime(ev), ProviderEventID: strText(ev.ProviderEventID),
		ProviderParticipantSid: strText(ev.ParticipantSID),
	}); err != nil {
		return nil
	}
	if err := tx.Commit(ctx); err != nil {
		return nil
	}
	if closed != nil {
		s.meterAttendance(ctx, sess.MeetingID, *closed)
	}
	s.publishAttendanceChanged(ctx, sess.MeetingID)
	return nil
}

// roomParticipantLeft closes the session of the connection that left. The
// leave of an older connection that a reconnect already replaced finds a
// session with another SID and changes nothing. A leave whose connection has
// no session yet (it arrived before its own join) is recorded as a closed,
// zero-length session, so the late join opens nothing that no event would
// ever close.
func (s *MeetingService) roomParticipantLeft(ctx context.Context, sess db.MeetingConferenceSession, ev ProviderNeutralEvent) error {
	pid := participantIDFromIdentity(ev.Identity)
	if pid == "" {
		return nil
	}
	reason := "left"
	if ev.Type == "conference.participant_connection_aborted" {
		reason = "connection_aborted"
	}
	tx, q, err := s.roomTx(ctx, pid)
	if err != nil {
		return nil
	}
	defer tx.Rollback(ctx)
	open, err := q.LockOpenAttendance(ctx, pid)
	switch {
	case err == nil && sameConnection(open, ev):
		closed, err := q.CloseAttendanceSession(ctx, db.CloseAttendanceSessionParams{
			ID: open.ID, LeaveReason: strText(reason), LeftAt: eventTime(ev),
		})
		if err != nil || tx.Commit(ctx) != nil {
			return nil
		}
		s.meterAttendance(ctx, sess.MeetingID, closed)
		s.publishAttendanceChanged(ctx, sess.MeetingID)
		return nil
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return nil
	case ev.ParticipantSID == "":
		return nil
	}
	seen, err := q.AttendanceConnectionSeen(ctx, db.AttendanceConnectionSeenParams{
		MeetingID: sess.MeetingID, ParticipantID: pid, ProviderParticipantSid: strText(ev.ParticipantSID),
	})
	if err != nil || seen {
		return nil
	}
	if _, err := q.InsertClosedAttendanceSession(ctx, db.InsertClosedAttendanceSessionParams{
		ID: util.NewID(), MeetingID: sess.MeetingID, ConferenceSessionID: sess.ID,
		ParticipantID: pid, ProviderParticipantIdentity: ev.Identity,
		JoinedAt: eventTime(ev), LeftAt: eventTime(ev), LeaveReason: strText(reason),
		ProviderEventID: strText(ev.ProviderEventID), ProviderParticipantSid: strText(ev.ParticipantSID),
	}); err != nil {
		return nil
	}
	_ = tx.Commit(ctx)
	return nil
}

// backdateConnectionJoin handles the join of a connection that already has a
// session: a duplicate changes nothing; the join of a connection whose leave
// arrived first moves that zero-length session's start back to the join time.
// Only a closed session is metered; an open one is metered when it closes.
func (s *MeetingService) backdateConnectionJoin(ctx context.Context, tx pgx.Tx, q *db.Queries, sess db.MeetingConferenceSession, pid string, ev ProviderNeutralEvent) error {
	at := eventTime(ev)
	if !at.Valid {
		return nil
	}
	moved, err := q.BackdateConnectionJoin(ctx, db.BackdateConnectionJoinParams{
		JoinedAt: at, MeetingID: sess.MeetingID, ParticipantID: pid, ProviderParticipantSid: strText(ev.ParticipantSID),
	})
	if err != nil || len(moved) == 0 || tx.Commit(ctx) != nil {
		return nil
	}
	for _, m := range moved {
		if m.LeftAt.Valid {
			s.meterAttendance(ctx, sess.MeetingID, m)
		}
	}
	s.publishAttendanceChanged(ctx, sess.MeetingID)
	return nil
}

// meterAttendanceSessions meters every session a bulk close returned.
func (s *MeetingService) meterAttendanceSessions(ctx context.Context, meetingID string, closed []db.MeetingAttendanceSession) {
	for _, c := range closed {
		s.meterAttendance(ctx, meetingID, c)
	}
}
