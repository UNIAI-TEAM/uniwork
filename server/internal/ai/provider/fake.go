package provider

import "context"

// Fake is the Provider for tests and for AI_PROVIDER=fake in development and
// E2E. Reply decides the answer from the request; nil Reply echoes the last
// user message. It never talks to the network.
type Fake struct {
	Reply func(CompletionRequest) CompletionResponse
	Err   error
	Calls int
	Last  CompletionRequest
}

func (f *Fake) Name() string { return "fake" }

func (f *Fake) Complete(_ context.Context, req CompletionRequest) (CompletionResponse, error) {
	f.Calls++
	f.Last = req
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
	text := ""
	if n := len(req.Messages); n > 0 {
		text = req.Messages[n-1].Content
	}
	return CompletionResponse{Text: text, Model: req.Model, InputTokens: len(req.System) / 4, OutputTokens: len(text) / 4, StopReason: "end_turn"}, nil
}

func (f *Fake) Embed(context.Context, EmbedRequest) (EmbedResponse, error) {
	return EmbedResponse{}, ErrUnsupported
}
