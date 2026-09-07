package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/meetings"
)

func TestEnsureGuestCookieMintsAndReuses(t *testing.T) {
	s, _, _, _ := meetingFixture(t)
	ctx := context.Background()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	signed, err := s.EnsureGuestCookie(ctx, rr, req, false)
	if err != nil || signed == "" {
		t.Fatalf("mint guest session: %q err=%v", signed, err)
	}
	cookies := rr.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != meetings.GuestCookieName {
		t.Fatalf("cookie = %+v", cookies)
	}

	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/", nil)
	req2.AddCookie(cookies[0])
	signed2, err := s.EnsureGuestCookie(ctx, rr2, req2, false)
	if err != nil || signed2 != signed {
		t.Fatalf("reuse cookie: %q err=%v", signed2, err)
	}

	rr3 := httptest.NewRecorder()
	req3 := httptest.NewRequest(http.MethodPost, "/", nil)
	req3.Header.Set(meetings.GuestSessionHeader, signed)
	signed3, err := s.EnsureGuestCookie(ctx, rr3, req3, false)
	if err != nil || signed3 != signed {
		t.Fatalf("reuse header: %q err=%v", signed3, err)
	}
}

func TestEnsureGuestCookieUnavailableWithoutHMACKey(t *testing.T) {
	s, _, _, _ := meetingFixture(t)
	s.rt.HMACKey = nil
	_, err := s.EnsureGuestCookie(context.Background(), httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", nil), false)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "guest_unavailable" {
		t.Fatalf("want guest_unavailable, got %v", err)
	}
}
