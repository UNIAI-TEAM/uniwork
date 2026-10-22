package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"

	"github.com/unicomhub/uniwork/server/internal/meetings"
)

// startedRun dispatches the agent into the fixture's meeting and marks it
// ACTIVE, returning the run's claims.
func startedRun(t *testing.T, s *MeetingService, fake *meetings.FakeProvider, m db.Meeting) meetings.AgentClaims {
	t.Helper()
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	c := claimsOf(t, s, fake)
	if err := s.AgentStarted(ctx, c, "PA_agent1"); err != nil {
		t.Fatal(err)
	}
	return c
}

func hostIdentity(t *testing.T, s *MeetingService, m db.Meeting, userID string) string {
	t.Helper()
	p, err := s.q.GetActiveUserParticipant(context.Background(), db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(userID)})
	if err != nil {
		t.Fatal(err)
	}
	return meetings.IdentityForParticipant(p.ID)
}

// Benchmark #25: the token is bounded by the run, not by the schedule. It
// carries a 24 h hard cap, works while the run is open and for the drain
// window after it closed, and is refused (404) after that.
func TestAgentTokenLivesWithTheRun(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	c := startedRun(t, s, fake, m)
	if d := time.Until(c.ExpiresAt); d < scribeTokenMaxAge-time.Minute || d > scribeTokenMaxAge+time.Minute {
		t.Fatalf("token expires in %v, want the %v cap", d, scribeTokenMaxAge)
	}
	identity := hostIdentity(t, s, m, ua.ID)
	run := latestRun(t, s, m.ID)
	closed, err := s.finishScribeRun(ctx, run.ID, 0)
	if err != nil || !closed {
		t.Fatalf("close: %v %v", closed, err)
	}
	finished := latestRun(t, s, m.ID).FinishedAt.Time
	// Inside the drain window: what was said before the run closed lands,
	// what was said after it never does.
	accepted, _, err := s.AppendAgentSegments(ctx, c, []AgentSegmentInput{
		agentSeg("drain-1", identity, finished.Add(-5*time.Second), 1000),
		agentSeg("drain-2", identity, finished.Add(2*time.Second), 1000),
	})
	if err != nil || accepted != 1 {
		t.Fatalf("drain window: accepted %d, %v", accepted, err)
	}
	ageRun(t, s, run.ID, "finished_at", agentDrainWindow+time.Minute)
	if _, _, err := s.AppendAgentSegments(ctx, c, []AgentSegmentInput{agentSeg("late", identity, time.Now().Add(-time.Hour), 1000)}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("closed run past its drain window: %v", err)
	}
	if err := s.AgentStarted(ctx, c, "PA_agent1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("started on a long-closed run: %v", err)
	}
}

// Benchmark #25 / trust-7: switching the scribe off closes the run in the
// same transaction, and the run's close is the cut-off. Switching it back on
// clears the meeting's scribe_off_at, yet a late batch of the old agent with
// speech from the off window is still dropped.
func TestScribePauseStaysDurableAfterSwitchingBackOn(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	old := startedRun(t, s, fake, m)
	identity := hostIdentity(t, s, m, ua.ID)
	off, err := s.SetScribe(ctx, ua.ID, m.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	r := latestRun(t, s, m.ID)
	if r.ID != old.RunID || r.Status != ScribeFinished || r.FinishedAt.Time.After(off.ScribeOffAt.Time) {
		t.Fatalf("run after the switch-off: %+v, off at %v", r, off.ScribeOffAt.Time)
	}
	if _, err := s.SetScribe(ctx, ua.ID, m.ID, true); err != nil {
		t.Fatal(err)
	}
	if fresh := latestRun(t, s, m.ID); fresh.ID == old.RunID || fresh.Status != ScribeDispatched {
		t.Fatalf("switching back on: %+v", fresh)
	}
	if _, _, err := s.AppendAgentSegments(ctx, old, []AgentSegmentInput{agentSeg("paused", identity, off.ScribeOffAt.Time.Add(time.Second), 1000)}); !isInvalidMeetingState(err) {
		t.Fatalf("speech from the off window: %v", err)
	}
	if n, _, err := s.AppendAgentSegments(ctx, old, []AgentSegmentInput{agentSeg("before", identity, off.ScribeOffAt.Time.Add(-10*time.Second), 1000)}); err != nil || n != 1 {
		t.Fatalf("speech from before the switch-off: %d %v", n, err)
	}
}

// Benchmark #13: a dispatch no worker took (no capacity at the 9:00 peak) is
// not a miss: the run stays DISPATCHED and is sent again, so it never sits
// out the 10-minute FAILED wait. A dispatch a worker took and never started is.
func TestScribeMissWaitsForWorkerCapacity(t *testing.T) {
	s, fake, _, m := scribeFixture(t)
	ctx := context.Background()
	fake.ScribeUnassigned = true
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	run := latestRun(t, s, m.ID)
	for i := 0; i < scribeMaxFailures+1; i++ {
		ageRun(t, s, run.ID, "dispatched_at", scribeActiveDeadline+time.Second)
		if err := s.ensureScribe(ctx, m.ID); err != nil {
			t.Fatal(err)
		}
		if r := latestRun(t, s, m.ID); r.ID != run.ID || r.Status != ScribeDispatched || r.Failures != 0 {
			t.Fatalf("pass %d without capacity: %+v", i, r)
		}
	}
	if d, removals := fake.ScribeCalls(); d != scribeMaxFailures+2 || removals != scribeMaxFailures+1 {
		t.Fatalf("dispatches=%d removals=%d", d, removals)
	}
	fake.ScribeUnassigned = false
	ageRun(t, s, run.ID, "dispatched_at", scribeActiveDeadline+time.Second)
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.Failures != 1 {
		t.Fatalf("a worker took it and never started: %+v", r)
	}
}

// A run that waited for capacity longer than scribeCapacityWait counts its
// misses again, so a provider that never reports jobs cannot keep a run
// DISPATCHED forever.
func TestScribeCapacityWaitIsBounded(t *testing.T) {
	s, fake, _, m := scribeFixture(t)
	ctx := context.Background()
	fake.ScribeUnassigned = true
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	run := latestRun(t, s, m.ID)
	ageRun(t, s, run.ID, "created_at", scribeCapacityWait+time.Minute)
	ageRun(t, s, run.ID, "dispatched_at", scribeActiveDeadline+time.Second)
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.Failures != 1 {
		t.Fatalf("past the capacity wait: %+v", r)
	}
}

type scribeRunMetrics struct {
	summaryMetrics
	mu             sync.Mutex
	active, silent int
	set            bool
}

func (m *scribeRunMetrics) SetScribeRuns(active, silent int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.active, m.silent, m.set = active, silent, true
}

// Benchmark #1: the sweep reports ACTIVE runs with people in the room, and
// those no segment reached for three minutes. One STT outage shows as many
// silent runs at once.
func TestSweepReportsSilentScribeRuns(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	met := &scribeRunMetrics{}
	s.SetMeetingMetrics(met)
	startedRun(t, s, fake, m)
	run := latestRun(t, s, m.ID)
	check := func(name string, active, silent int) {
		t.Helper()
		if err := s.sweepScribes(ctx); err != nil {
			t.Fatal(err)
		}
		met.mu.Lock()
		defer met.mu.Unlock()
		if !met.set || met.active != active || met.silent != silent {
			t.Fatalf("%s: active=%d silent=%d set=%v, want %d and %d", name, met.active, met.silent, met.set, active, silent)
		}
	}
	check("just started", 0, 0)
	ageRun(t, s, run.ID, "started_at", scribeSilentAfter+time.Minute)
	check("three minutes without a line", 1, 1)
	c := claimsOf(t, s, fake)
	if _, _, err := s.AppendAgentSegments(ctx, c, []AgentSegmentInput{agentSeg("s-1", hostIdentity(t, s, m, ua.ID), time.Now(), 1000)}); err != nil {
		t.Fatal(err)
	}
	check("a line arrived", 1, 0)
}
