package provider

import (
	"context"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
)

// Stream is Complete over the SSE endpoint: text deltas go to onDelta as they
// arrive, everything else is accumulated and turned into the same response.
func (a *Anthropic) Stream(ctx context.Context, req CompletionRequest, onDelta func(string)) (CompletionResponse, error) {
	params, err := a.params(req)
	if err != nil {
		return CompletionResponse{}, err
	}
	stream := a.client.Messages.NewStreaming(ctx, params)
	defer stream.Close()
	var msg anthropic.Message
	complete := false
	for stream.Next() {
		ev := stream.Current()
		if err := msg.Accumulate(ev); err != nil {
			return CompletionResponse{}, fmt.Errorf("anthropic: stream: %w", err)
		}
		switch ev.Type {
		case "content_block_delta":
			if ev.Delta.Type == "text_delta" && ev.Delta.Text != "" {
				onDelta(ev.Delta.Text)
			}
		case "message_stop":
			complete = true
		}
	}
	if err := stream.Err(); err != nil || !complete {
		if cerr := ctx.Err(); cerr != nil {
			return anthropicPartial(msg), cerr
		}
		if err == nil {
			err = fmt.Errorf("anthropic: stream ended before message_stop")
		}
		return CompletionResponse{}, anthropicError(err)
	}
	out, err := anthropicResponse(req, &msg)
	// Usage counts as complete only once the stream finished.
	out.UsagePresent = out.UsagePresent && complete
	return out, err
}

// anthropicPartial is what an interrupted stream had: text and the usage
// already reported, never tool calls (their input may be cut mid-JSON).
func anthropicPartial(msg anthropic.Message) CompletionResponse {
	out := CompletionResponse{
		Model:            string(msg.Model),
		InputTokens:      int(msg.Usage.InputTokens),
		OutputTokens:     int(msg.Usage.OutputTokens),
		CacheReadTokens:  int(msg.Usage.CacheReadInputTokens),
		CacheWriteTokens: int(msg.Usage.CacheCreationInputTokens),
	}
	for _, block := range msg.Content {
		// Read the field, not AsAny: the wire JSON is only refreshed at block stop.
		if block.Type == "text" {
			out.Text += block.Text
		}
	}
	return out
}
