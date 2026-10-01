package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func roomEvent(typ, room, participantID, sid string) ProviderNeutralEvent {
	return ProviderNeutralEvent{
		Type: typ, RoomName: room, Identity: "uw_participant_" + participantID,
		ParticipantSID: sid, ProviderEventID: util.NewID(),
	}
}

func mustHandle(t *testing.T, s *MeetingService, ev ProviderNeutralEvent) {
	t.Helper()
	if err := s.HandleProviderEvent(context.Background(), ev); err != nil {
		t.Fatal(err)
	}
}

func attendanceUpdates(pub *capturePublisher, meetingID string) int {
	n := 0
	for _, ev := range pub.events {
		if ev.Type == "attendance.updated" && ev.Payload["meeting_id"] == meetingID {
			n++
		}
	}
	return n
}

// End closes every open room session in its own transaction, at the end
// time: nobody reads "in the room" on an ended meeting.
func TestEndClosesOpenRoomSessions(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	pub := &capturePublisher{}
	s.pub = pub
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "1 minute", "")
	seedSession(t, s, m.ID, memberPID, "2 minutes", "5 minutes")
	seedSession(t, s, m.ID, memberPID, "10 minutes", "")

	ended, err := s.End(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	totals, err := s.q.AttendanceSessionTotals(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(totals) != 2 {
		t.Fatalf("totals rows = %d, want 2", len(totals))
	}
	for _, tt := range totals {
		if tt.InRoom || !tt.LastLeftAt.Valid {
			t.Fatalf("%s after End: in_room=%v last_left=%v", tt.ParticipantID, tt.InRoom, tt.LastLeftAt)
		}
		// Database values only: Postgres' clock runs ahead of Go's.
		if tt.LastLeftAt.Time.After(ended.ActualEndAt.Time) {
			t.Fatalf("%s left at %v, after the end %v", tt.ParticipantID, tt.LastLeftAt.Time, ended.ActualEndAt.Time)
		}
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions a JOIN meetings m ON m.id = a.meeting_id
		WHERE a.meeting_id = $1 AND a.leave_reason = 'meeting_ended' AND a.left_at = m.actual_end_at`, m.ID); n != 2 {
		t.Fatalf("sessions closed at the end = %d, want 2", n)
	}
	if attendanceUpdates(pub, m.ID) == 0 {
		t.Fatal("End closed room sessions without attendance.updated")
	}
}

// The stale sweep closes what is still open on an ended meeting at its end,
// never at the (later) sweep time, and tells open panels to refetch.
func TestReconcileStaleAttendanceClosesAtMeetingEnd(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	// A session that slipped in around the end, and an end half an hour ago.
	seedSession(t, s, m.ID, memberPID, "5 minutes", "")
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET actual_end_at = now() - interval '30 minutes' WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	pub := &capturePublisher{}
	s.pub = pub
	if err := s.ReconcileStaleAttendance(ctx, 10); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions a JOIN meetings m ON m.id = a.meeting_id
		WHERE a.meeting_id = $1 AND a.leave_reason = 'reconciled' AND a.left_at = m.actual_end_at`, m.ID); n != 1 {
		t.Fatalf("reconciled sessions closed at the end = %d, want 1", n)
	}
	if attendanceUpdates(pub, m.ID) != 1 {
		t.Fatalf("attendance.updated = %d, want 1", attendanceUpdates(pub, m.ID))
	}
	// Nothing left to close: no second refresh.
	if err := s.ReconcileStaleAttendance(ctx, 10); err != nil {
		t.Fatal(err)
	}
	if attendanceUpdates(pub, m.ID) != 1 {
		t.Fatalf("idle sweep published: %d", attendanceUpdates(pub, m.ID))
	}
}

// A reconnect: LiveKit sends the new connection's join before the old one's
// leave. The leave of the old SID must not take the person out of the room.
func TestReconnectJoinThenOldLeaveKeepsPersonInRoom(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	room := sess.ProviderRoomName
	mustHandle(t, s, roomEvent("conference.participant_joined", room, memberPID, "PA_old"))
	mustHandle(t, s, roomEvent("conference.participant_joined", room, memberPID, "PA_new"))
	mustHandle(t, s, roomEvent("conference.participant_left", room, memberPID, "PA_old"))

	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions
		WHERE participant_id = $1 AND left_at IS NULL AND provider_participant_sid = 'PA_new'`, memberPID); n != 1 {
		t.Fatalf("open sessions of the new connection = %d, want 1", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions
		WHERE participant_id = $1 AND provider_participant_sid = 'PA_old' AND leave_reason = 'replaced' AND left_at IS NOT NULL`, memberPID); n != 1 {
		t.Fatalf("replaced old sessions = %d, want 1", n)
	}
	rep, err := s.attendanceReport(ctx, s.q, m)
	if err != nil {
		t.Fatal(err)
	}
	if r := rowFor(t, rep, memberPID); !r.InRoom || r.SessionCount != 2 {
		t.Fatalf("after reconnect in_room=%v sessions=%d", r.InRoom, r.SessionCount)
	}
	// The new connection's own leave closes it.
	mustHandle(t, s, roomEvent("conference.participant_left", room, memberPID, "PA_new"))
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1 AND left_at IS NULL`, memberPID); n != 0 {
		t.Fatalf("open sessions after the real leave = %d", n)
	}
}

// The other order: the old leave first, then the new join. One open session.
func TestReconnectLeaveThenJoinEndsWithOneOpenSession(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	room := sess.ProviderRoomName
	mustHandle(t, s, roomEvent("conference.participant_joined", room, memberPID, "PA_old"))
	mustHandle(t, s, roomEvent("conference.participant_connection_aborted", room, memberPID, "PA_old"))
	mustHandle(t, s, roomEvent("conference.participant_joined", room, memberPID, "PA_new"))
	// A duplicate join of the same connection changes nothing.
	mustHandle(t, s, roomEvent("conference.participant_joined", room, memberPID, "PA_new"))

	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1 AND left_at IS NULL`, memberPID); n != 1 {
		t.Fatalf("open sessions = %d, want 1", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1`, memberPID); n != 2 {
		t.Fatalf("sessions = %d, want 2", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions
		WHERE participant_id = $1 AND provider_participant_sid = 'PA_old' AND leave_reason = 'connection_aborted'`, memberPID); n != 1 {
		t.Fatalf("aborted old session = %d, want 1", n)
	}
}

// A session written before SIDs were kept closes on any leave, as before.
func TestLegacySessionWithoutSIDClosesOnLeave(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	seedSession(t, s, m.ID, memberPID, "1 minute", "")
	// A join while the legacy session is open cannot be told apart: no-op.
	mustHandle(t, s, roomEvent("conference.participant_joined", sess.ProviderRoomName, memberPID, "PA_x"))
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1`, memberPID); n != 1 {
		t.Fatalf("sessions after join on a legacy row = %d, want 1", n)
	}
	mustHandle(t, s, roomEvent("conference.participant_left", sess.ProviderRoomName, memberPID, "PA_x"))
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1 AND left_at IS NULL`, memberPID); n != 0 {
		t.Fatalf("legacy session still open: %d", n)
	}
}

// The provider's event time is used, never in the future, and a leave never
// closes a session before it opened.
func TestRoomSessionUsesProviderEventTime(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	var dbNow time.Time
	if err := s.pool.QueryRow(ctx, `SELECT now()`).Scan(&dbNow); err != nil {
		t.Fatal(err)
	}
	join := roomEvent("conference.participant_joined", sess.ProviderRoomName, memberPID, "PA_t")
	join.OccurredAt = dbNow.Add(-20 * time.Minute).Truncate(time.Second)
	mustHandle(t, s, join)
	leave := roomEvent("conference.participant_left", sess.ProviderRoomName, memberPID, "PA_t")
	leave.OccurredAt = join.OccurredAt.Add(-time.Hour) // out of order clock
	mustHandle(t, s, leave)
	var joined, left time.Time
	if err := s.pool.QueryRow(ctx, `SELECT joined_at, left_at FROM meeting_attendance_sessions WHERE participant_id = $1`, memberPID).Scan(&joined, &left); err != nil {
		t.Fatal(err)
	}
	if !joined.Equal(join.OccurredAt) {
		t.Fatalf("joined_at = %v, want the event time %v", joined, join.OccurredAt)
	}
	if !left.Equal(joined) {
		t.Fatalf("left_at = %v, want clamped to joined_at %v", left, joined)
	}
}

// Out of order inside one batch: the newer connection's join is handled
// first, then the older one's join (earlier provider time) and its leave. The
// newer session stays open; the older one is history ending when the newer
// one joined.
func TestLateJoinOfOlderConnectionKeepsNewerSession(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	room := sess.ProviderRoomName
	var dbNow time.Time
	if err := s.pool.QueryRow(ctx, `SELECT now()`).Scan(&dbNow); err != nil {
		t.Fatal(err)
	}
	newer := roomEvent("conference.participant_joined", room, memberPID, "PA_b")
	newer.OccurredAt = dbNow.Add(-time.Minute).Truncate(time.Second)
	older := roomEvent("conference.participant_joined", room, memberPID, "PA_a")
	older.OccurredAt = newer.OccurredAt.Add(-30 * time.Second)
	olderLeft := roomEvent("conference.participant_left", room, memberPID, "PA_a")
	olderLeft.OccurredAt = newer.OccurredAt
	mustHandle(t, s, newer)
	mustHandle(t, s, older)
	mustHandle(t, s, olderLeft)

	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions
		WHERE participant_id = $1 AND left_at IS NULL AND provider_participant_sid = 'PA_b'`, memberPID); n != 1 {
		t.Fatalf("open sessions of the newer connection = %d, want 1", n)
	}
	var joined, left time.Time
	if err := s.pool.QueryRow(ctx, `SELECT joined_at, left_at FROM meeting_attendance_sessions
		WHERE participant_id = $1 AND provider_participant_sid = 'PA_a'`, memberPID).Scan(&joined, &left); err != nil {
		t.Fatal(err)
	}
	if !joined.Equal(older.OccurredAt) || !left.Equal(newer.OccurredAt) {
		t.Fatalf("older connection session = [%v, %v], want [%v, %v]", joined, left, older.OccurredAt, newer.OccurredAt)
	}
	rep, err := s.attendanceReport(ctx, s.q, m)
	if err != nil {
		t.Fatal(err)
	}
	if r := rowFor(t, rep, memberPID); !r.InRoom || r.SessionCount != 2 || !r.FirstJoinedAt.Time.Equal(older.OccurredAt) {
		t.Fatalf("in_room=%v sessions=%d first_joined=%v", r.InRoom, r.SessionCount, r.FirstJoinedAt.Time)
	}
}

// A short connection whose leave is handled before its join: the leave is
// recorded, and the late join opens nothing.
func TestLeaveBeforeJoinOpensNothing(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	room := sess.ProviderRoomName
	mustHandle(t, s, roomEvent("conference.participant_left", room, memberPID, "PA_short"))
	mustHandle(t, s, roomEvent("conference.participant_joined", room, memberPID, "PA_short"))
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1 AND left_at IS NULL`, memberPID); n != 0 {
		t.Fatalf("open sessions after leave-then-join = %d, want 0", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions
		WHERE participant_id = $1 AND provider_participant_sid = 'PA_short' AND left_at = joined_at`, memberPID); n != 1 {
		t.Fatalf("recorded leave = %d, want 1", n)
	}
	// A leave without a SID cannot be matched later: nothing is recorded.
	mustHandle(t, s, roomEvent("conference.participant_left", room, memberPID, ""))
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1`, memberPID); n != 1 {
		t.Fatalf("sessions after a SID-less leave = %d, want 1", n)
	}
}

// A leave handled before its own join, both carrying the provider's times:
// the late join moves the recorded session's start back to when the
// connection really joined, so first-join and minutes present are right.
func TestLateJoinBackdatesSessionRecordedByItsLeave(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	var dbNow time.Time
	if err := s.pool.QueryRow(ctx, `SELECT now()`).Scan(&dbNow); err != nil {
		t.Fatal(err)
	}
	room := sess.ProviderRoomName
	join := roomEvent("conference.participant_joined", room, memberPID, "PA_rev")
	join.OccurredAt = dbNow.Add(-30 * time.Minute).Truncate(time.Second)
	leave := roomEvent("conference.participant_left", room, memberPID, "PA_rev")
	leave.OccurredAt = dbNow.Add(-5 * time.Minute).Truncate(time.Second)
	mustHandle(t, s, leave)
	mustHandle(t, s, join)
	mustHandle(t, s, join) // a duplicate changes nothing
	var joined, left time.Time
	if err := s.pool.QueryRow(ctx, `SELECT joined_at, left_at FROM meeting_attendance_sessions
		WHERE participant_id = $1`, memberPID).Scan(&joined, &left); err != nil {
		t.Fatal(err)
	}
	if !joined.Equal(join.OccurredAt) || !left.Equal(leave.OccurredAt) {
		t.Fatalf("session = %v..%v, want %v..%v", joined, left, join.OccurredAt, leave.OccurredAt)
	}
}

// A join handled after End (a late webhook, or a reconnect before the
// provider room is gone) opens nothing on the ended meeting.
func TestJoinAfterEndOpensNothing(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	// sessionByRoom may no longer resolve the room; drive the handler directly.
	if err := s.roomParticipantJoined(ctx, sess, roomEvent("conference.participant_joined", sess.ProviderRoomName, memberPID, "PA_late")); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1`, memberPID); n != 0 {
		t.Fatalf("sessions opened on an ended meeting = %d, want 0", n)
	}
}

// One identity's webhooks stay in received order inside a batch; other rows
// run on their own.
func TestWebhookRowGroupsKeepOneIdentityInOrder(t *testing.T) {
	rows := []db.WebhookInbox{
		{ID: "1", Payload: `{"Identity":"uw_participant_a"}`},
		{ID: "2", Payload: `{"Identity":"uw_participant_b"}`},
		{ID: "3", Payload: `{"type":"conference.room_finished"}`},
		{ID: "4", Payload: `{"Identity":"uw_participant_a"}`},
		{ID: "5", Payload: `not json`},
		{ID: "6", Payload: `{"Identity":"uw_participant_a"}`},
	}
	got := webhookRowGroups(rows)
	want := [][]int{{0, 3, 5}, {1}, {2}, {4}}
	if len(got) != len(want) {
		t.Fatalf("groups = %v, want %v", got, want)
	}
	for i := range want {
		if len(got[i]) != len(want[i]) {
			t.Fatalf("groups = %v, want %v", got, want)
		}
		for j := range want[i] {
			if got[i][j] != want[i][j] {
				t.Fatalf("groups = %v, want %v", got, want)
			}
		}
	}
}
