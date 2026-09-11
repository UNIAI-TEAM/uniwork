package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// authorizeActiveParticipant allows workspace members or guests with an active
// participant row in the meeting. Used for in-room read paths and guest chat.
func (s *MeetingService) authorizeActiveParticipant(ctx context.Context, userID, guestID, meetingID string) (db.Meeting, error) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, ErrNotFound
	}
	if err != nil {
		return db.Meeting{}, err
	}
	if userID != "" {
		if _, _, err := s.authorize(ctx, userID, meetingID); err != nil {
			return db.Meeting{}, err
		}
		return m, nil
	}
	if guestID == "" {
		return db.Meeting{}, ErrForbidden
	}
	if _, err := s.q.GetActiveGuestParticipant(ctx, db.GetActiveGuestParticipantParams{
		MeetingID: meetingID,
		GuestID:   strText(guestID),
	}); errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, ErrForbidden
	} else if err != nil {
		return db.Meeting{}, err
	}
	return m, nil
}
