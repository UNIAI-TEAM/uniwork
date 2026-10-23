package ai

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// deadlineProvider records how long each call was given.
type deadlineProvider struct {
	provider.Fake
	left time.Duration
}

func (p *deadlineProvider) Complete(ctx context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error) {
	if d, ok := ctx.Deadline(); ok {
		p.left = time.Until(d)
	}
	return provider.CompletionResponse{Text: "{}"}, nil
}

// TestCallTimeoutFollowsTheCapability: a meeting record of a long meeting is
// several thousand output tokens (70-90 s on claude-opus-5 for a 28-minute
// meeting), so its calls get three times AI_TIMEOUT_SECONDS; every other
// capability keeps AI_TIMEOUT_SECONDS.
func TestCallTimeoutFollowsTheCapability(t *testing.T) {
	p := &deadlineProvider{}
	g := NewGateway(nil, p, nil, nil, Options{Timeout: time.Minute})
	if _, err := g.invoke(context.Background(), Request{Capability: CapMeetingSummarization}, provider.CompletionRequest{}); err != nil {
		t.Fatal(err)
	}
	if p.left <= 2*time.Minute {
		t.Fatalf("a meeting summary call was given %s", p.left)
	}
	if got := g.CallTimeoutFor(CapMeetingSummarization); got != 3*time.Minute {
		t.Fatalf("CallTimeoutFor(meeting summary) = %s", got)
	}
	if _, err := g.invoke(context.Background(), Request{Capability: CapCopilotAnswer}, provider.CompletionRequest{}); err != nil {
		t.Fatal(err)
	}
	if p.left > time.Minute {
		t.Fatalf("an Ask UNI answer was given %s, want AI_TIMEOUT_SECONDS (1m)", p.left)
	}
}
