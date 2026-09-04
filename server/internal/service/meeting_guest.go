package service

import (
	"context"
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// EnsureGuestCookie mints a signed uw_guest cookie when the caller is anonymous.
func (s *MeetingService) EnsureGuestCookie(ctx context.Context, w http.ResponseWriter, r *http.Request, secure bool) error {
	if len(s.rt.HMACKey) == 0 {
		return coded(500, "guest_unavailable", "guest session unavailable")
	}
	if meetings.GuestIDFromRequest(r, s.rt.HMACKey) != "" {
		return nil
	}
	id := util.NewID()
	if _, err := s.q.CreateMeetingGuest(ctx, id); err != nil {
		return err
	}
	meetings.SetGuestCookie(w, id, s.rt.HMACKey, secure)
	return nil
}

func (s *MeetingService) recordJoinDecision(decision string) {
	if s.metrics != nil {
		s.metrics.IncJoinDecision(decision)
	}
}
