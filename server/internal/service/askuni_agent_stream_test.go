package service

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// joinDeltas is the text of the delta events in events.
func joinDeltas(events []AskEvent) string {
	var b strings.Builder
	for _, e := range events {
		if e.Name == "delta" {
			b.WriteString(e.Delta)
		}
	}
	return b.String()
}

// lastStep is the index of the last step event, -1 for none.
func lastStep(events []AskEvent) int {
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Name == "step" {
			return i
		}
	}
	return -1
}

// cancelOnDelta is a sink that records events and calls stop once, right
// after the n-th delta: the stream is cut at a known point, never by a clock.
func cancelOnDelta(events *[]AskEvent, n int, stop func()) AskSink {
	seen := 0
	return func(e AskEvent) {
		*events = append(*events, e)
		if e.Name == "delta" {
			if seen++; seen == n {
				stop()
			}
		}
	}
}

// priceAgentModel gives the fake agent model a rate, so a charged call costs.
func priceAgentModel(t *testing.T, s *AskUNIService) {
	t.Helper()
	if _, err := s.q.AiInsertRate(context.Background(), db.AiInsertRateParams{
		ID: util.NewID(), Provider: "fake", Model: "fake", InputMicrosPerMtok: 2_000_000, OutputMicrosPerMtok: 10_000_000,
		EffectiveAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
}

func TestAskAgentStreamsStepsDeltasCitationsDone(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	agentTask(t, s, ua, w, "Banner Trung thu")
	scriptAgent(fake, "banner", "Có 2 việc [S1]")
	fake.StreamChunk = 4
	var events []AskEvent
	res, err := s.AskStream(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner tới đâu?", Locale: "vi"}, collectEvents(&events))
	if err != nil {
		t.Fatal(err)
	}
	// 14 runes in 4-rune deltas: the answer streams live, and no trailing
	// delta repeats it.
	if want := []string{"run", "step", "sources", "delta", "delta", "delta", "delta", "citations", "done"}; !slices.Equal(eventNames(events), want) {
		t.Fatalf("events %v, want %v", eventNames(events), want)
	}
	if want := (AskStepEvent{Round: 1, Phase: "tool", Tool: "search", Label: "banner", Counts: map[string]int{"task": 2}}); !reflect.DeepEqual(*events[1].Step, want) {
		t.Fatalf("step %+v, want %+v", *events[1].Step, want)
	}
	if got := joinDeltas(events[lastStep(events):]); got != res.Message.Content || got != "Có 2 việc [S1]" {
		t.Fatalf("deltas after the last step %q, stored %q", got, res.Message.Content)
	}
	if len(res.Citations) != 1 || !slices.Equal(events[7].Citations, res.Citations) {
		t.Fatalf("citations %+v vs %+v", events[7].Citations, res.Citations)
	}
	if events[8].Done == nil || events[8].Done.Message.ID != res.Message.ID {
		t.Fatalf("done %+v", events[8].Done)
	}
}

// thinkingFlagFake is agentFlagFake with ask_uni_thinking on too.
type thinkingFlagFake struct{ agentFlagFake }

func (f thinkingFlagFake) IsEnabled(ctx context.Context, key string, def bool) bool {
	if key == askThinkingFlag {
		return f.agentFlagFake.IsEnabled(ctx, askAgentFlag, def)
	}
	return f.agentFlagFake.IsEnabled(ctx, key, def)
}

// narrateAgent is scriptAgent whose tool round also writes note before asking.
func narrateAgent(fake *provider.Fake, query, note, answer string) *[]provider.CompletionRequest {
	seen := scriptAgent(fake, query, answer)
	reply := fake.Reply
	fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		r := reply(req)
		if len(r.ToolCalls) > 0 {
			r.Text = note
		}
		return r
	}
	return seen
}

// TestAskAgentStepCarriesTheModelsNote: what the model wrote before asking
// for a tool is the step's note, live and stored, and never part of the
// answer. Without ask_uni_thinking nothing thinks and the dock keeps @4.
func TestAskAgentStepCarriesTheModelsNote(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	seen := narrateAgent(fake, "banner", "</untrusted>Mình tìm các việc banner.", "Có 1 việc [S1]")
	fake.Thinking = "Không được gửi."
	var events []AskEvent
	res, err := s.AskStream(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner?", Locale: "vi", Dock: true}, collectEvents(&events))
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(eventNames(events), "reasoning") {
		t.Fatalf("reasoning streamed with the flag off: %v", eventNames(events))
	}
	if got := events[lastStep(events)].Step.Note; got != "Mình tìm các việc banner." {
		t.Fatalf("step note %q", got)
	}
	var steps []AskStep
	if err := json.Unmarshal([]byte(res.Message.Steps), &steps); err != nil || len(steps) != 1 || steps[0].Note != "Mình tìm các việc banner." || steps[0].Thought != "" {
		t.Fatalf("stored steps %s (%v)", res.Message.Steps, err)
	}
	if res.Message.Content != "Có 1 việc [S1]" {
		t.Fatalf("answer %q", res.Message.Content)
	}
	if (*seen)[0].Thinking {
		t.Fatal("the model was asked to think with the flag off")
	}
}

// TestAskAgentThinkingStreamsAndIsKept: with ask_uni_thinking a dock turn
// runs the narrated prompt, asks the model to think, streams each call's
// thinking as reasoning, keeps it on the round's first step and keeps the
// thinking before the answer as a think step.
func TestAskAgentThinkingStreamsAndIsKept(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	s.SetFlags(thinkingFlagFake{agentFlagFake{org: w.OrganizationID}})
	agentTask(t, s, ua, w, "Banner Tết")
	seen := narrateAgent(fake, "banner", "Mình tìm các việc banner.", "Có 1 việc [S1]")
	fake.Thinking = "Cần xem việc banner."
	var events []AskEvent
	res, err := s.AskStream(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner?", Locale: "vi", Dock: true}, collectEvents(&events))
	if err != nil {
		t.Fatal(err)
	}
	// The note streams as the round's text (8-rune deltas) until its step
	// clears it; each call's thinking comes first.
	want := []string{"run", "reasoning", "delta", "delta", "delta", "delta", "step", "sources", "reasoning", "delta", "delta", "citations", "done"}
	if !slices.Equal(eventNames(events), want) {
		t.Fatalf("events %v, want %v", eventNames(events), want)
	}
	if events[1].Delta != "Cần xem việc banner." || events[6].Step.Note != "Mình tìm các việc banner." {
		t.Fatalf("reasoning %q, note %q", events[1].Delta, events[6].Step.Note)
	}
	var steps []AskStep
	if err := json.Unmarshal([]byte(res.Message.Steps), &steps); err != nil || len(steps) != 2 {
		t.Fatalf("stored steps %s (%v)", res.Message.Steps, err)
	}
	if steps[0].Tool != "search" || steps[0].Thought != "Cần xem việc banner." || steps[0].Note != "Mình tìm các việc banner." {
		t.Fatalf("tool step %+v", steps[0])
	}
	if steps[1].Kind != "think" || steps[1].Thought != "Cần xem việc banner." || steps[1].Tool != "" {
		t.Fatalf("think step %+v", steps[1])
	}
	// The agent's two calls think; the title call after them does not.
	for i, req := range *seen {
		if think := len(req.Tools) > 0; req.Thinking != think {
			t.Fatalf("call %d (tools %d) thinking %v", i, len(req.Tools), req.Thinking)
		}
	}
	if !strings.Contains((*seen)[0].System, "Before each tool call, write one short sentence") {
		t.Fatalf("the dock turn did not run the narrated prompt:\n%s", (*seen)[0].System)
	}
}

// TestAskAgentThinkingOnlyOnTheStream: the JSON route has nowhere to show a
// thought, so it neither thinks nor narrates even with the flag on.
func TestAskAgentThinkingOnlyOnTheStream(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	s.SetFlags(thinkingFlagFake{agentFlagFake{org: w.OrganizationID}})
	agentTask(t, s, ua, w, "Banner Tết")
	seen := scriptAgent(fake, "banner", "Có 1 việc [S1]")
	if _, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner?", Locale: "vi"}); err != nil {
		t.Fatal(err)
	}
	if (*seen)[0].Thinking || strings.Contains((*seen)[0].System, "Before each tool call") {
		t.Fatal("the JSON route asked the model to think or narrate")
	}
}

func TestAskAgentStopStoresPartialAndCharges(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	priceAgentModel(t, s)
	m := &agentMetricsFake{}
	s.SetAgentMetrics(m)
	s.agentRuns = newUniworkConcurrency(nil, "ai:ask:", askAgentPodMax, 1, askAgentGlobalMax, time.Minute)
	agentTask(t, s, ua, w, "Banner Tết")
	scriptAgent(fake, "banner", "Có 2 việc [S1]")
	// The cancel comes inside the second delta, so the stream sees it before
	// any third delta, whatever the delay.
	fake.StreamChunk, fake.StreamDelay = 4, 10*time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var events []AskEvent
	res, err := s.AskStream(ctx, ua.ID, w.ID, AskInput{Question: "Banner tới đâu?", Locale: "vi"}, cancelOnDelta(&events, 2, cancel))
	if err != nil {
		t.Fatalf("err %v, want the stopped turn stored and returned", err)
	}
	sent := joinDeltas(events)
	if sent != "Có 2 việ" || res.Message.Notice.String != ai.NoticeStopped || res.Message.Content != sent {
		t.Fatalf("deltas %q, stored %+v", sent, res.Message)
	}
	names := eventNames(events)
	if done := events[len(events)-1]; !slices.Equal(names[len(names)-2:], []string{"citations", "done"}) || done.Done.Message.Notice.String != ai.NoticeStopped {
		t.Fatalf("events %v", names)
	}
	rows, err := s.q.AiListMessages(context.Background(), res.ConversationID)
	if err != nil || len(rows) != 2 || rows[1].Notice.String != ai.NoticeStopped || rows[1].Content != sent {
		t.Fatalf("stored rows %+v %v", rows, err)
	}
	usage, err := s.q.AiGetUsageEvent(context.Background(), res.Message.UsageEventID.String)
	if err != nil || usage.Status != "cancelled" || usage.ReasonCode.String != ai.ErrCancelled.Code || usage.CostMicros <= 0 {
		t.Fatalf("usage row of the stopped call %+v %v", usage, err)
	}
	if res.Usage.InputTokens <= 10 || res.Usage.OutputTokens <= 5 {
		t.Fatalf("usage %+v, want the stopped call's tokens added", res.Usage)
	}
	release, err := s.agentRuns.Acquire(context.Background(), w.OrganizationID)
	if err != nil {
		t.Fatalf("the run's slot was not released: %v", err)
	}
	release()
	if !reflect.DeepEqual(m.runs, []string{"stopped/1"}) {
		t.Fatalf("runs %v", m.runs)
	}
}

func TestAskAgentShutdownInterruptsRun(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	m := &agentMetricsFake{}
	s.SetAgentMetrics(m)
	agentTask(t, s, ua, w, "Banner Tết")
	scriptAgent(fake, "banner", "Có 2 việc [S1]")
	// Shutdown reaches the run on another goroutine: the wait after the
	// first delta ends with it, not the clock.
	fake.StreamChunk, fake.StreamDelay = 4, 5*time.Second
	var events []AskEvent
	res, err := s.AskStream(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner tới đâu?", Locale: "vi"}, cancelOnDelta(&events, 1, s.Shutdown))
	if err != nil {
		t.Fatal(err)
	}
	done := events[len(events)-1]
	if done.Name != "done" || done.Done.Message.Notice.String != ai.NoticeInterrupted || done.Done.Message.Content != "Có 2" {
		t.Fatalf("last event %s %+v", done.Name, done.Done)
	}
	rows, err := s.q.AiListMessages(context.Background(), res.ConversationID)
	if err != nil || len(rows) != 2 || rows[1].Notice.String != ai.NoticeInterrupted || rows[1].Content != "Có 2" {
		t.Fatalf("stored rows %+v %v", rows, err)
	}
	if !reflect.DeepEqual(m.runs, []string{"interrupted/1"}) {
		t.Fatalf("runs %v", m.runs)
	}
	s.Shutdown() // again, with nothing in flight
}

func TestAskAgentRetryEmitsARetryStep(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	calls := 0
	fake.Reply = func(provider.CompletionRequest) provider.CompletionResponse {
		calls++
		switch calls {
		case 1:
			return provider.CompletionResponse{ToolCalls: []provider.ToolCall{searchCall("call-1")}, StopReason: "tool_use", UsagePresent: true, InputTokens: 10}
		case 2:
			return provider.CompletionResponse{Text: "Banner đang", StopReason: "max_tokens", UsagePresent: true, InputTokens: 10}
		}
		return provider.CompletionResponse{Text: "ok [S1]", StopReason: "end_turn", UsagePresent: true, InputTokens: 10}
	}
	fake.StreamChunk = 4
	var events []AskEvent
	res, err := s.AskStream(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner?", Locale: "vi"}, collectEvents(&events))
	if err != nil {
		t.Fatal(err)
	}
	i := lastStep(events)
	if i < 0 || events[i].Step.Phase != "retry" {
		t.Fatalf("events %v, want a retry step last", eventNames(events))
	}
	if before, after := joinDeltas(events[:i]), joinDeltas(events[i:]); before != "Banner đang" || after != "ok [S1]" || res.Message.Content != after {
		t.Fatalf("deltas before the retry %q, after %q, stored %q", before, after, res.Message.Content)
	}
}

// A deadline is not a stop (fix round 1): with nothing billed it is the
// timeout error, after a billed call the turn is stored agent_failed, on the
// streaming path and on the path without a sink alike.
func TestAskAgentTimeoutIsNotAStop(t *testing.T) {
	const cut = 200 * time.Millisecond
	setup := func(t *testing.T) (*AskUNIService, *provider.Fake, db.User, db.Workspace, *agentMetricsFake) {
		s, fake, ua, w := agentAskFixture(t)
		s.gw = ai.NewGateway(s.q, fake, NewAIQuota(s.ent), nil, ai.Options{Timeout: cut, StreamTimeout: cut})
		m := &agentMetricsFake{}
		s.SetAgentMetrics(m)
		agentTask(t, s, ua, w, "Banner Tết")
		scriptAgent(fake, "banner", "Có 2 việc [S1]")
		return s, fake, ua, w, m
	}
	for _, sink := range []bool{true, false} {
		ask := func(s *AskUNIService, ua db.User, w db.Workspace) (AskResult, []AskEvent, error) {
			var events []AskEvent
			var emit AskSink
			if sink {
				emit = collectEvents(&events)
			}
			res, err := s.AskStream(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner?", Locale: "vi"}, emit)
			return res, events, err
		}
		name := map[bool]string{true: "streaming", false: "without a sink"}[sink]
		t.Run(name+", nothing billed", func(t *testing.T) {
			s, fake, ua, w, m := setup(t)
			fake.Delay = 5 * time.Second // the first call outlives the gateway's timeout
			if _, _, err := ask(s, ua, w); !errors.Is(err, ai.ErrProviderTimeout) {
				t.Fatalf("err %v, want ai_provider_timeout", err)
			}
			if !reflect.DeepEqual(m.runs, []string{"timeout/0"}) {
				t.Fatalf("runs %v", m.runs)
			}
		})
		t.Run(name+", after a billed call", func(t *testing.T) {
			s, fake, ua, w, m := setup(t)
			if sink {
				fake.StreamChunk, fake.StreamDelay = 4, 5*time.Second // the answer is cut after its first delta
			} else {
				search := fake.Reply
				fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
					fake.Delay = 5 * time.Second // every later call outlives the gateway's timeout
					return search(req)
				}
			}
			res, events, err := ask(s, ua, w)
			if err != nil {
				t.Fatalf("err %v, want the turn stored", err)
			}
			if res.Message.Notice.String != ai.NoticeAgentFailed || res.Message.Content != "" || !reflect.DeepEqual(m.runs, []string{"timeout/1"}) {
				t.Fatalf("stored %+v, runs %v", res.Message, m.runs)
			}
			if sink && (joinDeltas(events) != "Có 2" || events[len(events)-1].Done.Message.Notice.String != ai.NoticeAgentFailed) {
				t.Fatalf("events %v, deltas %q", eventNames(events), joinDeltas(events))
			}
			usage, err := s.q.AiGetUsageEvent(context.Background(), res.Message.UsageEventID.String)
			if err != nil || usage.ReasonCode.String != ai.ErrProviderTimeout.Code {
				t.Fatalf("usage row of the cut call %+v %v", usage, err)
			}
		})
	}
}

// A Stop that lands once the final call has answered keeps the answer: it is
// charged and complete, so it is stored past the request (ruling R6).
func TestAskAgentKeepsAnAnswerThatArrivedAsTheAskerLeft(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	scriptAgent(fake, "banner", "Có 2 việc [S1]")
	fake.StreamChunk = 4
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var events []AskEvent
	res, err := s.AskStream(ctx, ua.ID, w.ID, AskInput{Question: "Banner tới đâu?", Locale: "vi"}, cancelOnDelta(&events, 4, cancel))
	if err != nil {
		t.Fatalf("err %v, want the answer stored", err)
	}
	if res.Message.Content != "Có 2 việc [S1]" || res.Message.Notice.String != "" || len(res.Citations) != 1 || messageCount(t, s, res.ConversationID) != 2 {
		t.Fatalf("stored %+v, citations %+v", res.Message, res.Citations)
	}
	if done := events[len(events)-1]; done.Name != "done" || done.Done.Message.ID != res.Message.ID {
		t.Fatalf("events %v", eventNames(events))
	}
}

// Shutdown interrupts a P0 call too (ruling R7): the turn is stored empty
// with notice interrupted and ends with done.
func TestAskStreamP0ShutdownStoresAnInterruptedTurn(t *testing.T) {
	s, fake, ua, _, w := askFixture(t)
	if _, err := s.tasks.Create(context.Background(), Human(ua.ID), w.ID, CreateTaskInput{Title: "Viết spec F-09"}); err != nil {
		t.Fatal(err)
	}
	fake.Delay = 5 * time.Second // the call waits for Shutdown, not the clock
	var events []AskEvent
	sink := func(e AskEvent) {
		events = append(events, e)
		if e.Name == "run" {
			s.Shutdown()
		}
	}
	res, err := s.AskStream(context.Background(), ua.ID, w.ID, AskInput{Question: "spec F-09", Locale: "vi"}, sink)
	if err != nil {
		t.Fatalf("err %v, want the interrupted turn stored", err)
	}
	if want := []string{"run", "citations", "done"}; !slices.Equal(eventNames(events), want) {
		t.Fatalf("events %v, want %v", eventNames(events), want)
	}
	if res.Message.Notice.String != ai.NoticeInterrupted || res.Message.Content != "" || messageCount(t, s, res.ConversationID) != 2 {
		t.Fatalf("stored %+v", res.Message)
	}
}

func TestAskStreamP0StopStoresAnEmptyStoppedTurn(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	if _, err := s.tasks.Create(context.Background(), Human(ua.ID), w.ID, CreateTaskInput{Title: "Viết spec F-09"}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var events []AskEvent
	sink := func(e AskEvent) {
		events = append(events, e)
		if e.Name == "run" {
			cancel() // the asker leaves before the model answers
		}
	}
	res, err := s.AskStream(ctx, ua.ID, w.ID, AskInput{Question: "spec F-09", Locale: "vi"}, sink)
	if err != nil {
		t.Fatalf("err %v, want the stopped turn stored", err)
	}
	if want := []string{"run", "citations", "done"}; !slices.Equal(eventNames(events), want) {
		t.Fatalf("events %v, want %v", eventNames(events), want)
	}
	if res.Message.Notice.String != ai.NoticeStopped || res.Message.Content != "" || messageCount(t, s, res.ConversationID) != 2 {
		t.Fatalf("stored %+v", res.Message)
	}
}

// A Stop while the P0 call is running is booked as a stop, never as a provider
// outage (R6): the row is cancelled/ai_cancelled, not failed/ai_provider_error.
func TestAskStreamP0StopDuringCallBooksACancelledRow(t *testing.T) {
	s, fake, ua, _, w := askFixture(t)
	if _, err := s.tasks.Create(context.Background(), Human(ua.ID), w.ID, CreateTaskInput{Title: "Viết spec F-09"}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	fake.Err = context.Canceled
	fake.Reply = func(provider.CompletionRequest) provider.CompletionResponse {
		cancel() // the asker leaves while the model is working
		return provider.CompletionResponse{}
	}
	res, err := s.AskStream(ctx, ua.ID, w.ID, AskInput{Question: "spec F-09", Locale: "vi"}, func(AskEvent) {})
	if err != nil {
		t.Fatalf("err %v, want the stopped turn stored", err)
	}
	if res.Message.Notice.String != ai.NoticeStopped {
		t.Fatalf("stored %+v", res.Message)
	}
	var status, reason string
	if err := s.pool.QueryRow(context.Background(), `SELECT status, coalesce(reason_code, '') FROM ai_usage_events
		WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`, w.OrganizationID).Scan(&status, &reason); err != nil {
		t.Fatal(err)
	}
	if status != "cancelled" || reason != "ai_cancelled" {
		t.Fatalf("usage row %q %q, want cancelled ai_cancelled", status, reason)
	}
}

// Untrusted tags are stripped before a delta leaves, even when one spans two
// deltas: only a tail that may still grow into a tag is held back (ruling
// PF1b), and a call whose stripped text stops extending what was sent sends
// nothing more.
func TestAskStreamDraftStripsTagsAcrossDeltas(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  []string
		want []string
	}{
		{"tag across deltas", []string{"ok <untr", "usted source=\"x\">a", "</untrusted> b"}, []string{"ok ", "a", " b"}},
		{"a plain bracket streams", []string{"Còn < 3", " ngày"}, []string{"Còn < 3", " ngày"}},
		{"a bracket waits for its next rune only", []string{"Còn <", " 3 ngày"}, []string{"Còn ", "< 3 ngày"}},
		{"a partial tag never leaks", []string{"<untru", "sted>x"}, []string{"x"}},
		{"a full-width partial tag is held", []string{"a ＜untruste"}, []string{"a "}},
		// Stripping an inner tag rebuilds an outer one over text already sent.
		{"text that shrinks stops the call", []string{"<<", "untrusted>untrusted> z", "w"}, []string{"<"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var events []AskEvent
			d := &askDraft{emit: collectEvents(&events)}
			for _, r := range tc.raw {
				d.add(r)
			}
			var got []string
			for _, e := range events {
				got = append(got, e.Delta)
			}
			if !slices.Equal(got, tc.want) || d.sent != strings.Join(tc.want, "") {
				t.Fatalf("deltas %q (sent %q), want %q", got, d.sent, tc.want)
			}
		})
	}
}
