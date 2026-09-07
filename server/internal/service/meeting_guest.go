package service

import (
	"context"
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// EnsureGuestCookie mints a signed uw_guest cookie when the caller is anonymous.
// The signed value is also returned for clients that cannot rely on cross-origin cookies.
func (s *MeetingService) EnsureGuestCookie(ctx context.Context, w http.ResponseWriter, r *http.Request, secure bool) (string, error) {
	if len(s.rt.HMACKey) == 0 {
		return "", coded(500, "guest_unavailable", "guest session unavailable")
	}
	if c, err := r.Cookie(meetings.GuestCookieName); err == nil && c.Value != "" {
		if id, ok := meetings.VerifyGuestCookie(c.Value, s.rt.HMACKey); ok && id != "" {
			return c.Value, nil
		}
	}
	if h := strings.TrimSpace(r.Header.Get(meetings.GuestSessionHeader)); h != "" {
		if id, ok := meetings.VerifyGuestCookie(h, s.rt.HMACKey); ok && id != "" {
			return h, nil
		}
	}
	id := util.NewID()
	if _, err := s.q.CreateMeetingGuest(ctx, id); err != nil {
		return "", err
	}
	signed := meetings.SignGuestCookie(id, s.rt.HMACKey)
	meetings.SetGuestCookie(w, id, s.rt.HMACKey, secure)
	return signed, nil
}

func (s *MeetingService) recordJoinDecision(decision string) {
	if s.metrics != nil {
		s.metrics.IncJoinDecision(decision)
	}
}
