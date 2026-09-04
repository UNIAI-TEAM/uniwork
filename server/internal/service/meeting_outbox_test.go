package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// meetingDispatcher builds the shared outbox dispatcher with only the meeting
// provider consumer registered — the same wiring main uses, minus the
// consumers these tests do not exercise.
func meetingDispatcher(s *MeetingService) *outbox.Dispatcher {
	d := outbox.New(s.pool, s.q, outbox.Options{})
	d.Register(s.ProviderConsumer())
	return d
}

// drainOutbox clears the rows the fixture itself produced — creating an
// organization and a workspace are audited commands now, so they leave events
// behind that would otherwise be claimed ahead of what a test enqueues.
func drainOutbox(t *testing.T, s *MeetingService) {
	t.Helper()
	if err := meetingDispatcher(s).Process(context.Background(), 500); err != nil {
		t.Fatal(err)
	}
}

// enqueueProvider writes a provider.* row the way MeetingService does.
func enqueueProvider(t *testing.T, s *MeetingService, id, workspaceID, topic, payload string) {
	t.Helper()
	if err := s.q.InsertDomainOutboxEvent(context.Background(), db.InsertDomainOutboxEventParams{
		ID: id, WorkspaceID: strText(workspaceID), Topic: topic, Payload: payload, EventVersion: 1,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestOutboxClaimAndComplete(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "O", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]string{
		"meeting_id": m.ID, "session_id": "sess-test", "room_name": meetings.RoomNameForMeeting(m.ID),
	})
	enqueueProvider(t, s, util.NewID(), w.ID, "provider.ensure_session", string(payload))
	if err := meetingDispatcher(s).Process(ctx, 10); err != nil {
		t.Fatal(err)
	}
	row, err := s.q.ListPendingOutbox(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(row) != 0 {
		t.Fatalf("pending rows left: %d", len(row))
	}
}

func TestJoinWaitsForProviderSync(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "P", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Invite(ctx, ua.ID, m.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Start(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = s.q.UpdateConferenceSessionStatus(ctx, db.UpdateConferenceSessionStatusParams{
		ID: sess.ID, ProviderSyncStatus: strText("PENDING"), Status: strText("PENDING"),
	})
	fp := s.provider.(*meetings.FakeProvider)
	fp.EnsureErr = errors.New("provider down")
	ensureBeforeJoin := fp.EnsureCalls
	dec, err := s.Join(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID})
	if err != nil {
		t.Fatal(err)
	}
	if dec.Decision != DecisionWaitingForProvider {
		t.Fatalf("decision = %q", dec.Decision)
	}
	if fp.EnsureCalls != ensureBeforeJoin {
		t.Fatalf("EnsureCalls = %d, want %d (join must not call provider)", fp.EnsureCalls, ensureBeforeJoin)
	}
}

func TestJoinDoesNotReEnsureIdleSession(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Idle rejoin")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = s.q.UpdateConferenceSessionStatus(ctx, db.UpdateConferenceSessionStatusParams{
		ID: sess.ID, ProviderSyncStatus: strText("SYNCED"), Status: strText("IDLE"),
	})
	fp := s.provider.(*meetings.FakeProvider)
	before := fp.EnsureCalls
	dec, err := s.Join(ctx, AdmissionContext{MeetingID: m.ID, UserID: ua.ID})
	if err != nil {
		t.Fatal(err)
	}
	if dec.Decision != DecisionWaitingForProvider {
		t.Fatalf("decision = %q, want WAITING_FOR_PROVIDER", dec.Decision)
	}
	if fp.EnsureCalls != before {
		t.Fatalf("EnsureCalls = %d, want %d (join must not call provider)", fp.EnsureCalls, before)
	}
}

func TestOutboxRetryBackoffDeadLetter(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	drainOutbox(t, s)
	id := util.NewID()
	enqueueProvider(t, s, id, w.ID, "provider.end_session", `{"room_name":"uw_mtg_missing"}`)
	s.provider = nil
	d := meetingDispatcher(s)
	for range int(outbox.MaxAttempts) {
		_ = s.q.ReleaseStaleOutboxClaims(ctx)
		if _, err := s.pool.Exec(ctx, `UPDATE outbox_events SET available_at = now() WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
		_ = d.Process(ctx, 1)
	}
	var status string
	var attempts int32
	row := s.pool.QueryRow(ctx, `SELECT status, attempts FROM outbox_events WHERE id = $1`, id)
	if err := row.Scan(&status, &attempts); err != nil {
		t.Fatal(err)
	}
	if status != "DEAD_LETTER" {
		t.Fatalf("status = %q attempts = %d", status, attempts)
	}
	_ = ua
	_ = pgtype.Timestamptz{}
}

func TestOutboxConcurrentClaim(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "C", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	drainOutbox(t, s)
	room := meetings.RoomNameForMeeting(m.ID)
	for i := 0; i < 4; i++ {
		payload, _ := json.Marshal(map[string]string{
			"meeting_id": m.ID, "session_id": util.NewID(), "room_name": room,
		})
		enqueueProvider(t, s, util.NewID(), w.ID, "provider.ensure_session", string(payload))
	}
	done := make(chan error, 2)
	for range 2 {
		// Two dispatchers stand in for two API nodes: each claims with its own
		// node id, so the FOR UPDATE SKIP LOCKED claim is what keeps them apart.
		d := meetingDispatcher(s)
		go func() {
			done <- d.Process(ctx, 2)
		}()
	}
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	var pending int
	row := s.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE status NOT IN ('DONE', 'DEAD_LETTER')`)
	if err := row.Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Fatalf("pending rows after concurrent claim: %d", pending)
	}
}
