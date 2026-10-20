package service

import "context"

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
	e.emit(AskEvent{Name: "citations", Citations: res.Citations})
	e.emit(AskEvent{Name: "done", Done: &res})
}

// Ask is one turn without events.
func (s *AskUNIService) Ask(ctx context.Context, userID, workspaceID string, in AskInput) (AskResult, error) {
	return s.AskStream(ctx, userID, workspaceID, in, nil)
}
