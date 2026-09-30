package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Standing decides whether a participant counts toward attendance and votes.
const (
	StandingMember   = "MEMBER"
	StandingObserver = "OBSERVER"
)

// requireMeetingClerk lets through whoever runs attendance (and later votes):
// the host, a workspace admin, or an active signed-in participant the host
// made secretary. Read on every request, so a demotion bites immediately.
func (s *MeetingService) requireMeetingClerk(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	m, mem, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.HostUserID == userID || isWSAdmin(mem.Role) {
		return m, nil
	}
	p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: meetingID, UserID: strText(userID)})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, err
	}
	if err == nil && p.IsSecretary {
		return m, nil
	}
	return db.Meeting{}, errNotClerk()
}

type ParticipantDutiesInput struct {
	Standing    *string
	IsSecretary *bool
}

// UpdateParticipantDuties sets who votes (standing) and who may clerk.
// Host/admin only: a secretary must not be able to widen their own circle.
func (s *MeetingService) UpdateParticipantDuties(ctx context.Context, actorID, meetingID, participantID string, in ParticipantDutiesInput) (db.MeetingParticipant, error) {
	if in.Standing == nil && in.IsSecretary == nil {
		return db.MeetingParticipant{}, Invalid("không có thay đổi nào")
	}
	if in.Standing != nil && *in.Standing != StandingMember && *in.Standing != StandingObserver {
		return db.MeetingParticipant{}, Invalid("standing phải là MEMBER hoặc OBSERVER")
	}
	m, err := s.requireHostOrAdmin(ctx, actorID, meetingID)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	if m.Status == MeetingCanceled {
		return db.MeetingParticipant{}, errInvalidState()
	}
	p, err := s.q.GetMeetingParticipant(ctx, participantID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (p.MeetingID != meetingID || p.Status != ParticipantActive)) {
		return db.MeetingParticipant{}, ErrNotFound
	}
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	if in.IsSecretary != nil && *in.IsSecretary && p.PrincipalType != PrincipalUser {
		return db.MeetingParticipant{}, coded(http.StatusUnprocessableEntity, "guest_cannot_be_secretary", "khách không thể làm thư ký")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// Standing decides whom a finalized roll counts, so it is locked with the
	// roll; the secretary duty only decides who may clerk, and stays open.
	// Compare against the row as it stands under the meeting lock: the copy
	// read before the transaction may predate a concurrent change.
	if in.Standing != nil {
		locked, err := q.LockMeetingForAttendance(ctx, meetingID)
		if err != nil {
			return db.MeetingParticipant{}, err
		}
		if p, err = q.GetMeetingParticipant(ctx, participantID); err != nil {
			return db.MeetingParticipant{}, err
		}
		if locked.AttendanceFinalizedAt.Valid && *in.Standing != p.Standing {
			return db.MeetingParticipant{}, errAttendanceFinalized()
		}
	}
	params := db.UpdateParticipantDutiesParams{ID: participantID}
	if in.Standing != nil {
		params.Standing = pgtype.Text{String: *in.Standing, Valid: true}
	}
	if in.IsSecretary != nil {
		params.IsSecretary = pgtype.Bool{Bool: *in.IsSecretary, Valid: true}
	}
	up, err := q.UpdateParticipantDuties(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingParticipant{}, ErrNotFound
	}
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	s.record(ctx, q, m, audit.User(actorID), "participant.updated",
		meetingRelatedPayload(m, map[string]string{"participant_id": participantID}),
		audit.Diff(
			map[string]any{"standing": p.Standing, "is_secretary": p.IsSecretary},
			map[string]any{"standing": up.Standing, "is_secretary": up.IsSecretary},
		))
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingParticipant{}, err
	}
	return up, nil
}
