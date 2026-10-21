package service

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// scribeFixture: an instant meeting in progress with the scribe configured,
// the flag on, and the host in the room.
func scribeFixture(t *testing.T) (*MeetingService, *meetings.FakeProvider, db.User, db.Meeting) {
	t.Helper()
	s, ua, _, w := meetingFixture(t)
	fake := &meetings.FakeProvider{}
	s.provider = fake
	s.rt.ScribeEnabled, s.rt.ScribeAgentName = true, "uniwork-scribe"
	s.SetFlags(mcpFlagsExcept{})
	m, err := s.CreateInstant(context.Background(), ua.ID, w.ID, "Giao ban")
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := fake.ScribeCalls(); d != 0 {
		t.Fatalf("dispatched into an empty room at Start: %d", d)
	}
	joinRoom(t, s, m, ua.ID)
	return s, fake, ua, m
}

func joinRoom(t *testing.T, s *MeetingService, m db.Meeting, userID string) {
	t.Helper()
	ctx := context.Background()
	p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(userID)})
	if err != nil {
		t.Fatal(err)
	}
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.OpenAttendanceSession(ctx, db.OpenAttendanceSessionParams{
		ID: util.NewID(), MeetingID: m.ID, ConferenceSessionID: sess.ID, ParticipantID: p.ID,
		ProviderParticipantIdentity: meetings.IdentityForParticipant(p.ID), OrganizationID: m.OrganizationID,
	}); err != nil {
		t.Fatal(err)
	}
}

// leaveRoom closes every open session as of `ago` in the past.
func leaveRoom(t *testing.T, s *MeetingService, m db.Meeting, ago time.Duration) {
	t.Helper()
	if _, err := s.pool.Exec(context.Background(),
		`UPDATE meeting_attendance_sessions SET left_at = now() - make_interval(secs => $2), leave_reason = 'left' WHERE meeting_id = $1 AND left_at IS NULL`,
		m.ID, ago.Seconds()); err != nil {
		t.Fatal(err)
	}
}

func setTranscriptionQuota(t *testing.T, s *MeetingService, orgID string, minutes int) {
	t.Helper()
	if _, err := s.pool.Exec(context.Background(),
		`UPDATE subscriptions SET overrides = COALESCE(overrides, '{}'::jsonb) || jsonb_build_object('meeting.transcription', $2::int) WHERE organization_id = $1`,
		orgID, minutes); err != nil {
		t.Fatal(err)
	}
}

func transcriptionMinutes(t *testing.T, s *MeetingService, orgID string) int64 {
	t.Helper()
	var total int64
	err := s.pool.QueryRow(context.Background(),
		`SELECT COALESCE(sum(total), 0) FROM usage_counters WHERE organization_id = $1 AND meter_key = 'meeting.transcription'`, orgID).Scan(&total)
	if err != nil {
		t.Fatal(err)
	}
	return total
}

func latestRun(t *testing.T, s *MeetingService, meetingID string) db.MeetingScribeRun {
	t.Helper()
	r, err := s.q.GetLatestScribeRun(context.Background(), meetingID)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func ageRun(t *testing.T, s *MeetingService, runID, column string, by time.Duration) {
	t.Helper()
	if _, err := s.pool.Exec(context.Background(),
		`UPDATE meeting_scribe_runs SET `+column+` = now() - make_interval(secs => $2) WHERE id = $1`, runID, by.Seconds()); err != nil {
		t.Fatal(err)
	}
}

func claimsOf(t *testing.T, s *MeetingService, fake *meetings.FakeProvider) meetings.AgentClaims {
	t.Helper()
	var meta struct{ MeetingID, Token, Locale string }
	d := fake.LastScribeDispatch()
	if err := json.Unmarshal([]byte(d.Metadata), &struct {
		MeetingID *string `json:"meeting_id"`
		Token     *string `json:"token"`
		Locale    *string `json:"locale"`
	}{&meta.MeetingID, &meta.Token, &meta.Locale}); err != nil {
		t.Fatal(err)
	}
	c, ok := meetings.VerifyAgentToken(s.rt.HMACKey, meta.Token, time.Now())
	if !ok || c.MeetingID != meta.MeetingID || meta.Locale != "vi" || d.RoomName != meetings.RoomNameForMeeting(meta.MeetingID) || d.AgentName != "uniwork-scribe" {
		t.Fatalf("dispatch %+v carries claims %+v ok=%v", d, c, ok)
	}
	return c
}

func TestEnsureScribeDispatchesOnlyWhenWanted(t *testing.T) {
	ctx := context.Background()
	cases := map[string]func(s *MeetingService, m db.Meeting){
		"room empty":  func(s *MeetingService, m db.Meeting) { leaveRoom(t, s, m, time.Minute) },
		"flag off":    func(s *MeetingService, _ db.Meeting) { s.SetFlags(mcpFlagsExcept{off: scribeFlag}) },
		"no flags":    func(s *MeetingService, _ db.Meeting) { s.SetFlags(nil) },
		"not enabled": func(s *MeetingService, _ db.Meeting) { s.rt.ScribeEnabled = false },
		"no minutes":  func(s *MeetingService, m db.Meeting) { setTranscriptionQuota(t, s, m.OrganizationID, 0) },
		"switched off": func(s *MeetingService, m db.Meeting) {
			if _, err := s.q.SetMeetingScribeOff(ctx, db.SetMeetingScribeOffParams{ID: m.ID, Off: true, By: "x"}); err != nil {
				t.Fatal(err)
			}
		},
	}
	for name, setup := range cases {
		t.Run(name, func(t *testing.T) {
			s, fake, _, m := scribeFixture(t)
			setup(s, m)
			if err := s.ensureScribe(ctx, m.ID); err != nil {
				t.Fatal(err)
			}
			if d, _ := fake.ScribeCalls(); d != 0 {
				t.Fatalf("dispatched %d times", d)
			}
			if _, err := s.q.GetLatestScribeRun(ctx, m.ID); err == nil {
				t.Fatal("a run was opened")
			}
		})
	}
	t.Run("all conditions hold", func(t *testing.T) {
		s, fake, _, m := scribeFixture(t)
		if err := s.ensureScribe(ctx, m.ID); err != nil {
			t.Fatal(err)
		}
		r := latestRun(t, s, m.ID)
		c := claimsOf(t, s, fake)
		if r.Status != ScribeDispatched || r.DispatchID != "fake-dispatch-1" || c.RunID != r.ID || c.OrganizationID != m.OrganizationID || r.CreatedByKind != "system" {
			t.Fatalf("run %+v claims %+v", r, c)
		}
		if !c.ExpiresAt.After(m.EndsAt.Time.Add(4*time.Hour - time.Minute)) {
			t.Fatalf("token expires %v, meeting ends %v", c.ExpiresAt, m.EndsAt.Time)
		}
		// A second pass with the run open sends nothing.
		if err := s.ensureScribe(ctx, m.ID); err != nil {
			t.Fatal(err)
		}
		if d, _ := fake.ScribeCalls(); d != 1 {
			t.Fatalf("dispatched %d times", d)
		}
	})
}

func TestEnsureScribeConcurrentCallsDispatchOnce(t *testing.T) {
	s, fake, _, m := scribeFixture(t)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.ensureScribeNow(context.Background(), m.ID, false)
		}()
	}
	wg.Wait()
	if d, _ := fake.ScribeCalls(); d != 1 {
		t.Fatalf("dispatched %d times, want 1", d)
	}
}

func TestEnsureScribeRoomEmptiesThenRefills(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	c := claimsOf(t, s, fake)
	if err := s.AgentStarted(ctx, c, "PA_agent1"); err != nil {
		t.Fatal(err)
	}
	first := latestRun(t, s, m.ID)
	if first.Status != ScribeActive || !first.StartedAt.Valid {
		t.Fatalf("after started: %+v", first)
	}
	// Left a moment ago: not yet empty long enough to close the run.
	leaveRoom(t, s, m, 10*time.Second)
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.Status != ScribeActive {
		t.Fatalf("closed too early: %+v", r)
	}
	ageRunAttendance(t, s, m, 2*time.Minute)
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.ID != first.ID || r.Status != ScribeFinished || r.Failures != 0 {
		t.Fatalf("emptied room: %+v", r)
	}
	joinRoom(t, s, m, ua.ID)
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	second := latestRun(t, s, m.ID)
	if second.ID == first.ID || second.Status != ScribeDispatched || second.Failures != 0 {
		t.Fatalf("refilled room: %+v", second)
	}
	if d, _ := fake.ScribeCalls(); d != 2 {
		t.Fatalf("dispatched %d times, want 2", d)
	}
	// The first run's token no longer starts anything.
	if err := s.AgentStarted(ctx, c, "PA_agent1"); !isInvalidMeetingState(err) {
		t.Fatalf("stale run started: %v", err)
	}
}

func ageRunAttendance(t *testing.T, s *MeetingService, m db.Meeting, ago time.Duration) {
	t.Helper()
	if _, err := s.pool.Exec(context.Background(),
		`UPDATE meeting_attendance_sessions SET left_at = now() - make_interval(secs => $2) WHERE meeting_id = $1`, m.ID, ago.Seconds()); err != nil {
		t.Fatal(err)
	}
}

func TestEnsureScribeFailsAfterThreeMisses(t *testing.T) {
	s, fake, _, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	run := latestRun(t, s, m.ID)
	// Not ACTIVE within 60 s, but within the minute nothing is counted.
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.Failures != 0 {
		t.Fatalf("counted a miss early: %+v", r)
	}
	for miss := int32(1); miss <= 3; miss++ {
		ageRun(t, s, run.ID, "dispatched_at", 61*time.Second)
		if err := s.ensureScribe(ctx, m.ID); err != nil {
			t.Fatal(err)
		}
		r := latestRun(t, s, m.ID)
		if r.ID != run.ID || r.Failures != miss {
			t.Fatalf("miss %d: %+v", miss, r)
		}
		if want := ScribeDispatched; miss == 3 {
			if r.Status != ScribeFailed || !r.FinishedAt.Valid {
				t.Fatalf("third miss: %+v", r)
			}
		} else if r.Status != want {
			t.Fatalf("miss %d: %+v", miss, r)
		}
	}
	dispatches, removals := fake.ScribeCalls()
	if dispatches != 3 || removals != 3 {
		t.Fatalf("dispatches=%d removals=%d, want 3 and 3", dispatches, removals)
	}
	// Failed: the sweep waits ten minutes before a new run.
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.ID != run.ID {
		t.Fatalf("retried inside the window: %+v", r)
	}
	ageRun(t, s, run.ID, "finished_at", 11*time.Minute)
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.ID == run.ID || r.Status != ScribeDispatched || r.Failures != 0 {
		t.Fatalf("retry after the window: %+v", r)
	}
}

func agentSeg(id string, identity string, at time.Time, speechMs int64) AgentSegmentInput {
	return AgentSegmentInput{
		SegmentID: id, ParticipantIdentity: identity, SpokenAt: at, EndedAt: at.Add(time.Duration(speechMs) * time.Millisecond),
		SpeechMs: speechMs, Text: "Chốt ship thứ Sáu " + id, Language: "vi",
	}
}

func TestAgentSegmentsDeduplicateAndMeter(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	c := claimsOf(t, s, fake)
	if err := s.AgentStarted(ctx, c, "PA_agent1"); err != nil {
		t.Fatal(err)
	}
	p, _ := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	identity := meetings.IdentityForParticipant(p.ID)
	at := m.ActualStartAt.Time.Add(5 * time.Second)
	batch := []AgentSegmentInput{agentSeg("TR1-1", identity, at, 40000), agentSeg("TR1-2", identity, at.Add(time.Minute), 40000)}
	accepted, dup, err := s.AppendAgentSegments(ctx, c, batch)
	if err != nil || accepted != 2 || dup != 0 {
		t.Fatalf("first batch: %d %d %v", accepted, dup, err)
	}
	accepted, dup, err = s.AppendAgentSegments(ctx, c, batch)
	if err != nil || accepted != 0 || dup != 2 {
		t.Fatalf("resent batch: %d %d %v", accepted, dup, err)
	}
	segs, err := s.Transcript(ctx, ua.ID, m.ID, FeedQuery{})
	if err != nil || len(segs.Items) != 2 {
		t.Fatalf("%d segments %v", len(segs.Items), err)
	}
	got := segs.Items[0]
	if got.Source != "AGENT" || got.SpeakerName != "A" || got.ParticipantID.String != p.ID || !got.StartMs.Valid || got.Language != "vi" {
		t.Fatalf("stored segment %+v", got)
	}
	r := latestRun(t, s, m.ID)
	if r.SpeechMs != 80000 || r.Segments != 2 || r.MeteredMs != 60000 {
		t.Fatalf("run while open: %+v", r)
	}
	if n := transcriptionMinutes(t, s, m.OrganizationID); n != 1 {
		t.Fatalf("metered %d minutes while open, want 1 (floor)", n)
	}
	if err := s.AgentFinished(ctx, c, 95000); err != nil {
		t.Fatal(err)
	}
	r = latestRun(t, s, m.ID)
	if r.Status != ScribeFinished || r.MeteredMs != 120000 || r.SttSessionMs != 95000 {
		t.Fatalf("run after finish: %+v", r)
	}
	if n := transcriptionMinutes(t, s, m.OrganizationID); n != 2 {
		t.Fatalf("metered %d minutes after finish, want 2 (ceiling)", n)
	}
	// Finished twice: nothing is metered again.
	if err := s.AgentFinished(ctx, c, 95000); err != nil {
		t.Fatal(err)
	}
	if n := transcriptionMinutes(t, s, m.OrganizationID); n != 2 {
		t.Fatalf("metered %d minutes after a second finish", n)
	}
}

func TestAgentSegmentsQuotaNeverCutsARunningMeeting(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	setTranscriptionQuota(t, s, m.OrganizationID, 1)
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	c := claimsOf(t, s, fake)
	p, _ := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	identity := meetings.IdentityForParticipant(p.ID)
	at := time.Now()
	for i, id := range []string{"a", "b", "c"} {
		if n, _, err := s.AppendAgentSegments(ctx, c, []AgentSegmentInput{agentSeg(id, identity, at.Add(time.Duration(i)*time.Minute), 60000)}); err != nil || n != 1 {
			t.Fatalf("segment %s past the quota: %d %v", id, n, err)
		}
	}
	if n := transcriptionMinutes(t, s, m.OrganizationID); n != 3 {
		t.Fatalf("metered %d minutes, want 3 (over the limit of 1)", n)
	}
	if err := s.AgentFinished(ctx, c, 0); err != nil {
		t.Fatal(err)
	}
	// The next run is refused: no minutes left.
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if d, _ := fake.ScribeCalls(); d != 1 {
		t.Fatalf("dispatched %d times after the quota ran out", d)
	}
}

func TestAgentCallsRefuseOtherClaims(t *testing.T) {
	s, fake, _, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	c := claimsOf(t, s, fake)
	for name, bad := range map[string]meetings.AgentClaims{
		"other organization": {MeetingID: c.MeetingID, OrganizationID: "01OTHERORG", RunID: c.RunID},
		"other run":          {MeetingID: c.MeetingID, OrganizationID: c.OrganizationID, RunID: "01OTHERRUN"},
		"other meeting":      {MeetingID: "01OTHERMEETING", OrganizationID: c.OrganizationID, RunID: c.RunID},
	} {
		if err := s.AgentStarted(ctx, bad, ""); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: started %v", name, err)
		}
		if _, err := s.AgentContext(ctx, bad); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: context %v", name, err)
		}
	}
	got, err := s.AgentContext(ctx, c)
	if err != nil || got.MeetingTitle != "Giao ban" || got.WorkspaceName != "Alpha" || len(got.ParticipantNames) != 1 || got.ParticipantNames[0] != "A" || got.Locale != "vi" {
		t.Fatalf("context %+v %v", got, err)
	}
}

func TestAgentSegmentsAfterEnd(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	c := claimsOf(t, s, fake)
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if n, _, err := s.AppendAgentSegments(ctx, c, []AgentSegmentInput{agentSeg("late-1", "uw_participant_x", time.Now(), 1000)}); err != nil || n != 1 {
		t.Fatalf("drain window: %d %v", n, err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET actual_end_at = now() - interval '11 minutes' WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.AppendAgentSegments(ctx, c, []AgentSegmentInput{agentSeg("late-2", "uw_participant_x", time.Now(), 1000)}); !isInvalidMeetingState(err) {
		t.Fatalf("after the drain window: %v", err)
	}
	// The sweep closes the ended meeting's open run and removes the agent.
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.Status != ScribeFinished {
		t.Fatalf("run of an ended meeting: %+v", r)
	}
	if _, removals := fake.ScribeCalls(); removals != 1 {
		t.Fatalf("removals %d", removals)
	}
}

func TestAgentSegmentsValidation(t *testing.T) {
	at := time.Now()
	long := make([]rune, 4001)
	for i := range long {
		long[i] = 'a'
	}
	many := make([]AgentSegmentInput, 51)
	for i := range many {
		many[i] = agentSeg("s", "", at, 0)
	}
	for name, segs := range map[string][]AgentSegmentInput{
		"none":         nil,
		"over 50":      many,
		"no id":        {agentSeg("", "", at, 0)},
		"long text":    {{SegmentID: "x", Text: string(long), SpokenAt: at, EndedAt: at}},
		"ends early":   {{SegmentID: "x", Text: "t", SpokenAt: at, EndedAt: at.Add(-time.Second)}},
		"neg speech":   {{SegmentID: "x", Text: "t", SpokenAt: at, EndedAt: at, SpeechMs: -1}},
		"no spoken_at": {{SegmentID: "x", Text: "t"}},
	} {
		var ve ValidationError
		if err := validateAgentSegments(segs); !errors.As(err, &ve) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestSetScribeSwitchesTheAgentMidMeeting(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	addMember(t, s, m.WorkspaceID, mustUserID(t, s, "b@example.com"))
	if _, err := s.SetScribe(ctx, mustUserID(t, s, "b@example.com"), m.ID, false); err == nil {
		t.Fatal("a non-host member switched the scribe off")
	}
	off, err := s.SetScribe(ctx, ua.ID, m.ID, false)
	if err != nil || !off.ScribeOffAt.Valid || off.ScribeOffBy.String != ua.ID {
		t.Fatalf("off: %+v %v", off, err)
	}
	if r := latestRun(t, s, m.ID); r.Status != ScribeFinished {
		t.Fatalf("run after switch-off: %+v", r)
	}
	if _, removals := fake.ScribeCalls(); removals != 1 {
		t.Fatalf("removals %d", removals)
	}
	var audited int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.scribe_toggled' AND resource_id = $1`, m.ID).Scan(&audited); err != nil || audited != 1 {
		t.Fatalf("audit rows %d %v", audited, err)
	}
	// Off again changes nothing and audits nothing.
	if _, err := s.SetScribe(ctx, ua.ID, m.ID, false); err != nil {
		t.Fatal(err)
	}
	on, err := s.SetScribe(ctx, ua.ID, m.ID, true)
	if err != nil || on.ScribeOffAt.Valid {
		t.Fatalf("on: %+v %v", on, err)
	}
	if d, _ := fake.ScribeCalls(); d != 2 {
		t.Fatalf("dispatches %d after switching back on", d)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.scribe_toggled' AND resource_id = $1`, m.ID).Scan(&audited); err != nil || audited != 2 {
		t.Fatalf("audit rows %d %v", audited, err)
	}
}

func mustUserID(t *testing.T, s *MeetingService, email string) string {
	t.Helper()
	u, err := s.q.GetUserByEmail(context.Background(), email)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}

func isInvalidMeetingState(err error) bool {
	var ce CodedError
	return errors.As(err, &ce) && ce.Code == "invalid_meeting_state"
}

func scribeLeftEvent(m db.Meeting, sid string) ProviderNeutralEvent {
	return ProviderNeutralEvent{
		Type: "conference.participant_left", RoomName: meetings.RoomNameForMeeting(m.ID),
		Identity: meetings.ScribeIdentity, ParticipantSID: sid, ProviderEventID: util.NewID(),
	}
}

// Review item 4: a job that dies without /agent/finished is closed by the
// participant_left webhook of its own connection, as a normal end; the next
// sweep dispatches again. The leave of another connection (an agent a
// duplicate replaced) closes nothing.
func TestScribeAgentLeftClosesItsRun(t *testing.T) {
	s, fake, _, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	c := claimsOf(t, s, fake)
	if err := s.AgentStarted(ctx, c, "PA_agent1"); err != nil {
		t.Fatal(err)
	}
	if err := s.HandleProviderEvent(ctx, scribeLeftEvent(m, "PA_replaced")); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.Status != ScribeActive {
		t.Fatalf("another connection's leave closed the run: %+v", r)
	}
	if err := s.HandleProviderEvent(ctx, scribeLeftEvent(m, "PA_agent1")); err != nil {
		t.Fatal(err)
	}
	first := latestRun(t, s, m.ID)
	if first.Status != ScribeFinished || first.Failures != 0 {
		t.Fatalf("after the agent left: %+v", first)
	}
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.ID == first.ID || r.Status != ScribeDispatched {
		t.Fatalf("no redispatch after the agent left: %+v", r)
	}
}

// Review item 13: switching the scribe back on asks for it now, inside the
// ten-minute wait after a FAILED run.
func TestSetScribeOnSkipsTheFailedRetryWait(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	run := latestRun(t, s, m.ID)
	if _, err := s.pool.Exec(ctx, `UPDATE meeting_scribe_runs SET status = 'FAILED', finished_at = now() WHERE id = $1`, run.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if d, _ := fake.ScribeCalls(); d != 1 {
		t.Fatalf("the sweep retried inside the wait: %d dispatches", d)
	}
	if _, err := s.SetScribe(ctx, ua.ID, m.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetScribe(ctx, ua.ID, m.ID, true); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.ID == run.ID || r.Status != ScribeDispatched {
		t.Fatalf("switching on did not dispatch: %+v", r)
	}
}

// Review item 14: with MEETING_SCRIBE_ENABLED off, the sweep still closes an
// open run and takes its agent out of the room, and dispatches nothing.
func TestSweepWithScribeDisabledClosesOpenRuns(t *testing.T) {
	s, fake, _, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	s.rt.ScribeEnabled = false
	if err := s.sweepScribes(ctx); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.Status != ScribeFinished {
		t.Fatalf("open run with the scribe disabled: %+v", r)
	}
	dispatches, removals := fake.ScribeCalls()
	if dispatches != 1 || removals != 1 {
		t.Fatalf("dispatches=%d removals=%d", dispatches, removals)
	}
}

// Review R2 M1: the sweep is the only dispatcher once a room fills after
// Start, so it pages through every meeting it must look at, not the first
// batch only.
func TestSweepPagesThroughEveryMeeting(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	prev := scribeSweepBatch
	scribeSweepBatch = 2
	t.Cleanup(func() { scribeSweepBatch = prev })
	ids := []string{m.ID}
	for range 4 {
		other, err := s.CreateInstant(ctx, ua.ID, m.WorkspaceID, "Giao ban")
		if err != nil {
			t.Fatal(err)
		}
		joinRoom(t, s, other, ua.ID)
		ids = append(ids, other.ID)
	}
	if err := s.sweepScribes(ctx); err != nil {
		t.Fatal(err)
	}
	if d, _ := fake.ScribeCalls(); d != len(ids) {
		t.Fatalf("dispatches = %d, want %d", d, len(ids))
	}
	for _, id := range ids {
		if r := latestRun(t, s, id); r.Status != ScribeDispatched {
			t.Fatalf("meeting %s: %+v", id, r)
		}
	}
}
