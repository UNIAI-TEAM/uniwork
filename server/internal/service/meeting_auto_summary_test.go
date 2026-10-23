package service

import (
	"context"
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// autoSummaryReply is a model that always answers one valid summary and
// counts its calls.
func autoSummaryReply(calls *atomic.Int32) *provider.Fake {
	return &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		calls.Add(1)
		return provider.CompletionResponse{Text: `{"summary":"Chốt ship thứ Sáu.","decisions":[],"action_items":[]}`, Model: "fake"}
	}}
}

// autoQueue reads a meeting's queue row: due in how long from now, and
// whether there is one.
func autoQueue(t *testing.T, s *MeetingService, meetingID string) (time.Duration, bool) {
	t.Helper()
	var secs float64
	err := s.pool.QueryRow(context.Background(),
		`SELECT EXTRACT(EPOCH FROM due_at - now())::float8 FROM meeting_auto_summaries WHERE meeting_id = $1`, meetingID).Scan(&secs)
	if err != nil {
		return 0, false
	}
	return time.Duration(secs * float64(time.Second)), true
}

func makeAutoDue(t *testing.T, s *MeetingService, meetingID string) {
	t.Helper()
	if _, err := s.pool.Exec(context.Background(),
		`UPDATE meeting_auto_summaries SET due_at = now() - interval '1 second' WHERE meeting_id = $1`, meetingID); err != nil {
		t.Fatal(err)
	}
}

func outboxTopicCount(t *testing.T, s *MeetingService, topic, meetingID string) int {
	t.Helper()
	return countSummaryRows(t, s, `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'meeting_id' = $2`, topic, meetingID)
}

// §12.1: SummarizeAuto runs only on an ENDED meeting, as the system, and
// never over a summary somebody already made.
func TestSummarizeAutoOnlyWhenEnded(t *testing.T) {
	var calls atomic.Int32
	s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
	ctx := context.Background()
	if _, err := s.SummarizeAuto(ctx, m.ID); !errors.Is(err, errAutoSummaryNotDue) {
		t.Fatalf("in progress: err = %v, want not due", err)
	}
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	sum, err := s.SummarizeAuto(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sum.CreatedBy != "meeting_auto_summary" || sum.CreatedByKind != "system" {
		t.Fatalf("attribution = %s/%s, want system/meeting_auto_summary", sum.CreatedByKind, sum.CreatedBy)
	}
	var kind, actor string
	if err := s.pool.QueryRow(ctx, `SELECT actor_kind, actor_id FROM audit_events WHERE action = 'meeting.summary_created' AND resource_id = $1`, m.ID).Scan(&kind, &actor); err != nil {
		t.Fatal(err)
	}
	if kind != "system" || actor != "meeting_auto_summary" {
		t.Fatalf("audit actor = %s/%s", kind, actor)
	}
	if _, err := s.SummarizeAuto(ctx, m.ID); !errors.Is(err, errAutoSummaryNotDue) || calls.Load() != 1 {
		t.Fatalf("second run: err = %v, model calls = %d; the summary that exists stands", err, calls.Load())
	}
	// A clerk's own summary stays a person's.
	manual, err := s.Summarize(ctx, ua.ID, m.ID, "vi")
	if err != nil || manual.CreatedByKind != "human" || manual.CreatedBy != ua.ID {
		t.Fatalf("manual = %+v %v", manual, err)
	}
}

// §12.1: a clerk's run in flight holds the shared lease; the auto run is
// refused and pays nothing.
func TestSummarizeAutoSharesTheManualLease(t *testing.T) {
	var calls atomic.Int32
	s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
	ctx := context.Background()
	ended, err := s.End(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	release, err := s.claimSummaryRun(ctx, ended, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	var ce CodedError
	if _, err := s.SummarizeAuto(ctx, m.ID); !errors.As(err, &ce) || ce.Code != "summary_in_progress" {
		t.Fatalf("err = %v, want summary_in_progress", err)
	}
	if calls.Load() != 0 || countSummaryRows(t, s, `SELECT count(*) FROM meeting_summaries WHERE meeting_id = $1`, m.ID) != 0 {
		t.Fatal("the auto run paid or stored while a clerk's run held the lease")
	}
	// The worker settles such a row without a reminder: the clerk is on it.
	makeAutoDue(t, s, m.ID)
	if err := s.claimAutoSummaries(ctx); err != nil {
		t.Fatal(err)
	}
	if _, queued := autoQueue(t, s, m.ID); queued || outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID) != 0 {
		t.Fatalf("queued=%v reminders=%d", queued, outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID))
	}
	release(nil)
}

// §4.5: ending queues the meeting, 10 s out, or 90 s while a scribe run is
// open; the organization switch and a missing model leave it unqueued.
func TestEndQueuesTheAutoSummary(t *testing.T) {
	ctx := context.Background()
	t.Run("no scribe run", func(t *testing.T) {
		var calls atomic.Int32
		s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		due, ok := autoQueue(t, s, m.ID)
		if !ok || due < 8*time.Second || due > autoSummaryWait {
			t.Fatalf("due in %v (queued %v), want ~10s", due, ok)
		}
	})
	t.Run("scribe run open", func(t *testing.T) {
		var calls atomic.Int32
		s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
		if _, err := s.q.InsertScribeRun(ctx, db.InsertScribeRunParams{
			ID: util.NewID(), OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, MeetingID: m.ID,
			CreatedBy: scribeActor.ID, CreatedByKind: string(scribeActor.Kind),
		}); err != nil {
			t.Fatal(err)
		}
		ended, err := s.End(ctx, ua.ID, m.ID)
		if err != nil {
			t.Fatal(err)
		}
		due, ok := autoQueue(t, s, m.ID)
		if !ok || due < 85*time.Second || due > autoSummaryAgentWait {
			t.Fatalf("due in %v (queued %v), want ~90s", due, ok)
		}
		// The agent's /agent/finished pulls it in.
		s.hurryAutoSummary(ctx, ended)
		if due, _ := autoQueue(t, s, m.ID); due > 0 {
			t.Fatalf("after finished: due in %v, want now", due)
		}
	})
	t.Run("organization switched it off", func(t *testing.T) {
		var calls atomic.Int32
		s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
		if _, err := s.SetMeetingSettings(ctx, Human(ua.ID), m.OrganizationID, MeetingSettingsInput{AutoSummaryEnabled: new(false)}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		if _, ok := autoQueue(t, s, m.ID); ok {
			t.Fatal("queued with the switch off")
		}
	})
	t.Run("no model configured", func(t *testing.T) {
		s, ua, m, _ := summaryFixture(t, nil, ai.Options{})
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		if _, ok := autoQueue(t, s, m.ID); ok {
			t.Fatal("queued without a model")
		}
	})
}

// UNI-2001's "held" ends a meeting without endMeeting: it queues the auto
// summary the same way, behind the same switch.
func TestRecordHeldQueuesTheAutoSummary(t *testing.T) {
	ctx := context.Background()
	held := func(t *testing.T, s *MeetingService, ua db.User, m db.Meeting) db.Meeting {
		t.Helper()
		start := time.Now().Add(time.Hour).Truncate(time.Second)
		sched, err := s.Create(ctx, ua.ID, m.WorkspaceID, CreateMeetingInput{Title: "Họp trực tiếp", StartsAt: start, EndsAt: start.Add(time.Hour)})
		if err != nil {
			t.Fatal(err)
		}
		began := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
		if _, err := s.RecordHeld(ctx, ua.ID, sched.ID, began, began.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
		return sched
	}
	t.Run("queued", func(t *testing.T) {
		var calls atomic.Int32
		s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
		sched := held(t, s, ua, m)
		if due, ok := autoQueue(t, s, sched.ID); !ok || due > autoSummaryWait {
			t.Fatalf("due in %v (queued %v), want ~10s", due, ok)
		}
	})
	t.Run("organization switched it off", func(t *testing.T) {
		var calls atomic.Int32
		s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
		if _, err := s.SetMeetingSettings(ctx, Human(ua.ID), m.OrganizationID, MeetingSettingsInput{AutoSummaryEnabled: new(false)}); err != nil {
			t.Fatal(err)
		}
		if _, ok := autoQueue(t, s, held(t, s, ua, m).ID); ok {
			t.Fatal("queued with the switch off")
		}
	})
}

// A run that empties the room mid-meeting (D18) opens nothing: only an ended
// meeting's queue row is pulled in, and an in-progress meeting has none.
func TestAgentFinishedOfAMidMeetingRunOpensNothing(t *testing.T) {
	s, fake, _, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	c := claimsOf(t, s, fake)
	if err := s.AgentFinished(ctx, c, 0); err != nil {
		t.Fatal(err)
	}
	if _, ok := autoQueue(t, s, m.ID); ok {
		t.Fatal("a mid-meeting /agent/finished queued a summary")
	}
}

// The worker runs a due row once, deletes it, and sends no reminder on
// success; a failure deletes it and queues the reminder topic; a row whose
// node died too often is given up with the reminder and no model call.
func TestAutoSummaryWorker(t *testing.T) {
	ctx := context.Background()
	t.Run("success", func(t *testing.T) {
		var calls atomic.Int32
		s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		// Not due yet: nothing runs.
		if err := s.claimAutoSummaries(ctx); err != nil || calls.Load() != 0 {
			t.Fatalf("ran before due: calls=%d err=%v", calls.Load(), err)
		}
		makeAutoDue(t, s, m.ID)
		if err := s.claimAutoSummaries(ctx); err != nil {
			t.Fatal(err)
		}
		sum, err := s.q.GetLatestMeetingSummary(ctx, m.ID)
		if err != nil || sum.CreatedByKind != "system" || calls.Load() != 1 {
			t.Fatalf("summary %+v err %v calls %d", sum, err, calls.Load())
		}
		if _, queued := autoQueue(t, s, m.ID); queued {
			t.Fatal("row left after success")
		}
		if n := outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID); n != 0 {
			t.Fatalf("reminder topic after success: %d", n)
		}
		if n := outboxTopicCount(t, s, "summary.created", m.ID); n != 1 {
			t.Fatalf("summary.created rows = %d", n)
		}
	})
	// A failure that passes is retried (TestAutoSummaryRetriesWhatPasses);
	// a billed answer that does not parse is not.
	t.Run("failure", func(t *testing.T) {
		s, ua, m, _ := summaryFixture(t, &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
			return provider.CompletionResponse{Text: "not json"}
		}}, ai.Options{})
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		makeAutoDue(t, s, m.ID)
		if err := s.claimAutoSummaries(ctx); err != nil {
			t.Fatal(err)
		}
		if _, queued := autoQueue(t, s, m.ID); queued {
			t.Fatal("row left after failure")
		}
		if n := outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID); n != 1 {
			t.Fatalf("reminder topic rows = %d, want 1", n)
		}
	})
	t.Run("switched off after queueing", func(t *testing.T) {
		var calls atomic.Int32
		s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := s.SetMeetingSettings(ctx, Human(ua.ID), m.OrganizationID, MeetingSettingsInput{AutoSummaryEnabled: new(false)}); err != nil {
			t.Fatal(err)
		}
		makeAutoDue(t, s, m.ID)
		if err := s.claimAutoSummaries(ctx); err != nil {
			t.Fatal(err)
		}
		if calls.Load() != 0 || outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID) != 1 {
			t.Fatalf("calls=%d reminders=%d, want 0 and 1", calls.Load(), outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID))
		}
	})
	t.Run("attempts exhausted", func(t *testing.T) {
		var calls atomic.Int32
		s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := s.pool.Exec(ctx, `UPDATE meeting_auto_summaries SET attempts = $2 WHERE meeting_id = $1`, m.ID, autoSummaryMaxAttempts); err != nil {
			t.Fatal(err)
		}
		makeAutoDue(t, s, m.ID)
		if err := s.claimAutoSummaries(ctx); err != nil {
			t.Fatal(err)
		}
		if calls.Load() != 0 || outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID) != 1 {
			t.Fatalf("calls=%d reminders=%d", calls.Load(), outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID))
		}
	})
	t.Run("a held lease is not claimed twice", func(t *testing.T) {
		var calls atomic.Int32
		s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		makeAutoDue(t, s, m.ID)
		row, err := s.q.ClaimMeetingAutoSummary(ctx, 60)
		if err != nil || row.MeetingID != m.ID || row.Attempts != 1 {
			t.Fatalf("claim = %+v %v", row, err)
		}
		if err := s.claimAutoSummaries(ctx); err != nil || calls.Load() != 0 {
			t.Fatalf("a second node ran a leased row: calls=%d err=%v", calls.Load(), err)
		}
	})
}

// The organization switch: owner/admin only, default on, audited on change.
func TestMeetingSettingsSwitch(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	set, err := s.GetMeetingSettings(ctx, Human(ua.ID), w.OrganizationID)
	if err != nil || !set.AutoSummaryEnabled {
		t.Fatalf("default = %+v %v, want on", set, err)
	}
	if _, err := s.GetMeetingSettings(ctx, Human(ub.ID), w.OrganizationID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member read: %v, want not found", err)
	}
	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	if _, err := s.SetMeetingSettings(ctx, Human(ub.ID), w.OrganizationID, MeetingSettingsInput{AutoSummaryEnabled: new(false)}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member write: %v, want forbidden", err)
	}
	set, err = s.SetMeetingSettings(ctx, Human(ua.ID), w.OrganizationID, MeetingSettingsInput{AutoSummaryEnabled: new(false)})
	if err != nil || set.AutoSummaryEnabled || set.UpdatedBy != ua.ID {
		t.Fatalf("owner write = %+v %v", set, err)
	}
	if _, err := s.SetMeetingSettings(ctx, Human(ua.ID), w.OrganizationID, MeetingSettingsInput{AutoSummaryEnabled: new(false)}); err != nil {
		t.Fatal(err)
	}
	if n := countSummaryRows(t, s, `SELECT count(*) FROM audit_events WHERE action = 'meeting.settings_changed' AND organization_id = $1`, w.OrganizationID); n != 1 {
		t.Fatalf("audit rows = %d, want 1 (a write that changes nothing is not audited)", n)
	}
	if set, err := s.GetMeetingSettings(ctx, Human(ua.ID), w.OrganizationID); err != nil || set.AutoSummaryEnabled {
		t.Fatalf("read back = %+v %v", set, err)
	}
}

// Fix round 1 (review): every claimer is its own loop, so a meeting that falls
// due while another meeting's summary is still running does not wait for it.
func TestAutoSummaryClaimersDoNotWaitForEachOther(t *testing.T) {
	release := make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	var calls atomic.Int32
	fake := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		if calls.Add(1) == 1 {
			<-release // the first meeting's model call hangs
		}
		return provider.CompletionResponse{Text: `{"summary":"Chốt.","decisions":[],"action_items":[]}`, Model: "fake"}
	}}
	s, ua, m1, _ := summaryFixture(t, fake, ai.Options{Timeout: 2 * time.Minute})
	ctx := context.Background()
	m2, err := s.CreateInstant(ctx, ua.ID, m1.WorkspaceID, "Họp thứ hai")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendTranscript(ctx, ua.ID, m2.ID, "Chốt lịch", time.Time{}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{m1.ID, m2.ID} {
		if _, err := s.End(ctx, ua.ID, id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.pool.Exec(ctx, `UPDATE meeting_auto_summaries SET due_at = now() + interval '1 hour' WHERE meeting_id = $1`, m2.ID); err != nil {
		t.Fatal(err)
	}
	makeAutoDue(t, s, m1.ID)
	wctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { s.RunWorkers(wctx); close(done) }()
	defer func() { cancel(); once.Do(func() { close(release) }); <-done }()

	waitFor := func(what string, cond func() bool) {
		t.Helper()
		for deadline := time.Now().Add(30 * time.Second); !cond(); time.Sleep(200 * time.Millisecond) {
			if time.Now().After(deadline) {
				t.Fatalf("timed out waiting for %s", what)
			}
		}
	}
	waitFor("the first run to start", func() bool { return calls.Load() >= 1 })
	makeAutoDue(t, s, m2.ID) // falls due while the first run hangs
	waitFor("the second meeting's summary", func() bool {
		_, err := s.q.GetLatestMeetingSummary(ctx, m2.ID)
		return err == nil
	})
	if _, err := s.q.GetLatestMeetingSummary(ctx, m1.ID); err == nil {
		t.Fatal("the first run finished before it was released")
	}
}

// Fix round 1: a meeting with nothing to summarize settles quietly - no
// reminder topic, no failure counted.
func TestAutoSummaryWithoutSourceSettlesQuietly(t *testing.T) {
	var calls atomic.Int32
	s, ua, m1, met := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
	ctx := context.Background()
	empty, err := s.CreateInstant(ctx, ua.ID, m1.WorkspaceID, "Họp trống")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.End(ctx, ua.ID, empty.ID); err != nil {
		t.Fatal(err)
	}
	makeAutoDue(t, s, empty.ID)
	if err := s.claimAutoSummaries(ctx); err != nil {
		t.Fatal(err)
	}
	if _, queued := autoQueue(t, s, empty.ID); queued {
		t.Fatal("row left")
	}
	if n := outboxTopicCount(t, s, topicAutoSummaryFailed, empty.ID); n != 0 {
		t.Fatalf("reminder topic rows = %d, want 0", n)
	}
	met.mu.Lock()
	defer met.mu.Unlock()
	if slices.Contains(met.events, "auto_summary_failed") || calls.Load() != 0 {
		t.Fatalf("events %v, model calls %d", met.events, calls.Load())
	}
}

// Fix round 1: an error that is not a refusal (here the settings table cannot
// be read) leaves the row for the next claim once its lease lapses; no
// reminder is sent and the next attempt makes the summary.
func TestAutoSummaryTransientErrorRetries(t *testing.T) {
	var calls atomic.Int32
	s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
	ctx := context.Background()
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	makeAutoDue(t, s, m.ID)
	if _, err := s.pool.Exec(ctx, `ALTER TABLE meeting_settings RENAME TO meeting_settings_gone`); err != nil {
		t.Fatal(err)
	}
	restored := false
	restore := func() {
		if !restored {
			restored = true
			if _, err := s.pool.Exec(context.Background(), `ALTER TABLE meeting_settings_gone RENAME TO meeting_settings`); err != nil {
				t.Error(err)
			}
		}
	}
	t.Cleanup(restore)
	if err := s.claimAutoSummaries(ctx); err == nil {
		t.Fatal("a failed read reported no error")
	}
	var attempts int32
	if err := s.pool.QueryRow(ctx, `SELECT attempts FROM meeting_auto_summaries WHERE meeting_id = $1`, m.ID).Scan(&attempts); err != nil || attempts != 1 {
		t.Fatalf("row after a transient error: attempts=%d err=%v, want it kept", attempts, err)
	}
	if n := outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID); n != 0 {
		t.Fatalf("reminder sent on a transient error: %d", n)
	}
	restore()
	// The lease lapses; the next claim makes the summary.
	if _, err := s.pool.Exec(ctx, `UPDATE meeting_auto_summaries SET lease_until = now() - interval '1 second' WHERE meeting_id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.claimAutoSummaries(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.GetLatestMeetingSummary(ctx, m.ID); err != nil || calls.Load() != 1 {
		t.Fatalf("retry: err=%v calls=%d", err, calls.Load())
	}
}

// heldWithUploads: a meeting held in person, in the transcription fixture's
// workspace, with a model that summarizes, and a way to transcribe one
// uploaded recording of it to the end.
func heldWithUploads(t *testing.T) (transcriptionEnv, db.Meeting, *atomic.Int32, func()) {
	t.Helper()
	e := transcriptionFixture(t)
	s, ctx := e.s, context.Background()
	calls := &atomic.Int32{}
	s.AI = ai.NewGateway(s.q, autoSummaryReply(calls), NewAIQuota(s.ent), nil, ai.Options{Cloud: ai.CloudTools{MeetingTranscriber: e.vendor}})
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	m, err := s.Create(ctx, e.host.ID, e.m.WorkspaceID, CreateMeetingInput{Title: "Họp chi bộ tháng", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	began := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	if m, err = s.RecordHeld(ctx, e.host.ID, m.ID, began, began.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	transcribe := func() {
		t.Helper()
		if _, err := s.RequestTranscription(ctx, e.host.ID, m.ID, TranscriptionRequest{UploadID: e.uploadFor(t, m, e.host.ID, "hop.mp3", mp3(60, util.NewID())), Consent: true}); err != nil {
			t.Fatal(err)
		}
		for range 2 { // submit, then the poll that completes it
			if err := s.runTranscriptions(ctx); err != nil {
				t.Fatal(err)
			}
			due(t, s, m.ID)
		}
	}
	return e, m, calls, transcribe
}

// Fix round 1 follow-up: a held meeting's auto summary settles with nothing
// to read; its uploaded recording, once transcribed, queues it again. Once a
// summary exists, a further upload queues nothing.
func TestCompletedUploadQueuesTheAutoSummary(t *testing.T) {
	e, m, calls, transcribe := heldWithUploads(t)
	s, ctx := e.s, context.Background()
	makeAutoDue(t, s, m.ID)
	if err := s.claimAutoSummaries(ctx); err != nil {
		t.Fatal(err)
	}
	if _, queued := autoQueue(t, s, m.ID); queued || calls.Load() != 0 || outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID) != 0 {
		t.Fatalf("held run: queued=%v calls=%d; with no source it settles quietly", queued, calls.Load())
	}
	transcribe()
	if due, ok := autoQueue(t, s, m.ID); !ok || due > autoSummaryWait {
		t.Fatalf("after the upload: due in %v (queued %v)", due, ok)
	}
	makeAutoDue(t, s, m.ID)
	if err := s.claimAutoSummaries(ctx); err != nil {
		t.Fatal(err)
	}
	sum, err := s.q.GetLatestMeetingSummary(ctx, m.ID)
	if err != nil || sum.CreatedByKind != "system" || calls.Load() != 1 {
		t.Fatalf("summary = %+v %v, calls %d", sum, err, calls.Load())
	}
	transcribe()
	if _, queued := autoQueue(t, s, m.ID); queued {
		t.Fatal("a second upload queued a summary over the one that exists")
	}
}

// The upload completes while the held meeting's run holds its row (about to
// settle as no source): the row is due again and free, and the old holder's
// settle no longer deletes it.
func TestCompletedUploadRequeuesALeasedRow(t *testing.T) {
	e, m, calls, transcribe := heldWithUploads(t)
	s, ctx := e.s, context.Background()
	makeAutoDue(t, s, m.ID)
	held, err := s.q.ClaimMeetingAutoSummary(ctx, 60)
	if err != nil || held.MeetingID != m.ID {
		t.Fatalf("claim = %+v %v", held, err)
	}
	transcribe()
	if err := s.settleAutoSummary(ctx, held, m, false); err != nil {
		t.Fatal(err)
	}
	if due, ok := autoQueue(t, s, m.ID); !ok || due > autoSummaryWait {
		t.Fatalf("the old holder's settle removed the requeued row: due in %v (queued %v)", due, ok)
	}
	makeAutoDue(t, s, m.ID)
	if err := s.claimAutoSummaries(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.GetLatestMeetingSummary(ctx, m.ID); err != nil || calls.Load() != 1 {
		t.Fatalf("no summary after the requeue: %v, calls %d", err, calls.Load())
	}
}

// A clerk's summary stored between summarizeAuto's read and the lease claim
// still stands: summarize reads again once it holds the lease.
func TestAutoSummaryRechecksAClerkSummaryInsideTheLease(t *testing.T) {
	var calls atomic.Int32
	s, ua, m, _ := summaryFixture(t, autoSummaryReply(&calls), ai.Options{})
	ctx := context.Background()
	ended, err := s.End(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Summarize(ctx, ua.ID, m.ID, "vi"); err != nil {
		t.Fatal(err)
	}
	before := calls.Load()
	if _, err := s.summarize(ctx, ended, autoSummaryActor, autoSummaryLocale); !errors.Is(err, errAutoSummaryNotDue) {
		t.Fatalf("err = %v, want not due", err)
	}
	if calls.Load() != before {
		t.Fatal("the auto run paid the model over a clerk's summary")
	}
}
