package service

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

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
// the same transaction, so the one-open-session invariant holds throughout.
// It runs on the event's transaction (HandleProviderEvent): an error rolls the
// event back for the inbox to retry. Closed sessions are metered by the
// metering sweep, not here.
func (s *MeetingService) roomParticipantJoined(ctx context.Context, q *db.Queries, sess db.MeetingConferenceSession, ev ProviderNeutralEvent) (bool, error) {
	pid := participantIDFromIdentity(ev.Identity)
	if pid == "" {
		return false, nil
	}
	// The participant's room session lock: their join and leave webhooks —
	// processed concurrently, possibly by several workers — take turns.
	if err := q.LockRoomSessionsOfParticipant(ctx, pid); err != nil {
		return false, err
	}
	// Share lock: End updates the meeting row before it closes the open
	// sessions, so this join either commits before that close or reads ENDED.
	status, err := q.ShareLockMeetingStatus(ctx, sess.MeetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if status != MeetingInProgress {
		return false, nil
	}
	if ev.ParticipantSID != "" {
		seen, err := q.AttendanceConnectionSeen(ctx, db.AttendanceConnectionSeenParams{
			MeetingID: sess.MeetingID, ParticipantID: pid, ProviderParticipantSid: strText(ev.ParticipantSID),
		})
		if err != nil {
			return false, err
		}
		if seen {
			return backdateConnectionJoin(ctx, q, sess, pid, ev)
		}
	}
	open, err := q.LockOpenAttendance(ctx, pid)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return false, err
	case sameConnection(open, ev):
		return false, nil
	case olderConnection(open, ev):
		if _, err := q.InsertClosedAttendanceSession(ctx, db.InsertClosedAttendanceSessionParams{
			ID: util.NewID(), MeetingID: sess.MeetingID, OrganizationID: sess.OrganizationID, ConferenceSessionID: sess.ID,
			ParticipantID: pid, ProviderParticipantIdentity: ev.Identity,
			JoinedAt: eventTime(ev), LeftAt: open.JoinedAt, LeaveReason: strText(leaveReasonReplaced),
			ProviderEventID: strText(ev.ProviderEventID), ProviderParticipantSid: strText(ev.ParticipantSID),
		}); err != nil {
			return false, err
		}
		return true, nil
	default:
		if _, err := q.CloseAttendanceSession(ctx, db.CloseAttendanceSessionParams{
			ID: open.ID, LeaveReason: strText(leaveReasonReplaced), LeftAt: eventTime(ev),
		}); err != nil {
			return false, err
		}
	}
	if _, err := q.OpenAttendanceSession(ctx, db.OpenAttendanceSessionParams{
		ID: util.NewID(), MeetingID: sess.MeetingID, OrganizationID: sess.OrganizationID, ConferenceSessionID: sess.ID,
		ParticipantID: pid, ProviderParticipantIdentity: ev.Identity,
		JoinedAt: eventTime(ev), ProviderEventID: strText(ev.ProviderEventID),
		ProviderParticipantSid: strText(ev.ParticipantSID),
	}); err != nil {
		return false, err
	}
	return true, nil
}

// roomParticipantLeft closes the session of the connection that left. The
// leave of an older connection that a reconnect already replaced finds a
// session with another SID and changes nothing. A leave whose connection has
// no session yet (it arrived before its own join) is recorded as a closed,
// zero-length session, so the late join opens nothing that no event would
// ever close.
func (s *MeetingService) roomParticipantLeft(ctx context.Context, q *db.Queries, sess db.MeetingConferenceSession, ev ProviderNeutralEvent) (bool, error) {
	pid := participantIDFromIdentity(ev.Identity)
	if pid == "" {
		return false, nil
	}
	reason := "left"
	if ev.Type == "conference.participant_connection_aborted" {
		reason = "connection_aborted"
	}
	if err := q.LockRoomSessionsOfParticipant(ctx, pid); err != nil {
		return false, err
	}
	open, err := q.LockOpenAttendance(ctx, pid)
	switch {
	case err == nil && sameConnection(open, ev):
		if _, err := q.CloseAttendanceSession(ctx, db.CloseAttendanceSessionParams{
			ID: open.ID, LeaveReason: strText(reason), LeftAt: eventTime(ev),
		}); err != nil {
			return false, err
		}
		return true, nil
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return false, err
	case ev.ParticipantSID == "":
		return false, nil
	}
	seen, err := q.AttendanceConnectionSeen(ctx, db.AttendanceConnectionSeenParams{
		MeetingID: sess.MeetingID, ParticipantID: pid, ProviderParticipantSid: strText(ev.ParticipantSID),
	})
	if err != nil || seen {
		return false, err
	}
	if _, err := q.InsertClosedAttendanceSession(ctx, db.InsertClosedAttendanceSessionParams{
		ID: util.NewID(), MeetingID: sess.MeetingID, OrganizationID: sess.OrganizationID, ConferenceSessionID: sess.ID,
		ParticipantID: pid, ProviderParticipantIdentity: ev.Identity,
		JoinedAt: eventTime(ev), LeftAt: eventTime(ev), LeaveReason: strText(reason),
		ProviderEventID: strText(ev.ProviderEventID), ProviderParticipantSid: strText(ev.ParticipantSID),
	}); err != nil {
		return false, err
	}
	return false, nil
}

// backdateConnectionJoin handles the join of a connection that already has a
// session: a duplicate changes nothing; the join of a connection whose leave
// arrived first moves that zero-length session's start back to the join time
// (and hands it back to the metering sweep).
func backdateConnectionJoin(ctx context.Context, q *db.Queries, sess db.MeetingConferenceSession, pid string, ev ProviderNeutralEvent) (bool, error) {
	at := eventTime(ev)
	if !at.Valid {
		return false, nil
	}
	moved, err := q.BackdateConnectionJoin(ctx, db.BackdateConnectionJoinParams{
		JoinedAt: at, MeetingID: sess.MeetingID, ParticipantID: pid, ProviderParticipantSid: strText(ev.ParticipantSID),
	})
	return len(moved) > 0, err
}

// Attendance metering. Closing a room session (a leave, a reconnect that
// replaces it, room_finished, End, the stale sweep) only sets left_at; the
// sweep below meters closed sessions with metered_at NULL in batches, off the
// request and webhook paths. A request that dies after End committed cannot
// lose minutes, and End of a meeting with hundreds of people in the room does
// not meter them one by one.

const (
	attendanceMeterBatch  int32 = 500
	attendanceMeterRounds       = 20
	attendanceMeterTick         = 5 * time.Second
)

// MeterClosedAttendance meters one batch of closed, unmetered room sessions
// into meeting.participant_minutes and reports how many it claimed. The
// batch, its usage events, one counter bump per organization and the
// sessions' metered_at commit together; any error rolls all of it back for
// the next sweep. A usage event is keyed by its session (attendance:<id>), so
// a session metered twice — two replicas, a backdated join, the old inline
// path mid-deploy — counts once.
func (s *MeetingService) MeterClosedAttendance(ctx context.Context, limit int32) (int, error) {
	if limit <= 0 {
		limit = attendanceMeterBatch
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	rows, err := q.ClaimUnmeteredAttendance(ctx, limit)
	if err != nil || len(rows) == 0 {
		return 0, err
	}
	byOrg := map[string][]string{}
	var orgs []string
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		if _, ok := byOrg[r.OrganizationID]; !ok {
			orgs = append(orgs, r.OrganizationID)
		}
		byOrg[r.OrganizationID] = append(byOrg[r.OrganizationID], r.ID)
		ids = append(ids, r.ID)
	}
	// Each organization's counter row stays locked until commit. Replicas
	// sweeping side by side take them in the same order, so two batches that
	// share organizations queue instead of deadlocking.
	slices.Sort(orgs)
	for _, org := range orgs {
		if err := s.ent.RecordMeetingMinutes(ctx, q, org, byOrg[org]); err != nil {
			return 0, err
		}
	}
	if err := q.MarkAttendanceMetered(ctx, ids); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(rows), nil
}

// drainAttendanceMetering sweeps until a batch comes back short, bounded so
// one tick cannot hold the loop forever.
func (s *MeetingService) drainAttendanceMetering(ctx context.Context) error {
	for range attendanceMeterRounds {
		n, err := s.MeterClosedAttendance(ctx, attendanceMeterBatch)
		if err != nil || n < int(attendanceMeterBatch) {
			return err
		}
	}
	return nil
}
