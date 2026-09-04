package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// AllowLobbyListen gates meeting-scoped lobby WebSocket subscriptions.
// Any authenticated user or guest with a valid uw_guest cookie may listen
// while the meeting is not ended or canceled.
func (s *MeetingService) AllowLobbyListen(ctx context.Context, meetingID, userID, guestID string) (bool, error) {
	if userID == "" && guestID == "" {
		return false, nil
	}
	m, err := s.q.GetMeeting(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if m.Status == MeetingEnded || m.Status == MeetingCanceled {
		return false, nil
	}
	return true, nil
}
