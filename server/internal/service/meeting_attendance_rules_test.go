package service

import (
	"context"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// liveMeetingWith is governanceFixture's meeting without a new fixture: a
// live instant meeting hosted by hostID, started an hour ago, with memberID
// invited. Returns the meeting and the member's participant id.
func liveMeetingWith(t *testing.T, s *MeetingService, hostID, workspaceID, memberID string) (db.Meeting, string) {
	t.Helper()
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, hostID, workspaceID, "Giao ban")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx,
		`UPDATE meetings SET actual_start_at = now() - interval '1 hour', starts_at = now() - interval '1 hour' WHERE id = $1`,
		m.ID); err != nil {
		t.Fatal(err)
	}
	p, err := s.Invite(ctx, hostID, m.ID, memberID)
	if err != nil {
		t.Fatal(err)
	}
	return m, p.ID
}

// D11: the roll stays open after End — clerks finish it when the meeting is
// over; End itself never finalizes. A canceled meeting has no roll.
func TestAttendanceEditableAfterEnd(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, err := s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Meeting.AttendanceFinalizedAt.Valid {
		t.Fatal("End finalized the roll")
	}
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendanceExcused, "ốm"); err != nil {
		t.Fatalf("mark after End: %v", err)
	}
	if err := s.ClearAttendanceMark(ctx, ua.ID, m.ID, memberPID); err != nil {
		t.Fatalf("clear after End: %v", err)
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatalf("finalize after End: %v", err)
	}
	if err := s.ReopenAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatalf("reopen after End: %v", err)
	}

	start := time.Now().Add(time.Hour)
	canceled, err := s.Create(ctx, ua.ID, m.WorkspaceID, CreateMeetingInput{Title: "Hủy", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	host := hostParticipant(t, s, canceled.ID, ua.ID)
	if err := s.Cancel(ctx, ua.ID, canceled.ID, "x"); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkAttendance(ctx, ua.ID, canceled.ID, host.ID, AttendancePresent, ""); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("mark on canceled: %v", err)
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, canceled.ID); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("finalize on canceled: %v", err)
	}
	if err := s.ReopenAttendance(ctx, ua.ID, canceled.ID); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("reopen on canceled: %v", err)
	}
}

// Finalize freezes a never-joined member as AUTO ABSENT; a session that
// starts afterwards does not change the record.
func TestFinalizeWritesAutoAbsent(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_marks
		WHERE meeting_id = $1 AND participant_id = $2 AND status = 'ABSENT' AND source = 'AUTO'`, m.ID, memberPID); n != 1 {
		t.Fatalf("AUTO ABSENT marks = %d, want 1", n)
	}
	seedSession(t, s, m.ID, memberPID, "70 minutes", "")
	rep, err := s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	r := rowFor(t, rep, memberPID)
	if r.Status != AttendanceAbsent || r.Source != AttendanceSourceAuto || !r.InRoom {
		t.Fatalf("member after a late session = %+v", r)
	}
	if rep.Summary.Absent != 2 || rep.Summary.Present != 0 {
		t.Fatalf("summary = %+v", rep.Summary)
	}
}

// Quorum is met at exactly the percentage (>=), not only above it.
func TestQuorumBoundaryIsInclusive(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	for _, c := range []struct {
		percent int
		met     bool
	}{{50, true}, {51, false}} {
		if _, err := s.pool.Exec(ctx, `UPDATE meetings SET quorum_percent = $1 WHERE id = $2`, c.percent, m.ID); err != nil {
			t.Fatal(err)
		}
		rep, err := s.Attendance(ctx, ua.ID, m.ID)
		if err != nil {
			t.Fatal(err)
		}
		// 1 of 2 members present.
		if rep.Summary.QuorumMet == nil || *rep.Summary.QuorumMet != c.met {
			t.Fatalf("quorum %d%%: met = %v, want %v", c.percent, rep.Summary.QuorumMet, c.met)
		}
	}
}

// A mark and a standing change racing a finalize: each either lands before
// the finalize or is refused with attendance_finalized, and the roll that
// results agrees with whichever happened. Three callers, one connection each.
func TestConcurrentMarkAndStandingVsFinalize(t *testing.T) {
	s, ua, ub, m0, _ := governanceFixture(t)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		m, memberPID := liveMeetingWith(t, s, ua.ID, m0.WorkspaceID, ub.ID)
		host := hostParticipant(t, s, m.ID, ua.ID)
		observer := StandingObserver
		markErr, standErr, finErr := make(chan error, 1), make(chan error, 1), make(chan error, 1)
		go func() { markErr <- s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendancePresent, "") }()
		go func() {
			_, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, host.ID, ParticipantDutiesInput{Standing: &observer})
			standErr <- err
		}()
		go func() { finErr <- s.FinalizeAttendance(ctx, ua.ID, m.ID) }()
		if err := <-finErr; err != nil {
			t.Fatal(err)
		}
		mErr, sErr := <-markErr, <-standErr
		for name, err := range map[string]error{"mark": mErr, "standing": sErr} {
			if err != nil && !codedIs(err, "attendance_finalized") {
				t.Fatalf("%s: %v", name, err)
			}
		}
		rep, err := s.Attendance(ctx, ua.ID, m.ID)
		if err != nil {
			t.Fatal(err)
		}
		if !rep.Meeting.AttendanceFinalizedAt.Valid {
			t.Fatal("not finalized")
		}
		mr := rowFor(t, rep, memberPID)
		if mErr == nil && (mr.Status != AttendancePresent || mr.Source != AttendanceSourceManual) {
			t.Fatalf("mark landed but the row is %+v", mr)
		}
		if mErr != nil && (mr.Status != AttendanceAbsent || mr.Source != AttendanceSourceAuto) {
			t.Fatalf("mark refused but the row is %+v", mr)
		}
		hr := rowFor(t, rep, host.ID)
		if (sErr == nil) != (hr.Participant.Standing == StandingObserver) {
			t.Fatalf("standing err=%v but standing is %s", sErr, hr.Participant.Standing)
		}
		// Every row on a finalized roll carries a mark.
		for _, r := range rep.Rows {
			if r.Source == AttendanceSourceSuggested {
				t.Fatalf("unmarked row on a finalized roll: %+v", r)
			}
		}
		members := 1
		if sErr != nil {
			members = 2
		}
		if rep.Summary.Members != members {
			t.Fatalf("members = %d, want %d", rep.Summary.Members, members)
		}
	}
}

// A workspace admin clerks a meeting they are not in.
func TestWorkspaceAdminClerksWithoutParticipating(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	admin := workspaceUser(t, s, m.WorkspaceID, "admin@example.com", "admin")
	if _, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(admin.ID)}); err == nil {
		t.Fatal("admin is a participant; the test needs one who is not")
	}
	if err := s.MarkAttendance(ctx, admin.ID, m.ID, memberPID, AttendanceExcused, "phép"); err != nil {
		t.Fatalf("admin marks: %v", err)
	}
	if err := s.FinalizeAttendance(ctx, admin.ID, m.ID); err != nil {
		t.Fatalf("admin finalizes: %v", err)
	}
	if err := s.ReopenAttendance(ctx, admin.ID, m.ID); err != nil {
		t.Fatalf("admin reopens: %v", err)
	}
}

// A participant id from another meeting is "not found" and writes nothing.
func TestAttendanceRefusesAnotherMeetingsParticipant(t *testing.T) {
	s, ua, ub, m, _ := governanceFixture(t)
	ctx := context.Background()
	other, otherPID := liveMeetingWith(t, s, ua.ID, m.WorkspaceID, ub.ID)
	if err := s.MarkAttendance(ctx, ua.ID, other.ID, otherPID, AttendanceExcused, "x"); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, otherPID, AttendancePresent, ""); err != ErrNotFound {
		t.Fatalf("mark another meeting's participant: %v", err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_marks WHERE meeting_id = $1`, m.ID); n != 0 {
		t.Fatalf("marks written on the wrong meeting = %d", n)
	}
	// Clear through the wrong meeting leaves the other meeting's mark alone.
	if err := s.ClearAttendanceMark(ctx, ua.ID, m.ID, otherPID); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_marks
		WHERE meeting_id = $1 AND participant_id = $2 AND status = 'EXCUSED'`, other.ID, otherPID); n != 1 {
		t.Fatalf("other meeting's mark = %d, want 1", n)
	}
}

// Reopen audits once; reopening an open roll audits nothing. A secretary can
// reopen but cannot end the meeting.
func TestReopenAuditsOnceAndSecretaryReopens(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.ReopenAttendance(ctx, ub.ID, m.ID); err != nil {
		t.Fatalf("secretary reopens: %v", err)
	}
	if err := s.ReopenAttendance(ctx, ub.ID, m.ID); err != nil {
		t.Fatalf("second reopen: %v", err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM audit_events WHERE action = 'meeting.attendance_reopened' AND resource_id = $1`, m.ID); n != 1 {
		t.Fatalf("reopen audit rows = %d, want 1", n)
	}
	if _, err := s.End(ctx, ub.ID, m.ID); !codedIs(err, "not_meeting_host") {
		t.Fatalf("secretary ends the meeting: %v", err)
	}
}
