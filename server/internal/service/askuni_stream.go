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
// carries it: run, step, sources, delta, reasoning, proposal,
// memory_proposals, citations, followups, memory_used, done, title or error. Delta carries the text of both delta and
// reasoning.
type AskEvent struct {
	Name      string
	Run       *AskRunEvent
	Step      *AskStepEvent
	Delta     string
	Citations []AskCitation
	Sources   []AskCitation // the sources a step numbered for the first time
	Followups []string      // the dock's follow-up questions; sent only when there are some
	Done      *AskResult
	Title     *AskTitleEvent // the generated name of a new conversation, after done
	Code      string
	Proposals []AskProposal // the turn's rows after the store and any auto-applied ones (R18)
	MemoryIDs []string      // the memory entries the answer used; sent only when there are some
	// MemoryProposals are the turn's memory rows after the store (R11).
	MemoryProposals []AskMemoryProposal
}

type AskRunEvent struct{ RunID, ConversationID string }

// AskStepEvent reports one agent step: a tool round or the format retry.
type AskStepEvent struct {
	Round  int
	Phase  string // "tool" | "retry"
	Tool   string
	Label  string // the query or the one object the tool named; "" otherwise
	Counts map[string]int
	// Note is the sentence the model wrote before asking for this round's
	// tools, on the round's first step only; "" otherwise.
	Note string
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
	e.emitDone(res, nil)
}

// emitDone ends a turn whose text already streamed: its citations, its
// follow-up questions if any, then done.
func (e AskSink) emitDone(res AskResult, followups []string) {
	e.emit(AskEvent{Name: "citations", Citations: res.Citations})
	if len(followups) > 0 {
		e.emit(AskEvent{Name: "followups", Followups: followups})
	}
	if len(res.MemoryIDs) > 0 {
		e.emit(AskEvent{Name: "memory_used", MemoryIDs: res.MemoryIDs})
	}
	e.emit(AskEvent{Name: "done", Done: &res})
}

// askDraft is what the current model call has streamed: raw as the gateway
// handed it over, sent as the stripped text already emitted in deltas.
type askDraft struct {
	emit AskSink
	// cutFollowups stops the text at the dock's follow-up block (R6).
	cutFollowups bool
	// cutMemory also stops it at <memory_used>; only a turn that told the
	// model about memory has one.
	cutMemory bool
	raw       strings.Builder
	sent      string
	stuck     bool
	// thought is the call's thinking summary so far (ask_uni_thinking).
	thought strings.Builder
}

// reset starts a new call: nothing of it streamed yet.
func (d *askDraft) reset() { d.raw.Reset(); d.thought.Reset(); d.sent, d.stuck = "", false }

// think takes one delta of the call's thinking summary: sent on as reasoning,
// and kept, up to askThoughtRunes, for the step it leads to.
func (d *askDraft) think(text string) {
	d.emit.emit(AskEvent{Name: "reasoning", Delta: text})
	if d.thought.Len() < 4*askThoughtRunes {
		d.thought.WriteString(text)
	}
}

// takeThought is the call's thinking summary so far, capped, and forgets it.
func (d *askDraft) takeThought() string {
	t := capRunes(strings.TrimSpace(d.thought.String()), askThoughtRunes, "…")
	d.thought.Reset()
	return t
}

// add takes one raw delta and emits what it adds to the call's text once
// untrusted tags are stripped (ruling PF1). A tail that may still grow into a
// tag is held back (PF1b); once the stripped text stops extending what was
// sent, the call sends nothing more and done carries the stored answer.
func (d *askDraft) add(text string) {
	if d.stuck {
		return
	}
	d.raw.WriteString(text)
	// shortcut: re-strips the call's whole text on every delta (quadratic in
	// deltas); strip only the unsent tail if long answers show up in CPU.
	r := d.raw.String()
	if i := ai.UntrustedTagTail(r); i >= 0 {
		r = r[:i]
	}
	clean := ai.StripUntrustedTags(r)
	if d.cutFollowups {
		if d.cutMemory {
			clean = cutAtTags(clean, followupsTag, memoryUsedTag)
		} else {
			clean = cutAtFollowups(clean)
		}
	}
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

// Shutdown interrupts every turn in flight: each stores what it streamed with
// notice interrupted and ends with done (R7). It is safe to call more than
// once and with no turn in flight.
func (s *AskUNIService) Shutdown() { s.shutdown(errAskShutdown) }

// runContext is a turn's context: it ends with the request, and on Shutdown
// with errAskShutdown as its cause.
func (s *AskUNIService) runContext(ctx context.Context) (context.Context, func()) {
	runCtx, cancel := context.WithCancelCause(ctx)
	stop := context.AfterFunc(s.life, func() { cancel(context.Cause(s.life)) })
	return runCtx, func() { stop(); cancel(nil) }
}

// askStopNotice names a turn cut short (R6, R7): interrupted when Shutdown
// ended runCtx, stopped when the asker left (their request cancelled, or the
// gateway cut a streamed call with ErrCancelled). A deadline is not a stop:
// "" for it and for every other error.
func askStopNotice(ctx, runCtx context.Context, err error) string {
	switch {
	case errors.Is(context.Cause(runCtx), errAskShutdown):
		return ai.NoticeInterrupted
	case errors.Is(ctx.Err(), context.Canceled), errors.Is(err, ai.ErrCancelled):
		return ai.NoticeStopped
	}
	return ""
}

// outliving is ctx without its cancel, for askAgentStoreTimeout: a turn is
// stored even when the asker left or the run's deadline passed.
func outliving(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), askAgentStoreTimeout)
}

// Ask is one turn without events.
func (s *AskUNIService) Ask(ctx context.Context, userID, workspaceID string, in AskInput) (AskResult, error) {
	return s.AskStream(ctx, userID, workspaceID, in, nil)
}
