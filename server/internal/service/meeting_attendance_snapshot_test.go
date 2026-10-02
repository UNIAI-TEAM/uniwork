package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// workspaceUser registers another verified user and adds them to the
// workspace with role ("member", "admin"); role "" leaves them outside it.
func workspaceUser(t *testing.T, s *MeetingService, workspaceID, email, role string) db.User {
	t.Helper()
	as := NewAuthService(s.pool, s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	u := registerVerified(t, s.q, as, email, email)
	if role != "" {
		if err := s.q.AddWorkspaceMember(context.Background(), db.AddWorkspaceMemberParams{
			WorkspaceID: workspaceID, UserID: u.ID, Role: role,
		}); err != nil {
			t.Fatal(err)
		}
	}
	return u
}

// A finalized roll is a snapshot of its marks: inviting or removing people
// afterwards does not move the recorded numbers, and neither may vote.
func TestFinalizedRollIsASnapshot(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET quorum_percent = 50 WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	before, err := s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := AttendanceSummary{Members: 2, Present: 1, Absent: 1}
	if got := before.Summary; got.Members != want.Members || got.Present != want.Present || got.Absent != want.Absent ||
		got.QuorumMet == nil || !*got.QuorumMet {
		t.Fatalf("finalized summary = %+v", got)
	}

	// Invited after the finalize, and already in the room.
	uc := workspaceUser(t, s, m.WorkspaceID, "c@example.com", "member")
	late, err := s.Invite(ctx, ua.ID, m.ID, uc.ID)
	if err != nil {
		t.Fatal(err)
	}
	seedSession(t, s, m.ID, late.ID, "50 minutes", "")
	rep, err := s.Attendance(ctx, ub.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Summary.Members != 2 || rep.Summary.Present != 1 || rep.Summary.Absent != 1 {
		t.Fatalf("invite after finalize moved the summary: %+v", rep.Summary)
	}
	r := rowFor(t, rep, late.ID)
	if !r.JoinedAfterFinalize || r.Removed || r.Source != AttendanceSourceSuggested {
		t.Fatalf("late invitee row = %+v", r)
	}
	for _, pid := range []string{host.ID, memberPID} {
		if r := rowFor(t, rep, pid); r.JoinedAfterFinalize || r.Removed {
			t.Fatalf("finalized row %s flagged: %+v", pid, r)
		}
	}

	// Removing a marked member keeps them in the snapshot, flagged.
	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, memberPID); err != nil {
		t.Fatal(err)
	}
	rep, err = s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Summary.Members != 2 || rep.Summary.Absent != 1 || rep.Summary.QuorumMet == nil || !*rep.Summary.QuorumMet {
		t.Fatalf("removal after finalize moved the summary: %+v", rep.Summary)
	}
	if r := rowFor(t, rep, memberPID); !r.Removed || r.Status != AttendanceAbsent || r.Source != AttendanceSourceAuto {
		t.Fatalf("removed member row = %+v", r)
	}

	// A vote opened now: neither the removed member nor the late invitee
	// is on the roll or in total_members.
	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Ngân sách", BallotPublic, ThresholdMajority)
	opened := openVoteMotion(t, s, ua.ID, m.ID, mo.ID)
	if opened.RollSize.Int32 != 1 || opened.TotalMembers.Int32 != 1 {
		t.Fatalf("roll_size=%d total_members=%d, want 1 and 1", opened.RollSize.Int32, opened.TotalMembers.Int32)
	}
	if roll := ballotRoll(t, s, mo.ID); len(roll) != 1 || !roll[host.ID] {
		t.Fatalf("voter roll = %v, want only the host", roll)
	}

	// Reopen: back to the live list — the removed member drops out, the late
	// invitee counts.
	if err := s.ReopenAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, err = s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rep.Rows {
		if r.Participant.ID == memberPID {
			t.Fatal("removed member listed on a reopened roll")
		}
		if r.Removed || r.JoinedAfterFinalize {
			t.Fatalf("reopened roll row flagged: %+v", r)
		}
	}
	if rep.Summary.Members != 2 || rep.Summary.Late != 1 || rep.Summary.Present != 1 {
		t.Fatalf("reopened summary = %+v", rep.Summary)
	}
}

// A clerk's mark outlives the person's removal. Finalizing must not bring a
// person removed while the roll was open back onto the roll, nor one removed
// after a finalize and before a reopen and a second finalize.
func TestFinalizeDropsMarksOfPeopleNoLongerOnTheRoll(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	uc := workspaceUser(t, s, m.WorkspaceID, "c@example.com", "member")
	third, err := s.Invite(ctx, ua.ID, m.ID, uc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET quorum_percent = 50 WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	notListed := func(rep AttendanceReport, pid string) {
		t.Helper()
		for _, r := range rep.Rows {
			if r.Participant.ID == pid {
				t.Fatalf("%s listed on the roll: %+v", pid, r)
			}
		}
	}

	// Marked present by hand, then removed while the roll is open.
	for _, pid := range []string{memberPID, third.ID} {
		if err := s.MarkAttendance(ctx, ua.ID, m.ID, pid, AttendancePresent, ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, memberPID); err != nil {
		t.Fatal(err)
	}
	live, err := s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, err := s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Summary.Members != live.Summary.Members || rep.Summary.Present != live.Summary.Present ||
		rep.Summary.Absent != live.Summary.Absent || rep.Summary.Members != 2 {
		t.Fatalf("finalize moved the summary: live %+v, finalized %+v", live.Summary, rep.Summary)
	}
	notListed(rep, memberPID)

	// Finalized, then the third member (a manual mark) is removed — kept in
	// this snapshot — then reopened and finalized again: off the new one.
	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, third.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.ReopenAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, host.ID, AttendancePresent, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, err = s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Summary.Members != 1 || rep.Summary.Present != 1 || rep.Summary.QuorumMet == nil || !*rep.Summary.QuorumMet {
		t.Fatalf("refinalized summary = %+v, want only the host", rep.Summary)
	}
	notListed(rep, memberPID)
	notListed(rep, third.ID)
}
