package service

import (
	"context"
	"errors"
	"testing"
)

func TestListParticipantsInRoomMarksOpenSessions(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	// Host is still connected; the member came and went.
	seedSession(t, s, m.ID, host.ID, "1 minute", "")
	seedSession(t, s, m.ID, memberPID, "2 minutes", "5 minutes")

	ps, inRoom, err := s.ListParticipantsInRoom(ctx, ub.ID, "", m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) < 2 {
		t.Fatalf("participants = %d, want the host and the member", len(ps))
	}
	if !inRoom[host.ID] {
		t.Fatal("host has an open session and must read as in the room")
	}
	if inRoom[memberPID] {
		t.Fatal("member left and must not read as in the room")
	}

	// The same gate as the plain list: a guest who never joined reads nothing.
	if _, _, err := s.ListParticipantsInRoom(ctx, "", "guest-who-never-joined", m.ID); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider guest err = %v, want forbidden or not found", err)
	}
}
