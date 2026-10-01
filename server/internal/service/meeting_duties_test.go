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

func TestUpdateParticipantDutiesPermissions(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	yes, no := true, false
	observer := StandingObserver

	// A member who is not the host cannot hand out roles.
	if _, err := s.UpdateParticipantDuties(ctx, ub.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); !codedIs(err, "not_meeting_host") {
		t.Fatalf("member assigns secretary: %v", err)
	}
	// Host makes ub secretary: ub now passes the clerk gate.
	p, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes})
	if err != nil || !p.IsSecretary {
		t.Fatalf("host assigns secretary: %+v %v", p, err)
	}
	if _, err := s.requireMeetingClerk(ctx, ub.ID, m.ID); err != nil {
		t.Fatalf("secretary clerk gate: %v", err)
	}
	// A secretary still cannot change standing or appoint anyone.
	if _, err := s.UpdateParticipantDuties(ctx, ub.ID, m.ID, memberPID, ParticipantDutiesInput{Standing: &observer}); !codedIs(err, "not_meeting_host") {
		t.Fatalf("secretary changes standing: %v", err)
	}
	// Demoted: the very next request is refused.
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &no}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.requireMeetingClerk(ctx, ub.ID, m.ID); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("demoted secretary clerk gate: %v", err)
	}
	// Host is always a clerk.
	if _, err := s.requireMeetingClerk(ctx, ua.ID, m.ID); err != nil {
		t.Fatalf("host clerk gate: %v", err)
	}
}

func TestUpdateParticipantDutiesValidation(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	yes := true
	bad := "VOTER"
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{Standing: &bad}); err == nil {
		t.Fatal("unknown standing accepted")
	}
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{}); err == nil {
		t.Fatal("empty patch accepted")
	}
	guest := newGuestParticipant(t, s, m.ID)
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, guest.ID, ParticipantDutiesInput{IsSecretary: &yes}); !codedIs(err, "guest_cannot_be_secretary") {
		t.Fatalf("guest secretary: %v", err)
	}
	member := StandingMember
	promoted, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, guest.ID, ParticipantDutiesInput{Standing: &member})
	if err != nil || promoted.Standing != StandingMember {
		t.Fatalf("promote guest to member: %+v %v", promoted, err)
	}
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, "nope", ParticipantDutiesInput{Standing: &member}); err != ErrNotFound {
		t.Fatalf("unknown participant: %v", err)
	}
}

func TestUpdateParticipantDutiesAudits(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE action = 'meeting.participant_updated' AND resource_id = $1`, m.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("participant_updated audit rows = %d, want 1", n)
	}
}

// A secretary clerks through the workspace gate, so an account from outside
// the workspace (brought in by an invite link) cannot be appointed.
func TestSecretaryMustBeWorkspaceMember(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	outsider := workspaceUser(t, s, m.WorkspaceID, "outsider@example.com", "")
	p, err := s.q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: util.NewID(), MeetingID: m.ID, PrincipalType: PrincipalUser, UserID: strText(outsider.ID),
		DisplayNameSnapshot: "Ngoài", Role: RoleAttendee, SourceType: GrantInviteLink, AddedBy: "system",
	})
	if err != nil {
		t.Fatal(err)
	}
	yes := true
	_, err = s.UpdateParticipantDuties(ctx, ua.ID, m.ID, p.ID, ParticipantDutiesInput{IsSecretary: &yes})
	if !codedIs(err, "secretary_not_workspace_member") || codedStatus(err) != 422 {
		t.Fatalf("outsider secretary: %v", err)
	}
	if got, _ := s.q.GetMeetingParticipant(ctx, p.ID); got.IsSecretary {
		t.Fatal("refused appointment was written")
	}
	// Standing alone is still the host's call for that row.
	member := StandingMember
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, p.ID, ParticipantDutiesInput{Standing: &member}); err != nil {
		t.Fatalf("outsider standing: %v", err)
	}
}

// The host's own row is not special: its standing moves both ways, and is
// locked with the roll like everyone else's. The secretary duty is not.
func TestHostRowStandingAndFinalizedDuties(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	observer, member := StandingObserver, StandingMember
	p, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, host.ID, ParticipantDutiesInput{Standing: &observer})
	if err != nil || p.Standing != StandingObserver {
		t.Fatalf("host to observer: %+v %v", p.Standing, err)
	}
	p, err = s.UpdateParticipantDuties(ctx, ua.ID, m.ID, host.ID, ParticipantDutiesInput{Standing: &member})
	if err != nil || p.Standing != StandingMember {
		t.Fatalf("host back to member: %+v %v", p.Standing, err)
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, host.ID, ParticipantDutiesInput{Standing: &observer}); !codedIs(err, "attendance_finalized") {
		t.Fatalf("host standing on a finalized roll: %v", err)
	}
	yes := true
	if p, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil || !p.IsSecretary {
		t.Fatalf("secretary on a finalized roll: %+v %v", p.IsSecretary, err)
	}
}
