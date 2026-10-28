package service

import "context"

// callRatingCounter is the optional part of MeetingMetrics the Prometheus
// registry implements; a test double without it records nothing.
type callRatingCounter interface{ IncCallRating(rating string) }

var callRatings = map[string]bool{"good": true, "ok": true, "poor": true}

// RateCall counts how someone found the call's sound and picture as they left
// it. Only the total per rating is kept (spec 2026-10-27 decision 2): nothing
// is stored against the person or the meeting, so it writes no business row.
func (s *MeetingService) RateCall(ctx context.Context, userID, guestID, meetingID, rating string) error {
	if _, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID); err != nil {
		return err
	}
	if !callRatings[rating] {
		return Invalid("đánh giá không hợp lệ")
	}
	if c, ok := s.metrics.(callRatingCounter); ok {
		c.IncCallRating(rating)
	}
	return nil
}
