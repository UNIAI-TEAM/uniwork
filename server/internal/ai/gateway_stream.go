package ai

import (
	"context"
	"errors"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// invoke asks the provider once: streamed when the caller wants deltas and the
// provider can, otherwise Complete (with one delta of the whole text).
func (g *Gateway) invoke(ctx context.Context, req Request, creq provider.CompletionRequest) (provider.CompletionResponse, error) {
	if req.OnDelta == nil {
		cctx, cancel := context.WithTimeout(ctx, g.CallTimeoutFor(req.Capability))
		defer cancel()
		return g.p.Complete(cctx, creq)
	}
	cctx, cancel := context.WithTimeout(ctx, g.opts.StreamTimeout*time.Duration(max(policies[req.Capability].StreamTimeoutScale, 1)))
	defer cancel()
	if s, ok := g.p.(provider.Streamer); ok {
		return s.Stream(cctx, creq, req.OnDelta)
	}
	resp, err := g.p.Complete(cctx, creq)
	if err == nil && resp.Text != "" {
		req.OnDelta(resp.Text)
	}
	return resp, err
}

// stoppedTokens is ceil(bytes/3), for the counts a stopped call's vendor did
// not report.
func stoppedTokens(b int) int { return (b + 2) / 3 }

// settleCancelled prices and charges a streamed call that ended early (client
// stop or deadline) after text or tokens existed, exactly as a succeeded call
// is, and returns the refusal to hand back. ok is false when the call did not
// end that way and the usual failure path applies.
func (g *Gateway) settleCancelled(sctx, ctx context.Context, req Request, creq provider.CompletionRequest, row db.AiUsageEvent,
	model string, resp provider.CompletionResponse, perr error, latency time.Duration) (error, bool) {
	timedOut := errors.Is(perr, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded)
	// A deadline on a non-streamed call stays a provider failure; a caller stop
	// is a stop whether or not the call streamed (R6).
	if req.OnDelta == nil && (timedOut || !errors.Is(perr, context.Canceled)) {
		return nil, false
	}
	if !timedOut && !errors.Is(perr, context.Canceled) {
		return nil, false
	}
	if resp.Model == "" {
		resp.Model = model
	}
	// Nothing arrived at all: record the stop at cost 0 and charge nothing.
	nothing := resp.Text == "" && resp.InputTokens == 0 && resp.OutputTokens == 0
	if !resp.UsagePresent && !nothing {
		// A mid-stream output count (Anthropic's message_start says 1) is not
		// final; the text received is the better figure. A reported input
		// count is final and kept.
		resp.OutputTokens = max(resp.OutputTokens, stoppedTokens(len(resp.Text)))
		if resp.InputTokens == 0 {
			resp.InputTokens = stoppedTokens(requestBytes(creq))
		}
	}
	out, code := ErrCancelled, ErrCancelled.Code
	if timedOut {
		out, code = ErrProviderTimeout, ErrProviderTimeout.Code
	}
	if err := g.settle(sctx, row.ID, row.OrganizationID, resp, "cancelled", code, latency, nil, true); err != nil {
		g.log.Warn("ai: settle cancelled call", "usage_event_id", row.ID, "err", err)
	}
	if !nothing {
		g.charge(sctx, req, row.ID, resp)
	}
	g.observe(req.Capability, "cancelled", latency)
	g.log.Info("ai: call stopped", "usage_event_id", row.ID, "capability", req.Capability, "code", code)
	return out.wrapUsage(perr, row.ID), true
}

// requestBytes is what the model was sent: system text, messages and tool
// schemas.
func requestBytes(r provider.CompletionRequest) int {
	n := len(r.System)
	for _, m := range r.Messages {
		n += len(m.Content)
		for _, c := range m.ToolCalls {
			n += len(c.Input)
		}
	}
	for _, t := range r.Tools {
		n += len(t.Schema)
	}
	return n
}
