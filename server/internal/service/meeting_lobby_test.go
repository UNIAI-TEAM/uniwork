package service

import (
	"context"
	"testing"
	"time"
)

func TestAllowLobbyListen(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Lobby", StartsAt: start, EndsAt: start.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	ok, err := s.AllowLobbyListen(ctx, m.ID, ua.ID, "")
	if err != nil || !ok {
		t.Fatalf("member listen: ok=%v err=%v", ok, err)
	}
	ok, err = s.AllowLobbyListen(ctx, m.ID, "", "guest-1")
	if err != nil || !ok {
		t.Fatalf("guest listen: ok=%v err=%v", ok, err)
	}
	ok, err = s.AllowLobbyListen(ctx, m.ID, "", "")
	if err != nil || ok {
		t.Fatalf("anonymous denied: ok=%v err=%v", ok, err)
	}
	if _, err := s.Start(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	ok, err = s.AllowLobbyListen(ctx, m.ID, ua.ID, "")
	if err != nil || ok {
		t.Fatalf("ended meeting denied: ok=%v err=%v", ok, err)
	}
}
