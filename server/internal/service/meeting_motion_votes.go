package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// motionTimelinePayload encodes the text fields a MOTION_* timeline row carries.
func motionTimelinePayload(fields map[string]string) (string, error) {
	b, err := json.Marshal(fields)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// isMeetingClerk is requireMeetingClerk as a yes/no, for read paths that only
// widen what they show.
func (s *MeetingService) isMeetingClerk(ctx context.Context, userID, meetingID string) bool {
	_, err := s.requireMeetingClerk(ctx, userID, meetingID)
	return err == nil
}

// activeParticipantID is the caller's active participant row in the meeting,
// "" when they have none (a workspace member who never joined, someone
// removed). Pool reads: call it before a transaction, never inside one.
func (s *MeetingService) activeParticipantID(ctx context.Context, userID, guestID, meetingID string) string {
	if userID != "" {
		p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: meetingID, UserID: strText(userID)})
		if err != nil {
			return ""
		}
		return p.ID
	}
	if guestID != "" {
		p, err := s.q.GetActiveGuestParticipant(ctx, db.GetActiveGuestParticipantParams{MeetingID: meetingID, GuestID: strText(guestID)})
		if err != nil {
			return ""
		}
		return p.ID
	}
	return ""
}

// OpenMotion starts voting on a draft and freezes its roll: every active
// MEMBER whose attendance reads PRESENT or LATE right now gets one blank
// ballot. Whoever comes in later does not vote on this motion. An empty roll
// still opens; the client warns before it asks.
func (s *MeetingService) OpenMotion(ctx context.Context, actorID, meetingID, motionID string) (db.MeetingMotion, error) {
	m, err := s.requireMeetingClerk(ctx, actorID, meetingID)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	if m.Status != MeetingInProgress {
		return db.MeetingMotion{}, errInvalidState()
	}
	orgID, err := s.organizationOf(ctx, m)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// Meeting row first, then the motion: the order End uses too. The meeting
	// lock also serializes two clerks opening different motions at once.
	m, err = q.LockMeetingForAttendance(ctx, meetingID)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	if m.Status != MeetingInProgress {
		return db.MeetingMotion{}, errInvalidState()
	}
	mo, err := q.LockMeetingMotion(ctx, db.LockMeetingMotionParams{ID: motionID, MeetingID: meetingID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingMotion{}, ErrNotFound
	}
	if err != nil {
		return db.MeetingMotion{}, err
	}
	if mo.Status != MotionDraft {
		return db.MeetingMotion{}, errMotionNotDraft()
	}
	if _, err := q.GetOpenMeetingMotion(ctx, meetingID); err == nil {
		return db.MeetingMotion{}, errMotionAlreadyOpen()
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingMotion{}, err
	}
	rep, err := s.attendanceReport(ctx, q, m)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	// Total members and the roll are over the people still in the meeting:
	// a finalized roll's snapshot keeps removed members in its own count, and
	// lists those who joined after it uncounted — neither may vote here.
	roll, totalMembers := 0, 0
	for _, r := range rep.Rows {
		if !r.onRoll() {
			continue
		}
		totalMembers++
		if r.Status != AttendancePresent && r.Status != AttendanceLate {
			continue
		}
		if err := q.InsertMeetingMotionBallot(ctx, db.InsertMeetingMotionBallotParams{
			ID: util.NewID(), OrganizationID: orgID, MeetingID: m.ID, MotionID: mo.ID, ParticipantID: r.Participant.ID,
		}); err != nil {
			return db.MeetingMotion{}, err
		}
		roll++
	}
	opened, err := q.OpenMeetingMotion(ctx, db.OpenMeetingMotionParams{
		OpenedBy: strText(actorID), TotalMembers: int32(totalMembers), RollSize: int32(roll), ID: mo.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingMotion{}, errMotionNotDraft()
	}
	if err != nil {
		return db.MeetingMotion{}, err
	}
	payload, err := motionTimelinePayload(map[string]string{"title": opened.Title})
	if err != nil {
		return db.MeetingMotion{}, err
	}
	if err := s.writeAudit(ctx, q, m, "MOTION_OPENED", actorID, MotionDraft, MotionOpen, payload); err != nil {
		return db.MeetingMotion{}, err
	}
	s.record(ctx, q, m, audit.User(actorID), "motion.opened",
		meetingRelatedPayload(m, map[string]string{"motion_id": mo.ID}),
		audit.Diff(
			map[string]any{"status": MotionDraft},
			map[string]any{"status": MotionOpen, "roll_size": roll, "total_members": totalMembers},
		))
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingMotion{}, err
	}
	return opened, nil
}

// CloseMotion ends voting and counts. Only the motion row is locked: a
// ballot locks the same row, so the count includes every ballot that
// committed before it and none after.
func (s *MeetingService) CloseMotion(ctx context.Context, actorID, meetingID, motionID string) (db.MeetingMotion, error) {
	m, err := s.requireMeetingClerk(ctx, actorID, meetingID)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	mo, err := q.LockMeetingMotion(ctx, db.LockMeetingMotionParams{ID: motionID, MeetingID: meetingID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingMotion{}, ErrNotFound
	}
	if err != nil {
		return db.MeetingMotion{}, err
	}
	if mo.Status != MotionOpen {
		return db.MeetingMotion{}, errMotionNotOpen()
	}
	closed, err := s.closeMotionTx(ctx, q, m, mo, audit.User(actorID), actorID)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingMotion{}, err
	}
	return closed, nil
}

// closeMotionTx counts a motion the caller has locked FOR UPDATE inside q's
// transaction and records the close. closedBy "" is the system (a meeting
// that ended on its own): closed_by stays NULL and the timeline names
// systemActorID. Shared by CloseMotion and endMeeting.
func (s *MeetingService) closeMotionTx(ctx context.Context, q *db.Queries, m db.Meeting, mo db.MeetingMotion, actor audit.Actor, closedBy string) (db.MeetingMotion, error) {
	outcome := motionOutcome(mo.Threshold, mo.Base, int(mo.YesCount), int(mo.RollSize.Int32), int(mo.TotalMembers.Int32))
	closed, err := q.CloseMeetingMotion(ctx, db.CloseMeetingMotionParams{Outcome: outcome, ClosedBy: strText(closedBy), ID: mo.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingMotion{}, errMotionNotOpen()
	}
	if err != nil {
		return db.MeetingMotion{}, err
	}
	timelineActor := closedBy
	if timelineActor == "" {
		timelineActor = systemActorID
	}
	payload, err := motionTimelinePayload(map[string]string{"title": closed.Title, "outcome": outcome})
	if err != nil {
		return db.MeetingMotion{}, err
	}
	if err := s.writeAudit(ctx, q, m, "MOTION_CLOSED", timelineActor, MotionOpen, outcome, payload); err != nil {
		return db.MeetingMotion{}, err
	}
	s.record(ctx, q, m, actor, "motion.closed",
		meetingRelatedPayload(m, map[string]string{"motion_id": mo.ID}),
		audit.Diff(map[string]any{"status": MotionOpen}, map[string]any{"status": MotionClosed, "outcome": outcome}))
	return closed, nil
}

// CastBallot records one irreversible ballot. A secret ballot only stamps
// cast_at: the choice goes into the motion's counters and nowhere else, so
// no row, audit entry, event or log line ties a person to it. Never log
// choice here.
func (s *MeetingService) CastBallot(ctx context.Context, userID, guestID, meetingID, motionID, choice string) error {
	if !validChoice(choice) {
		return Invalid("lựa chọn phải là YES, NO hoặc ABSTAIN")
	}
	if _, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID); err != nil {
		return err
	}
	pid := s.activeParticipantID(ctx, userID, guestID, meetingID)
	if pid == "" {
		return errNotOnRoll()
	}
	actor := audit.User(userID)
	if userID == "" {
		actor = audit.Guest(guestID)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// Only the motion row is locked; the meeting is read plainly after it, so
	// End (meeting row, then motions) cannot deadlock against a ballot.
	mo, err := q.LockMeetingMotion(ctx, db.LockMeetingMotionParams{ID: motionID, MeetingID: meetingID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if mo.Status != MotionOpen {
		return errMotionNotOpen()
	}
	m, err := q.GetMeeting(ctx, meetingID)
	if err != nil {
		return err
	}
	if m.Status != MeetingInProgress {
		return errInvalidState()
	}
	var n int64
	if mo.BallotMode == BallotSecret {
		n, err = q.CastSecretMeetingBallot(ctx, db.CastSecretMeetingBallotParams{MotionID: mo.ID, ParticipantID: pid})
	} else {
		n, err = q.CastPublicMeetingBallot(ctx, db.CastPublicMeetingBallotParams{Choice: strText(choice), MotionID: mo.ID, ParticipantID: pid})
	}
	if err != nil {
		return err
	}
	if n == 0 {
		// No blank ballot to fill: either there never was one, or it is used.
		if _, err := q.GetMeetingMotionBallot(ctx, db.GetMeetingMotionBallotParams{MotionID: mo.ID, ParticipantID: pid}); errors.Is(err, pgx.ErrNoRows) {
			return errNotOnRoll()
		} else if err != nil {
			return err
		}
		return errAlreadyVoted()
	}
	if err := q.CountMeetingMotionVote(ctx, db.CountMeetingMotionVoteParams{Choice: choice, ID: mo.ID}); err != nil {
		return err
	}
	var changes map[string]audit.Change
	if mo.BallotMode == BallotPublic {
		changes = map[string]audit.Change{"choice": {From: nil, To: choice}}
	}
	s.recordResource(ctx, q, m, actor, "motion.ballot_cast",
		meetingRelatedPayload(m, map[string]string{"motion_id": mo.ID}), changes, "meeting_motion", mo.ID)
	return tx.Commit(ctx)
}
