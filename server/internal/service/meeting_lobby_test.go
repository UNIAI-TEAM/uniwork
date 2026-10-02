package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestAllowLobbyListen(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
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
	// Knowing the meeting id is not enough: a guest listens once they have
	// knocked, and an account outside the workspace not at all.
	ok, err = s.AllowLobbyListen(ctx, m.ID, "", "guest-1")
	if err != nil || ok {
		t.Fatalf("guest before knocking: ok=%v err=%v, want refused", ok, err)
	}
	// A guest knocks through an invite link, never by the bare meeting id.
	if _, err := s.RequestJoin(ctx, AdmissionContext{MeetingID: m.ID, GuestID: "guest-1", DisplayName: "Khách"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("guest knock without a link = %v, want ErrNotFound", err)
	}
	jr, err := s.q.CreateJoinRequest(ctx, db.CreateJoinRequestParams{
		ID: util.NewID(), OrganizationID: m.OrganizationID, MeetingID: m.ID,
		RequesterGuestID: pgtype.Text{String: "guest-1", Valid: true}, DisplayNameSnapshot: "Khách",
	})
	if err != nil {
		t.Fatal(err)
	}
	ok, err = s.AllowLobbyListen(ctx, m.ID, "", "guest-1")
	if err != nil || !ok {
		t.Fatalf("guest whose knock is pending: ok=%v err=%v", ok, err)
	}
	// Refused, the knocker has already heard so on the open socket; a
	// reconnect is not let back in.
	if err := s.RejectJoinRequest(ctx, ua.ID, jr.ID, ""); err != nil {
		t.Fatal(err)
	}
	ok, err = s.AllowLobbyListen(ctx, m.ID, "", "guest-1")
	if err != nil || ok {
		t.Fatalf("guest whose knock was refused: ok=%v err=%v, want refused", ok, err)
	}
	ok, err = s.AllowLobbyListen(ctx, m.ID, ub.ID, "")
	if err != nil || ok {
		t.Fatalf("account outside the workspace: ok=%v err=%v, want refused", ok, err)
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
