package service

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// An invite-link join never holds a transaction while it borrows a second
// connection. On a two-connection pool, guests refreshing their token, new
// guests materializing and approval-mode knocks all run at once; a path that
// read through the pool while holding its own transaction would leave every
// request holding one connection and waiting for another until the deadline.
func TestInviteLinkJoinsDoNotDeadlockSmallPool(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Đông khách")
	if err != nil {
		t.Fatal(err)
	}
	open, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "open", LinkAutoAdmit, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	approval, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "lobby", LinkRequestApproval, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	// Guests already admitted once: their refresh is the hot path (lookup +
	// grant read on every token refresh).
	const returning = 8
	known := make([]string, 0, returning)
	for i := 0; i < returning; i++ {
		dec, err := s.Join(ctx, AdmissionContext{
			MeetingID: m.ID, DisplayName: "Khách", InviteLinkID: open.Link.ID, InviteSecret: open.RawSecret,
		})
		if err != nil || dec.Decision != DecisionAdmit {
			t.Fatalf("seed guest %d: %+v %v", i, dec.Decision, err)
		}
		known = append(known, dec.Participant.GuestID.String)
	}
	knockers := make([]string, 4)
	for i := range knockers {
		g, err := s.q.CreateMeetingGuest(ctx, util.NewID())
		if err != nil {
			t.Fatal(err)
		}
		knockers[i] = g.ID
	}

	cfg := s.pool.Config().Copy()
	cfg.MaxConns = 2
	cfg.MinConns = 0
	small, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer small.Close()
	two := NewMeetingService(small, db.New(small), s.ws, NopPublisher{}, &meetings.FakeProvider{}, s.rt)

	var calls []AdmissionContext
	for _, g := range known {
		in := AdmissionContext{MeetingID: m.ID, GuestID: g, DisplayName: "Khách", InviteLinkID: open.Link.ID, InviteSecret: open.RawSecret}
		calls = append(calls, in, in)
	}
	for i := 0; i < 4; i++ {
		calls = append(calls, AdmissionContext{MeetingID: m.ID, DisplayName: "Mới", InviteLinkID: open.Link.ID, InviteSecret: open.RawSecret})
	}
	for _, g := range knockers {
		calls = append(calls, AdmissionContext{MeetingID: m.ID, GuestID: g, DisplayName: "Gõ cửa", InviteLinkID: approval.Link.ID, InviteSecret: approval.RawSecret})
	}

	deadline, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	type result struct {
		dec AdmissionDecision
		err error
	}
	results := make(chan result, len(calls))
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, in := range calls {
		wg.Add(1)
		go func(in AdmissionContext) {
			defer wg.Done()
			<-start
			dec, err := two.Join(deadline, in)
			results <- result{dec, err}
		}(in)
	}
	close(start)
	wg.Wait()
	close(results)
	var admitted, waiting int
	for r := range results {
		if r.err != nil {
			t.Fatalf("invite-link join on a 2-connection pool: %v", r.err)
		}
		switch r.dec.Decision {
		case DecisionAdmit:
			admitted++
		case DecisionWaitingApproval:
			waiting++
		default:
			t.Fatalf("unexpected decision %q", r.dec.Decision)
		}
	}
	if admitted != 2*returning+4 || waiting != len(knockers) {
		t.Fatalf("admitted %d, waiting %d; want %d and %d", admitted, waiting, 2*returning+4, len(knockers))
	}
}

// A removed guest stays removed when the link is opened again: the read-only
// checks moved ahead of the transaction keep the same answer.
func TestInviteLinkRemovedGuestStaysRemoved(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Gỡ khách")
	if err != nil {
		t.Fatal(err)
	}
	link, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "open", LinkAutoAdmit, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	dec, err := s.Join(ctx, AdmissionContext{MeetingID: m.ID, DisplayName: "Khách", InviteLinkID: link.Link.ID, InviteSecret: link.RawSecret})
	if err != nil || dec.Decision != DecisionAdmit {
		t.Fatalf("first join: %+v %v", dec.Decision, err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE meeting_participants SET status = $1 WHERE id = $2`, ParticipantRemoved, dec.Participant.ID); err != nil {
		t.Fatal(err)
	}
	var ce CodedError
	_, err = s.Join(ctx, AdmissionContext{
		MeetingID: m.ID, GuestID: dec.Participant.GuestID.String, DisplayName: "Khách",
		InviteLinkID: link.Link.ID, InviteSecret: link.RawSecret,
	})
	if !errors.As(err, &ce) || ce.Code != "participant_removed" {
		t.Fatalf("removed guest reopening the link: want participant_removed, got %v", err)
	}
}

// joinRequestedRows counts what one join_request.created command leaves:
// the audit row, its outbox event, and the meeting timeline row.
func joinRequestedRows(t *testing.T, s *MeetingService, meetingID string) (audits, events, timeline int) {
	t.Helper()
	ctx := context.Background()
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.join_requested' AND resource_id = $1`, meetingID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'join_request.created' AND payload::jsonb->>'meeting_id' = $1`, meetingID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM meeting_audit_logs WHERE event_type = 'JOIN_REQUESTED' AND meeting_id = $1`, meetingID).Scan(&timeline); err != nil {
		t.Fatal(err)
	}
	return audits, events, timeline
}

// The lobby retries join every few seconds. Only the knock that files the
// request writes the audit row, the event and the timeline row; a retry that
// finds its PENDING request already there writes nothing. The event carries
// the request id so the requester's client can tell its own request apart.
func TestLobbyRetryRecordsJoinRequestOnce(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Phòng chờ")
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.Evaluate(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID})
	if err != nil || first.Decision != DecisionWaitingApproval {
		t.Fatalf("first knock: %+v %v", first.Decision, err)
	}
	for i := 0; i < 3; i++ {
		again, err := s.Evaluate(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID})
		if err != nil || again.JoinRequestID != first.JoinRequestID {
			t.Fatalf("retry %d: id %q vs %q, err %v", i, again.JoinRequestID, first.JoinRequestID, err)
		}
	}
	if a, e, tl := joinRequestedRows(t, s, m.ID); a != 1 || e != 1 || tl != 1 {
		t.Fatalf("after retries: %d audit rows, %d events, %d timeline rows; want 1 each", a, e, tl)
	}
	var raw string
	if err := s.pool.QueryRow(ctx, `SELECT payload::text FROM outbox_events WHERE topic = 'join_request.created' AND payload::jsonb->>'meeting_id' = $1`, m.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["join_request_id"] != first.JoinRequestID {
		t.Fatalf("join_request.created payload %v lacks join_request_id %q", payload, first.JoinRequestID)
	}
}

// Two knocks by the same requester at once both get the one PENDING request:
// the loser of the partial unique index re-reads it instead of failing.
func TestConcurrentKnocksShareOneJoinRequest(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Gõ cùng lúc")
	if err != nil {
		t.Fatal(err)
	}
	link, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "lobby", LinkRequestApproval, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	guest, err := s.q.CreateMeetingGuest(ctx, util.NewID())
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name string
		in   AdmissionContext
		ask  func(AdmissionContext) (string, error)
	}{
		{"member", AdmissionContext{MeetingID: m.ID, UserID: ub.ID}, func(in AdmissionContext) (string, error) {
			jr, err := s.RequestJoin(ctx, in)
			return jr.ID, err
		}},
		{"guest", AdmissionContext{MeetingID: m.ID, GuestID: guest.ID, DisplayName: "Khách", InviteLinkID: link.Link.ID, InviteSecret: link.RawSecret},
			func(in AdmissionContext) (string, error) {
				dec, err := s.Evaluate(ctx, in)
				return dec.JoinRequestID, err
			}},
	} {
		t.Run(c.name, func(t *testing.T) {
			const n = 8
			ids := make(chan string, n)
			errs := make(chan error, n)
			start := make(chan struct{})
			var wg sync.WaitGroup
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					id, err := c.ask(c.in)
					ids <- id
					errs <- err
				}()
			}
			close(start)
			wg.Wait()
			close(ids)
			close(errs)
			for err := range errs {
				if err != nil {
					t.Fatalf("concurrent knock: %v", err)
				}
			}
			seen := map[string]bool{}
			for id := range ids {
				seen[id] = true
			}
			if len(seen) != 1 || seen[""] {
				t.Fatalf("concurrent knocks got request ids %v, want one", seen)
			}
		})
	}
	if a, e, tl := joinRequestedRows(t, s, m.ID); a != 2 || e != 2 || tl != 2 {
		t.Fatalf("two requesters: %d audit rows, %d events, %d timeline rows; want 2 each", a, e, tl)
	}
}

// Start ensures the provider room inline and queues the same ensure on the
// outbox. When the queued one fails after the inline one succeeded, the
// session stays READY/SYNCED and joins keep being admitted.
func TestFailedEnsureKeepsReadySession(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Đã sẵn sàng")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !conferenceSessionReady(sess) {
		t.Fatalf("after instant start: %s/%s, want READY/SYNCED", sess.Status, sess.ProviderSyncStatus)
	}

	s.recordConferenceEnsure(ctx, sess.ID, meetings.ProviderSessionRef{}, errors.New("provider blip"))
	after, err := s.q.GetConferenceSession(ctx, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != "READY" || after.ProviderSyncStatus != "SYNCED" {
		t.Fatalf("failed ensure downgraded the session to %s/%s", after.Status, after.ProviderSyncStatus)
	}

	// The queued duplicate does not reach the provider at all.
	fp := s.provider.(*meetings.FakeProvider)
	fp.EnsureErr = errors.New("provider down")
	before := fp.EnsureCalls
	drainOutbox(t, s)
	if fp.EnsureCalls != before {
		t.Fatalf("worker re-ensured a synced session: EnsureCalls %d -> %d", before, fp.EnsureCalls)
	}
	dec, err := s.Join(ctx, AdmissionContext{MeetingID: m.ID, UserID: ua.ID})
	if err != nil || dec.Decision != DecisionAdmit {
		t.Fatalf("join after failed duplicate ensure: %q %v", dec.Decision, err)
	}
}

// A failed ensure still marks a session that was never synced, and a later
// success brings it to READY.
func TestEnsureFailureThenSuccessOnPendingSession(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Chưa sẵn sàng")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.UpdateConferenceSessionStatus(ctx, db.UpdateConferenceSessionStatusParams{
		ID: sess.ID, Status: strText("PENDING"), ProviderSyncStatus: strText("PENDING"),
	}); err != nil {
		t.Fatal(err)
	}
	s.recordConferenceEnsure(ctx, sess.ID, meetings.ProviderSessionRef{}, errors.New("down"))
	failed, err := s.q.GetConferenceSession(ctx, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if failed.ProviderSyncStatus != "FAILED" {
		t.Fatalf("failed ensure on a pending session: sync %s, want FAILED", failed.ProviderSyncStatus)
	}
	s.recordConferenceEnsure(ctx, sess.ID, meetings.ProviderSessionRef{RoomSID: "sid-2"}, nil)
	ok, err := s.q.GetConferenceSession(ctx, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ok.Status != "READY" || ok.ProviderSyncStatus != "SYNCED" || ok.ProviderRoomSid.String != "sid-2" {
		t.Fatalf("success after failure: %s/%s sid %q", ok.Status, ok.ProviderSyncStatus, ok.ProviderRoomSid.String)
	}
}
