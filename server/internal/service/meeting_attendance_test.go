package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// seedSession inserts an attendance session relative to the meeting's anchor
// using the database clock (the colima Postgres clock runs ahead of Go's).
// left == "" leaves the session open.
func seedSession(t *testing.T, s *MeetingService, meetingID, participantID, join, left string) {
	t.Helper()
	_, err := s.pool.Exec(context.Background(), `
		INSERT INTO meeting_attendance_sessions (id, meeting_id, conference_session_id, participant_id, provider_participant_identity, joined_at, left_at)
		SELECT $1, m.id, 'test-conf', $2::text, 'uw_participant_' || $2::text,
		       COALESCE(m.actual_start_at, m.starts_at) + $3::interval,
		       COALESCE(m.actual_start_at, m.starts_at) + NULLIF($4::text, '')::interval
		FROM meetings m WHERE m.id = $5`,
		util.NewID(), participantID, join, left, meetingID)
	if err != nil {
		t.Fatal(err)
	}
}

func rowFor(t *testing.T, rep AttendanceReport, participantID string) AttendanceRow {
	t.Helper()
	for _, r := range rep.Rows {
		if r.Participant.ID == participantID {
			return r
		}
	}
	t.Fatalf("participant %s not in report", participantID)
	return AttendanceRow{}
}

func hostParticipant(t *testing.T, s *MeetingService, meetingID, userID string) db.MeetingParticipant {
	t.Helper()
	p, err := s.q.GetActiveUserParticipant(context.Background(), db.GetActiveUserParticipantParams{MeetingID: meetingID, UserID: strText(userID)})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSuggestAttendanceGraceBoundary(t *testing.T) {
	anchor := time.Date(2026, 9, 30, 9, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { v := anchor.Add(d); return &v }
	cases := []struct {
		name  string
		first *time.Time
		want  string
	}{
		{"never joined", nil, AttendanceAbsent},
		{"early", at(-5 * time.Minute), AttendancePresent},
		{"exactly at grace", at(10 * time.Minute), AttendancePresent},
		{"one second late", at(10*time.Minute + time.Second), AttendanceLate},
	}
	for _, c := range cases {
		if got := suggestAttendance(anchor, c.first); got != c.want {
			t.Errorf("%s: got %s want %s", c.name, got, c.want)
		}
	}
}

func TestAttendanceAnchor(t *testing.T) {
	sched := time.Date(2026, 9, 30, 9, 0, 0, 0, time.UTC)
	actual := sched.Add(7 * time.Minute)
	scheduled := db.Meeting{MeetingType: MeetingTypeScheduled}
	scheduled.StartsAt.Time, scheduled.StartsAt.Valid = sched, true
	scheduled.ActualStartAt.Time, scheduled.ActualStartAt.Valid = actual, true
	if got := attendanceAnchor(scheduled); !got.Equal(sched) {
		t.Fatalf("scheduled anchor = %v", got)
	}
	instant := scheduled
	instant.MeetingType = MeetingTypeInstant
	if got := attendanceAnchor(instant); !got.Equal(actual) {
		t.Fatalf("instant anchor = %v", got)
	}
}

func TestAttendanceReportSuggestsAndAggregates(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	// Host: joined on time, left, came back and is still in the room.
	seedSession(t, s, m.ID, host.ID, "1 minute", "11 minutes")
	seedSession(t, s, m.ID, host.ID, "20 minutes", "")
	// Member: joined half an hour late, left after ten minutes.
	seedSession(t, s, m.ID, memberPID, "30 minutes", "40 minutes")

	rep, err := s.Attendance(ctx, ub.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	h := rowFor(t, rep, host.ID)
	if h.Status != AttendancePresent || h.Source != AttendanceSourceSuggested {
		t.Fatalf("host = %s/%s", h.Status, h.Source)
	}
	if !h.InRoom || h.LastLeftAt.Valid || h.SessionCount != 2 {
		t.Fatalf("host in_room=%v last_left=%v sessions=%d", h.InRoom, h.LastLeftAt, h.SessionCount)
	}
	if h.PresentSeconds < 600+30*60 {
		t.Fatalf("host present_seconds = %d, want >= %d", h.PresentSeconds, 600+30*60)
	}
	mb := rowFor(t, rep, memberPID)
	if mb.Status != AttendanceLate || mb.InRoom || !mb.LastLeftAt.Valid || mb.PresentSeconds != 600 {
		t.Fatalf("member = %s in_room=%v left=%v secs=%d", mb.Status, mb.InRoom, mb.LastLeftAt.Valid, mb.PresentSeconds)
	}
	if rep.Summary.Members != 2 || rep.Summary.Present != 1 || rep.Summary.Late != 1 || rep.Summary.Absent != 0 {
		t.Fatalf("summary = %+v", rep.Summary)
	}
	if rep.Summary.QuorumMet != nil {
		t.Fatal("quorum_met must be nil without quorum_percent")
	}
}

func TestAttendanceReportExcludesRemovedAndObservers(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	observer := StandingObserver
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{Standing: &observer}); err != nil {
		t.Fatal(err)
	}
	rep, err := s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Observers are listed but not counted.
	if len(rep.Rows) != 2 || rep.Summary.Members != 1 {
		t.Fatalf("rows=%d members=%d", len(rep.Rows), rep.Summary.Members)
	}
	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, memberPID); err != nil {
		t.Fatal(err)
	}
	rep, err = s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rep.Rows {
		if r.Participant.ID == memberPID {
			t.Fatal("removed participant still listed")
		}
	}
}

func TestAttendanceQuorum(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET quorum_percent = 60 WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, err := s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	// 1 of 2 members present = 50% < 60%.
	if rep.Summary.QuorumMet == nil || *rep.Summary.QuorumMet {
		t.Fatalf("quorum_met = %v, want false", rep.Summary.QuorumMet)
	}
	seedSession(t, s, m.ID, memberPID, "2 minutes", "")
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if rep.Summary.QuorumMet == nil || !*rep.Summary.QuorumMet {
		t.Fatalf("quorum_met = %v, want true", rep.Summary.QuorumMet)
	}
	// Nobody is a member: the ratio is undefined, not "met".
	observer := StandingObserver
	for _, pid := range []string{host.ID, memberPID} {
		if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, pid, ParticipantDutiesInput{Standing: &observer}); err != nil {
			t.Fatal(err)
		}
	}
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if rep.Summary.Members != 0 || rep.Summary.QuorumMet != nil {
		t.Fatalf("no members: %+v", rep.Summary)
	}
}

func TestAttendanceNeedsWorkspaceMembership(t *testing.T) {
	// meetingFixture's second user is not in the workspace.
	s, ua, outsider, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Kín")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Attendance(ctx, outsider.ID, m.ID); err != ErrForbidden {
		t.Fatalf("outsider attendance: %v", err)
	}
}
