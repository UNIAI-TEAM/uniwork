package provider

import (
	"context"
	"encoding/json"
	"time"
)

// Fake is the Provider for tests and for AI_PROVIDER=fake in development and
// E2E. Reply decides the answer from the request; nil Reply echoes the last
// user message. Err is returned as is, so a test injects a vendor rate limit
// with &StatusError{Status: 429, RetryAfter: …}. Delay makes Complete wait
// before answering and hands back the context's error when the wait is cut
// short, so a deadline is testable without a network. It never talks to the
// network.
type Fake struct {
	Reply func(CompletionRequest) CompletionResponse
	Err   error
	Delay time.Duration
	Calls int
	Last  CompletionRequest
}

func (f *Fake) Name() string { return "fake" }

func (f *Fake) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	f.Calls++
	f.Last = req
	if f.Delay > 0 {
		timer := time.NewTimer(f.Delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return CompletionResponse{}, ctx.Err()
		}
	}
	if f.Err != nil {
		return CompletionResponse{}, f.Err
	}
	if f.Reply != nil {
		resp := f.Reply(req)
		if resp.Model == "" {
			resp.Model = req.Model
		}
		return resp, nil
	}
	// Tool loop, scripted (spike G6-02): with tools offered and no result in
	// the history yet, ask for the first tool; once a result is present,
	// answer and echo the id it carried, so a caller can prove the id
	// survived the round trip without a network.
	if len(req.Tools) > 0 {
		if id := lastToolCallID(req.Messages); id != "" {
			text := "tool " + id + " returned its result"
			return CompletionResponse{Text: text, Model: req.Model, UsagePresent: true,
				InputTokens: len(req.System+lastContent(req.Messages)) / 4, OutputTokens: len(text) / 4, StopReason: "end_turn"}, nil
		}
		if !hasToolResult(req.Messages) {
			return CompletionResponse{
				Model: req.Model, UsagePresent: true, StopReason: "tool_calls",
				InputTokens: len(req.System+lastContent(req.Messages)) / 4, OutputTokens: 8,
				ToolCalls: []ToolCall{{
					ID: FakeToolCallID, Name: req.Tools[0].Name, Input: json.RawMessage(`{"cell":"A1"}`),
				}},
			}, nil
		}
	}
	text := ""
	if n := len(req.Messages); n > 0 {
		text = req.Messages[n-1].Content
	}
	return CompletionResponse{Text: text, Model: req.Model, UsagePresent: true, InputTokens: len(req.System) / 4, OutputTokens: len(text) / 4, StopReason: "end_turn"}, nil
}

// FakeToolCallID is the id the scripted call carries, so a test can assert it
// came back unchanged.
const FakeToolCallID = "call_fake_1"

// lastContent is the newest message's text, for the token estimate.
func lastContent(msgs []Message) string {
	if n := len(msgs); n > 0 {
		return msgs[n-1].Content
	}
	return ""
}

// hasToolResult reports whether the history already answers a call.
func hasToolResult(msgs []Message) bool {
	for _, m := range msgs {
		if m.Role == "tool" || m.ToolCallID != "" {
			return true
		}
	}
	return false
}

// lastToolCallID is the id of the newest tool result in the history, "" when
// there is none.
func lastToolCallID(msgs []Message) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].ToolCallID != "" {
			return msgs[i].ToolCallID
		}
	}
	return ""
}

func (f *Fake) Embed(context.Context, EmbedRequest) (EmbedResponse, error) {
	return EmbedResponse{}, ErrUnsupported
}
