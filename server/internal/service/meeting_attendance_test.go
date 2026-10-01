package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/meetings"
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

// "Late" is measured from when the meeting could actually be joined: a host
// who opens the room 20 minutes after the scheduled time does not make every
// member late (spec §3.4, update 2026-10-01). Starting early never moves the
// anchor before the scheduled time.
func TestAttendanceAnchor(t *testing.T) {
	sched := time.Date(2026, 9, 30, 9, 0, 0, 0, time.UTC)
	cases := []struct {
		name   string
		typ    string
		actual *time.Time
		want   time.Time
	}{
		{"scheduled, started 20 minutes late", MeetingTypeScheduled, ptrTime(sched.Add(20 * time.Minute)), sched.Add(20 * time.Minute)},
		{"scheduled, started 5 minutes early", MeetingTypeScheduled, ptrTime(sched.Add(-5 * time.Minute)), sched},
		{"scheduled, not started yet", MeetingTypeScheduled, nil, sched},
		{"instant", MeetingTypeInstant, ptrTime(sched.Add(7 * time.Minute)), sched.Add(7 * time.Minute)},
	}
	for _, c := range cases {
		m := db.Meeting{MeetingType: c.typ}
		m.StartsAt.Time, m.StartsAt.Valid = sched, true
		if c.actual != nil {
			m.ActualStartAt.Time, m.ActualStartAt.Valid = *c.actual, true
		}
		if got := attendanceAnchor(m); !got.Equal(c.want) {
			t.Errorf("%s: anchor = %v, want %v", c.name, got, c.want)
		}
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

func TestMarkAttendanceRules(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	// Not a clerk.
	if err := s.MarkAttendance(ctx, ub.ID, m.ID, memberPID, AttendancePresent, ""); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member marks: %v", err)
	}
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, "HERE", ""); err == nil {
		t.Fatal("unknown status accepted")
	}
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendanceExcused, strings.Repeat("ạ", 201)); err == nil {
		t.Fatal("201-char note accepted")
	}
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, "nope", AttendancePresent, ""); err != ErrNotFound {
		t.Fatalf("unknown participant: %v", err)
	}
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendanceExcused, " Đi công tác "); err != nil {
		t.Fatal(err)
	}
	rep, _ := s.Attendance(ctx, ua.ID, m.ID)
	r := rowFor(t, rep, memberPID)
	if r.Status != AttendanceExcused || r.Source != AttendanceSourceManual || r.Note != "Đi công tác" {
		t.Fatalf("excused row = %+v", r)
	}
	// The note belongs to EXCUSED only.
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendanceAbsent, "ghi chú"); err != nil {
		t.Fatal(err)
	}
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if r := rowFor(t, rep, memberPID); r.Note != "" || r.Status != AttendanceAbsent {
		t.Fatalf("absent row = %+v", r)
	}
	// Clear returns to the suggestion.
	if err := s.ClearAttendanceMark(ctx, ua.ID, m.ID, memberPID); err != nil {
		t.Fatal(err)
	}
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if r := rowFor(t, rep, memberPID); r.Source != AttendanceSourceSuggested {
		t.Fatalf("after clear source = %s", r.Source)
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.attendance_marked' AND resource_id = $1`, m.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("attendance_marked audit rows = %d, want 3 (two marks, one clear)", n)
	}
}

func TestMarkAttendanceNeedsLiveOrEndedMeeting(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Sau", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	host := hostParticipant(t, s, m.ID, ua.ID)
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, host.ID, AttendancePresent, ""); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("scheduled meeting: %v", err)
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("finalize scheduled: %v", err)
	}
}

func TestFinalizeAndReopenAttendance(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendanceExcused, "ốm"); err != nil {
		t.Fatal(err)
	}
	// A secretary can finalize.
	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	if err := s.FinalizeAttendance(ctx, ub.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, _ := s.Attendance(ctx, ua.ID, m.ID)
	if !rep.Meeting.AttendanceFinalizedAt.Valid || rep.Meeting.AttendanceFinalizedBy.String != ub.ID {
		t.Fatalf("finalized = %v by %q", rep.Meeting.AttendanceFinalizedAt, rep.Meeting.AttendanceFinalizedBy.String)
	}
	if r := rowFor(t, rep, host.ID); r.Source != AttendanceSourceAuto || r.Status != AttendancePresent {
		t.Fatalf("host snapshot = %+v", r)
	}
	// Twice is a no-op: one audit row for the finalize.
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.attendance_finalized' AND resource_id = $1`, m.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("finalize audit rows = %d, want 1", n)
	}
	// The timeline carries the finalize.
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM meeting_audit_logs WHERE event_type = 'ATTENDANCE_FINALIZED' AND meeting_id = $1`, m.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("timeline rows = %d, want 1", n)
	}
	// Finalized: the roll is locked until someone reopens it.
	if err := s.ClearAttendanceMark(ctx, ua.ID, m.ID, memberPID); !codedIs(err, "attendance_finalized") {
		t.Fatalf("clear after finalize: %v", err)
	}
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, host.ID, AttendanceAbsent, ""); !codedIs(err, "attendance_finalized") {
		t.Fatalf("mark after finalize: %v", err)
	}
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if r := rowFor(t, rep, host.ID); r.Status != AttendancePresent {
		t.Fatalf("refused mark changed the record: %+v", r)
	}
	// Standing decides who the counts are over, so it is locked too; the secretary duty is not.
	observer := StandingObserver
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{Standing: &observer}); !codedIs(err, "attendance_finalized") {
		t.Fatalf("standing change after finalize: %v", err)
	}
	stillMember := StandingMember
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{Standing: &stillMember}); err != nil {
		t.Fatalf("unchanged standing after finalize: %v", err)
	}
	// Someone joining after finalize does not change the record.
	guest := newGuestParticipant(t, s, m.ID)
	seedSession(t, s, m.ID, guest.ID, "40 minutes", "")
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if r := rowFor(t, rep, guest.ID); r.Source != AttendanceSourceSuggested || !r.InRoom || !r.JoinedAfterFinalize {
		t.Fatalf("late joiner after finalize = %+v", r)
	}
	// Reopen drops AUTO rows, keeps MANUAL.
	if err := s.ReopenAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if rep.Meeting.AttendanceFinalizedAt.Valid {
		t.Fatal("still finalized after reopen")
	}
	if r := rowFor(t, rep, host.ID); r.Source != AttendanceSourceSuggested {
		t.Fatalf("host after reopen = %s", r.Source)
	}
	if r := rowFor(t, rep, memberPID); r.Source != AttendanceSourceManual || r.Status != AttendanceExcused {
		t.Fatalf("manual row after reopen = %+v", r)
	}
}

func TestFinalizeWithNoMembers(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	observer := StandingObserver
	for _, pid := range []string{host.ID, memberPID} {
		if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, pid, ParticipantDutiesInput{Standing: &observer}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, _ := s.Attendance(ctx, ua.ID, m.ID)
	if rep.Summary.Members != 0 || !rep.Meeting.AttendanceFinalizedAt.Valid {
		t.Fatalf("no-member finalize: %+v", rep.Summary)
	}
}

func TestRoomSessionWebhooksRefreshAttendance(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	pub := &capturePublisher{}
	s.pub = pub
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	count := func() int {
		n := 0
		for _, ev := range pub.events {
			if ev.Type == "attendance.updated" && ev.Payload["meeting_id"] == m.ID {
				n++
			}
		}
		return n
	}
	ev := ProviderNeutralEvent{
		Type: "conference.participant_joined", RoomName: sess.ProviderRoomName,
		Identity: "uw_participant_" + memberPID, ProviderEventID: "evt-att-join",
	}
	if err := s.HandleProviderEvent(ctx, ev); err != nil {
		t.Fatal(err)
	}
	if count() != 1 {
		t.Fatalf("after join attendance.updated = %d, want 1", count())
	}
	ev.Type, ev.ProviderEventID = "conference.participant_left", "evt-att-left"
	if err := s.HandleProviderEvent(ctx, ev); err != nil {
		t.Fatal(err)
	}
	if count() != 2 {
		t.Fatalf("after leave attendance.updated = %d, want 2", count())
	}
}

func TestUpdateMeetingQuorum(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	sixty, zero, bad, negative := 60, 0, 101, -1
	up, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{QuorumPercent: &sixty})
	if err != nil || !up.QuorumPercent.Valid || up.QuorumPercent.Int16 != 60 {
		t.Fatalf("set quorum: %+v %v", up.QuorumPercent, err)
	}
	for _, v := range []*int{&bad, &negative} {
		if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{QuorumPercent: v}); err == nil {
			t.Fatalf("quorum %d accepted", *v)
		}
	}
	title := "Giao ban tuần"
	up, err = s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Title: &title})
	if err != nil || up.QuorumPercent.Int16 != 60 {
		t.Fatalf("unrelated patch cleared quorum: %+v %v", up.QuorumPercent, err)
	}
	up, err = s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{QuorumPercent: &zero})
	if err != nil || up.QuorumPercent.Valid {
		t.Fatalf("clear quorum: %+v %v", up.QuorumPercent, err)
	}
}

func TestConcurrentFinalizeWritesOnce(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	// Host, secretary and an admin clicking at once. s.record reads through
	// the transaction's q, so each caller needs one connection
	// (TestMeetingRecordOnOneConnectionPool).
	const n = 3
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() { errs <- s.FinalizeAttendance(ctx, ua.ID, m.ID) }()
	}
	for i := 0; i < n; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	var audits, timeline int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.attendance_finalized' AND resource_id = $1`, m.ID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM meeting_audit_logs WHERE event_type = 'ATTENDANCE_FINALIZED' AND meeting_id = $1`, m.ID).Scan(&timeline); err != nil {
		t.Fatal(err)
	}
	if audits != 1 || timeline != 1 {
		t.Fatalf("concurrent finalize wrote %d audit rows and %d timeline rows, want 1 and 1", audits, timeline)
	}
}

// record reads the organization through the caller's q, so a meeting command
// runs entirely on the one connection its transaction already holds. On a
// one-connection pool, a lookup through s.q would wait for that connection
// until the deadline and the command would fail instead of committing. This
// is what lets N concurrent ballots run on N connections (spec §10.1 race).
func TestMeetingRecordOnOneConnectionPool(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	cfg := s.pool.Config().Copy()
	cfg.MaxConns = 1
	cfg.MinConns = 0
	small, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer small.Close()
	one := NewMeetingService(small, db.New(small), s.ws, NopPublisher{}, &meetings.FakeProvider{}, s.rt)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := one.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatalf("finalize on a one-connection pool: %v", err)
	}

	bg := context.Background()
	w, err := s.q.GetWorkspaceByID(bg, m.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	var orgID string
	if err := s.pool.QueryRow(bg,
		`SELECT organization_id FROM audit_events WHERE action = 'meeting.attendance_finalized' AND resource_id = $1`, m.ID,
	).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	if orgID != w.OrganizationID {
		t.Fatalf("audit organization_id = %q, want %q", orgID, w.OrganizationID)
	}
}
