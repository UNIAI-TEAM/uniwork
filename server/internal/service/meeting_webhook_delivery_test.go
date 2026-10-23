package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// enqueueRoomEvent puts ev on the webhook inbox the way the LiveKit handler
// does: the mapped event, JSON-encoded, keyed by its provider event id.
func enqueueRoomEvent(t *testing.T, s *MeetingService, ev ProviderNeutralEvent) {
	t.Helper()
	payload, err := json.Marshal(ev)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := s.EnqueueProviderWebhook(context.Background(), "livekit", ev.ProviderEventID, ev.Type, payload); err != nil || !ok {
		t.Fatalf("enqueue: ok=%v err=%v", ok, err)
	}
}

// failAttendanceInsertsFor makes every attendance insert for one participant
// fail, the way a database under pressure would, until the returned func runs.
// Scoped to that participant so nothing else in the database notices.
func failAttendanceInsertsFor(t *testing.T, s *MeetingService, participantID string) func() {
	t.Helper()
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `CREATE OR REPLACE FUNCTION test_fail_attendance_insert() RETURNS trigger
		LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.participant_id = '`+participantID+`' THEN
				RAISE EXCEPTION 'injected attendance failure';
			END IF;
			RETURN NEW;
		END $$`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `CREATE TRIGGER test_fail_attendance_insert BEFORE INSERT ON meeting_attendance_sessions
		FOR EACH ROW EXECUTE FUNCTION test_fail_attendance_insert()`); err != nil {
		t.Fatal(err)
	}
	drop := func() {
		_, _ = s.pool.Exec(ctx, `DROP TRIGGER IF EXISTS test_fail_attendance_insert ON meeting_attendance_sessions`)
		_, _ = s.pool.Exec(ctx, `DROP FUNCTION IF EXISTS test_fail_attendance_insert()`)
	}
	t.Cleanup(drop)
	return drop
}

// A webhook whose state change fails is retried, not lost: the inbox row goes
// back to PENDING with the error, the provider event ledger has no row for it,
// and the retry applies the change.
func TestFailedWebhookChangeStaysRetryable(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	ev := roomEvent("conference.participant_joined", sess.ProviderRoomName, memberPID, "PA_retry")
	enqueueRoomEvent(t, s, ev)

	restore := failAttendanceInsertsFor(t, s, memberPID)
	if err := s.ProcessWebhookInbox(ctx, 10); err != nil {
		t.Fatal(err)
	}
	var status, lastErr string
	var attempts int
	if err := s.pool.QueryRow(ctx, `SELECT status, attempt_count, COALESCE(last_error, '') FROM webhook_inbox WHERE provider_event_id = $1`,
		ev.ProviderEventID).Scan(&status, &attempts, &lastErr); err != nil {
		t.Fatal(err)
	}
	if status != "PENDING" || attempts != 1 || !strings.Contains(lastErr, "injected attendance failure") {
		t.Fatalf("failed row: status=%s attempts=%d last_error=%q, want PENDING/1/the error", status, attempts, lastErr)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_provider_events WHERE provider_event_id = $1`, ev.ProviderEventID); n != 0 {
		t.Fatalf("ledger rows for a failed event = %d, want 0 (a retry would be skipped)", n)
	}

	restore()
	if _, err := s.pool.Exec(ctx, `UPDATE webhook_inbox SET next_attempt_at = now() WHERE provider_event_id = $1`, ev.ProviderEventID); err != nil {
		t.Fatal(err)
	}
	if err := s.ProcessWebhookInbox(ctx, 10); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM webhook_inbox WHERE provider_event_id = $1 AND status = 'DONE'`, ev.ProviderEventID); n != 1 {
		t.Fatal("retry did not finish the row")
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1 AND left_at IS NULL`, memberPID); n != 1 {
		t.Fatalf("open sessions after retry = %d, want 1", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_provider_events WHERE provider_event_id = $1`, ev.ProviderEventID); n != 1 {
		t.Fatalf("ledger rows after retry = %d, want 1", n)
	}
}

// A redelivered event changes nothing. Without a SID only the ledger can tell
// a replayed join from a new one: replayed after the leave, it would reopen
// the session.
func TestDuplicateWebhookIsNoOp(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	join := roomEvent("conference.participant_joined", sess.ProviderRoomName, memberPID, "")
	mustHandle(t, s, join)
	mustHandle(t, s, roomEvent("conference.participant_left", sess.ProviderRoomName, memberPID, ""))
	mustHandle(t, s, join)
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1`, memberPID); n != 1 {
		t.Fatalf("sessions = %d, want 1", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1 AND left_at IS NULL`, memberPID); n != 0 {
		t.Fatalf("replayed join reopened the session: %d open", n)
	}
	// Through the inbox too: the same event id is taken once.
	payload, _ := json.Marshal(join)
	ok, err := s.EnqueueProviderWebhook(ctx, "livekit", join.ProviderEventID, join.Type, payload)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		if err := s.ProcessWebhookInbox(ctx, 10); err != nil {
			t.Fatal(err)
		}
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE participant_id = $1`, memberPID); n != 1 {
		t.Fatalf("sessions after inbox replay = %d, want 1", n)
	}
}

// room_started and room_finished keep the provider's time, never a future
// one, and a finish older than the room's start (a late retry from before the
// room came back) changes nothing.
func TestRoomStartedAndFinishedUseEventTime(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "1 minute", "")
	if _, err := s.pool.Exec(ctx, `UPDATE meeting_attendance_sessions SET conference_session_id = $1 WHERE meeting_id = $2`, sess.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	at := func(d time.Duration) ProviderNeutralEvent {
		return ProviderNeutralEvent{RoomName: sess.ProviderRoomName, ProviderEventID: util.NewID(), OccurredAt: time.Now().Add(d)}
	}
	read := func() db.MeetingConferenceSession {
		t.Helper()
		got, err := s.q.GetConferenceSession(ctx, sess.ID)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	near := func(got time.Time, want time.Time) bool {
		d := got.Sub(want)
		return d > -time.Second && d < time.Second
	}

	started := at(-30 * time.Minute)
	started.Type = "conference.room_started"
	mustHandle(t, s, started)
	if got := read(); got.Status != "ACTIVE" || !near(got.StartedAt.Time, started.OccurredAt) {
		t.Fatalf("room_started: status=%s started_at=%v, want ACTIVE at %v", got.Status, got.StartedAt.Time, started.OccurredAt)
	}

	stale := at(-40 * time.Minute)
	stale.Type = "conference.room_finished"
	mustHandle(t, s, stale)
	if got := read(); got.Status != "ACTIVE" || got.EndedAt.Valid {
		t.Fatalf("finish older than the start applied: status=%s ended_at=%v", got.Status, got.EndedAt)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_attendance_sessions WHERE meeting_id = $1 AND left_at IS NULL`, m.ID); n != 1 {
		t.Fatalf("stale finish closed room sessions: %d open, want 1", n)
	}

	finished := at(-5 * time.Minute)
	finished.Type = "conference.room_finished"
	mustHandle(t, s, finished)
	got := read()
	if got.Status != "IDLE" || !near(got.EndedAt.Time, finished.OccurredAt) {
		t.Fatalf("room_finished: status=%s ended_at=%v, want IDLE at %v", got.Status, got.EndedAt.Time, finished.OccurredAt)
	}
	var left time.Time
	if err := s.pool.QueryRow(ctx, `SELECT left_at FROM meeting_attendance_sessions WHERE meeting_id = $1`, m.ID).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if !near(left, finished.OccurredAt) {
		t.Fatalf("room session left at %v, want the finish time %v", left, finished.OccurredAt)
	}

	future := at(time.Hour)
	future.Type = "conference.room_started"
	mustHandle(t, s, future)
	var inFuture bool
	if err := s.pool.QueryRow(ctx, `SELECT started_at > now() FROM meeting_conference_sessions WHERE id = $1`, sess.ID).Scan(&inFuture); err != nil {
		t.Fatal(err)
	}
	if inFuture {
		t.Fatal("room_started stored a time in the future")
	}
}

// End of a meeting with 300 people in the room closes their sessions in one
// statement and meters nothing on the request; the sweep then meters all 300
// in a constant number of statements, once.
func TestEndMetersAttendanceInConstantRoundTrips(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	const attendees = 300
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO meeting_attendance_sessions (id, meeting_id, organization_id, conference_session_id, participant_id, provider_participant_identity, joined_at)
		SELECT 'att-load-' || i, m.id, m.organization_id, 'test-conf', 'pid-load-' || i, 'uw_participant_pid-load-' || i,
		       m.actual_start_at + make_interval(secs => i)
		FROM meetings m, generate_series(1, $2) AS i WHERE m.id = $1`, m.ID, attendees); err != nil {
		t.Fatal(err)
	}

	// The same service on a pool that counts its statements (the workspace
	// gate's own pool is not counted; it does not grow with the room either).
	pool, c := countingPool(t, s.pool)
	cs := NewMeetingService(pool, db.New(pool), s.ws, s.pub, s.provider, s.rt)
	if _, err := cs.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	endStatements := c.n.Load()
	t.Logf("End: %d statements for %d people in the room", endStatements, attendees)
	if endStatements > 40 {
		t.Fatalf("End sent %d statements for %d people in the room; it must not grow with them", endStatements, attendees)
	}
	if n := countRows(t, s, `SELECT count(*) FROM usage_events WHERE ref_id = $1`, m.ID); n != 0 {
		t.Fatalf("End metered %d sessions on the request", n)
	}

	c.n.Store(0)
	n, err := cs.MeterClosedAttendance(ctx, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if n != attendees {
		t.Fatalf("sweep claimed %d sessions, want %d", n, attendees)
	}
	t.Logf("sweep: %d statements for %d sessions", c.n.Load(), attendees)
	if got := c.n.Load(); got > 12 {
		t.Fatalf("sweep sent %d statements for %d sessions; want a constant handful", got, attendees)
	}
	want := countRows(t, s, `SELECT sum(ceil(extract(epoch FROM (left_at - joined_at)) / 60))::int FROM meeting_attendance_sessions WHERE meeting_id = $1`, m.ID)
	total := func() int {
		return countRows(t, s, `SELECT COALESCE(sum(total), 0)::int FROM usage_counters WHERE organization_id = $1 AND meter_key = $2`, m.OrganizationID, FeatureMeetingMinutes)
	}
	if got := total(); got != want || want == 0 {
		t.Fatalf("counter = %d, want %d", got, want)
	}
	if n := countRows(t, s, `SELECT count(*) FROM usage_events WHERE ref_id = $1 AND idempotency_key LIKE 'attendance:%'`, m.ID); n != attendees {
		t.Fatalf("usage events = %d, want %d", n, attendees)
	}

	// Metering the same sessions again (a second replica, a retried batch)
	// counts nothing.
	if _, err := s.pool.Exec(ctx, `UPDATE meeting_attendance_sessions SET metered_at = NULL WHERE meeting_id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MeterClosedAttendance(ctx, 1000); err != nil {
		t.Fatal(err)
	}
	if got := total(); got != want {
		t.Fatalf("re-metering moved the counter to %d, want %d", got, want)
	}
	if n, err := s.MeterClosedAttendance(ctx, 1000); err != nil || n != 0 {
		t.Fatalf("idle sweep claimed %d, err %v", n, err)
	}
}

// A leave that arrived before its join records a zero-length session, which
// the sweep meters as nothing; the late join backdates it and hands it back,
// so its minutes are recorded after all.
func TestBackdatedJoinIsMeteredAgain(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	t0 := time.Now()
	leave := roomEvent("conference.participant_left", sess.ProviderRoomName, memberPID, "PA_back")
	leave.OccurredAt = t0.Add(-time.Minute)
	mustHandle(t, s, leave)
	if _, err := s.MeterClosedAttendance(ctx, 100); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM usage_events WHERE ref_id = $1`, m.ID); n != 0 {
		t.Fatalf("zero-length session metered %d events", n)
	}
	join := roomEvent("conference.participant_joined", sess.ProviderRoomName, memberPID, "PA_back")
	join.OccurredAt = t0.Add(-30 * time.Minute)
	mustHandle(t, s, join)
	if _, err := s.MeterClosedAttendance(ctx, 100); err != nil {
		t.Fatal(err)
	}
	if got := countRows(t, s, `SELECT COALESCE(sum(delta), 0)::int FROM usage_events WHERE ref_id = $1`, m.ID); got != 29 {
		t.Fatalf("backdated session metered %d minutes, want 29", got)
	}
}

// The inbox is drained within one tick: batches keep coming while they are full.
func TestDrainWebhookInboxTakesEveryFullBatch(t *testing.T) {
	s, _, _, _ := meetingFixture(t)
	ctx := context.Background()
	s.rt.WebhookBatch = 2
	for range 5 {
		enqueueRoomEvent(t, s, roomEvent("conference.room_finished", "uw_mtg_nosuchmeeting", "", ""))
	}
	if err := s.drainWebhookInbox(ctx); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM webhook_inbox WHERE status = 'DONE'`); n != 5 {
		t.Fatalf("done rows = %d, want 5", n)
	}
}

// RunWorkers returns once ctx is done, so shutdown can wait for it.
func TestRunWorkersReturnsOnCancel(t *testing.T) {
	s := &MeetingService{rt: MeetingRuntime{WorkerTick: time.Hour}}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { s.RunWorkers(ctx); close(done) }()
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("RunWorkers did not return after cancel")
	}
}
