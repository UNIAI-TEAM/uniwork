package ai

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// TestGatewayTruncatedOutputIsInvalid (M10): a structured answer cut at
// max_tokens is ai_output_invalid, not a provider outage.
func TestGatewayTruncatedOutputIsInvalid(t *testing.T) {
	fp := &provider.Fake{Err: fmt.Errorf("cut: %w", provider.ErrTruncated)}
	g, _ := gatewayFixture(t, fp, &fakeQuota{})
	if _, err := g.Complete(context.Background(), askReq()); !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("err = %v, want ErrOutputInvalid", err)
	}
}

// A refusal for a call that reached the vendor names the usage row it
// settled, so a caller can log which row a failed (and maybe billed) call
// left behind.
func TestGatewayFailedCallNamesItsUsageRow(t *testing.T) {
	cases := map[string]*provider.Fake{
		"truncated":    {Err: fmt.Errorf("cut: %w", provider.ErrTruncated)},
		"provider":     {Err: errors.New("boom")},
		"rate limited": {Err: &provider.StatusError{Status: 429}},
		"timeout":      {Err: context.DeadlineExceeded},
	}
	for name, fp := range cases {
		t.Run(name, func(t *testing.T) {
			g, q := gatewayFixture(t, fp, &fakeQuota{})
			_, err := g.Complete(context.Background(), askReq())
			var aiErr *Error
			if !errors.As(err, &aiErr) || aiErr.UsageEventID == "" {
				t.Fatalf("err = %#v, want an *Error naming its usage row", err)
			}
			row, gerr := q.AiGetUsageEvent(context.Background(), aiErr.UsageEventID)
			if gerr != nil || row.Status != "failed" {
				t.Fatalf("usage row %s = %+v (%v), want the failed row", aiErr.UsageEventID, row, gerr)
			}
		})
	}
}
