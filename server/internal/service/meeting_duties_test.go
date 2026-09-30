package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// governanceFixture: a live instant meeting hosted by ua with ub invited,
// started an hour ago so seeded room sessions (relative to the start) sit in
// the past — an open session in the future would add negative seconds.
func governanceFixture(t *testing.T) (*MeetingService, db.User, db.User, db.Meeting, string) {
	t.Helper()
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Giao ban")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx,
		`UPDATE meetings SET actual_start_at = now() - interval '1 hour', starts_at = now() - interval '1 hour' WHERE id = $1`,
		m.ID); err != nil {
		t.Fatal(err)
	}
	p, err := s.Invite(ctx, ua.ID, m.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	return s, ua, ub, m, p.ID
}

func newGuestParticipant(t *testing.T, s *MeetingService, meetingID string) db.MeetingParticipant {
	t.Helper()
	g, err := s.q.CreateMeetingParticipant(context.Background(), db.CreateMeetingParticipantParams{
		ID: util.NewID(), MeetingID: meetingID, PrincipalType: PrincipalGuest,
		GuestID: strText(util.NewID()), DisplayNameSnapshot: "Khách", Role: RoleAttendee,
		SourceType: GrantInviteLink, AddedBy: "system",
	})
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestParticipantStandingDefaults(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	member, err := s.q.GetMeetingParticipant(context.Background(), memberPID)
	if err != nil {
		t.Fatal(err)
	}
	if member.Standing != StandingMember || member.IsSecretary {
		t.Fatalf("user participant = %q secretary=%v, want MEMBER/false", member.Standing, member.IsSecretary)
	}
	if g := newGuestParticipant(t, s, m.ID); g.Standing != StandingObserver {
		t.Fatalf("guest standing = %q, want OBSERVER", g.Standing)
	}
}
