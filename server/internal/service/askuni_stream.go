package service

import (
	"context"
	"errors"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// AskSink receives the events of one turn in order; nil means no events.
type AskSink func(AskEvent)

// AskEvent is one event of a streamed turn. Name selects the field that
// carries it: run, step, delta, citations, done or error.
type AskEvent struct {
	Name      string
	Run       *AskRunEvent
	Step      *AskStepEvent
	Delta     string
	Citations []AskCitation
	Done      *AskResult
	Code      string
}

type AskRunEvent struct{ RunID, ConversationID string }

// AskStepEvent reports one agent step: a tool round or the format retry.
type AskStepEvent struct {
	Round  int
	Phase  string // "tool" | "retry"
	Tool   string
	Counts map[string]int
}

// AskUsage is the tokens of a turn's model calls, summed.
type AskUsage struct{ InputTokens, OutputTokens, CacheReadTokens, CacheWriteTokens int }

func (u *AskUsage) add(in, out, cacheRead, cacheWrite int) {
	u.InputTokens += in
	u.OutputTokens += out
	u.CacheReadTokens += cacheRead
	u.CacheWriteTokens += cacheWrite
}

func (e AskSink) emit(ev AskEvent) {
	if e != nil {
		e(ev)
	}
}

// emitAnswer ends a stored turn: the whole answer as one delta (none when the
// turn carries a notice), then its citations, then done.
func (e AskSink) emitAnswer(res AskResult) {
	if res.Message.Notice.String == "" {
		e.emit(AskEvent{Name: "delta", Delta: res.Message.Content})
	}
	e.emitDone(res)
}

// emitDone ends a turn whose text already streamed: its citations, then done.
func (e AskSink) emitDone(res AskResult) {
	e.emit(AskEvent{Name: "citations", Citations: res.Citations})
	e.emit(AskEvent{Name: "done", Done: &res})
}

// askDraft is what the current model call has streamed: raw as the gateway
// handed it over, sent as the stripped text already emitted in deltas.
type askDraft struct {
	emit  AskSink
	raw   strings.Builder
	sent  string
	stuck bool
}

// reset starts a new call: nothing of it streamed yet.
func (d *askDraft) reset() { d.raw.Reset(); d.sent, d.stuck = "", false }

// add takes one raw delta and emits what it adds to the call's text once
// untrusted tags are stripped (ruling PF1). A "<" with no ">" after it may
// open a tag, so the text from it is held back; once the stripped text stops
// extending what was sent, the call sends nothing more and done carries the
// stored answer.
func (d *askDraft) add(text string) {
	if d.stuck {
		return
	}
	d.raw.WriteString(text)
	// shortcut: re-strips the call's whole text on every delta (quadratic in
	// deltas); strip only the unsent tail if long answers show up in CPU.
	r := d.raw.String()
	if i := strings.LastIndexByte(r, '<'); i >= 0 && !strings.Contains(r[i:], ">") {
		r = r[:i]
	}
	clean := ai.StripUntrustedTags(r)
	if !strings.HasPrefix(clean, d.sent) {
		d.stuck = true
		return
	}
	if len(clean) > len(d.sent) {
		d.emit.emit(AskEvent{Name: "delta", Delta: clean[len(d.sent):]})
		d.sent = clean
	}
}

// step emits a step; the client clears its draft on it, so the text of the
// call before it is no longer the one a stop would keep.
func (d *askDraft) step(ev AskStepEvent) {
	d.reset()
	d.emit.emit(AskEvent{Name: "step", Step: &ev})
}

// errAskShutdown is the cause Shutdown cancels the agent runs with.
var errAskShutdown = errors.New("ask uni: server shutting down")

// Shutdown interrupts every agent run in flight: each stores what it streamed
// with notice interrupted and ends with done (R7). It is safe to call more
// than once and with no run in flight.
func (s *AskUNIService) Shutdown() { s.shutdown(errAskShutdown) }

// Ask is one turn without events.
func (s *AskUNIService) Ask(ctx context.Context, userID, workspaceID string, in AskInput) (AskResult, error) {
	return s.AskStream(ctx, userID, workspaceID, in, nil)
}
