package ai

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// truncatingProvider answers like provider/anthropic.go does for a structured
// answer cut at max_tokens: the usage the vendor billed, and ErrTruncated.
type truncatingProvider struct {
	provider.Fake
	resp provider.CompletionResponse
}

func (p *truncatingProvider) Complete(context.Context, provider.CompletionRequest) (provider.CompletionResponse, error) {
	return p.resp, fmt.Errorf("cut: %w", provider.ErrTruncated)
}

type usageMetrics struct {
	calls []string
	usage []float64
}

func (m *usageMetrics) ObserveAICall(_, status string, _ time.Duration) {
	m.calls = append(m.calls, status)
}
func (m *usageMetrics) ObserveAIUsage(_, _, _ string, _, _ int, costUSD float64) {
	m.usage = append(m.usage, costUSD)
}

// TestGatewayTruncatedOutputIsInvalid (M10): a structured answer cut at
// max_tokens is ai_output_invalid, not a provider outage — and the vendor
// billed it, so the row is priced, the tokens count against the
// organization's quota and the usage metric sees the cost, exactly as for a
// call that answered in full.
func TestGatewayTruncatedOutputIsInvalid(t *testing.T) {
	ctx := context.Background()
	fp := &truncatingProvider{resp: provider.CompletionResponse{
		Text: `{"answer":"cut mid`, Model: "fake", UsagePresent: true, InputTokens: 1_000_000, OutputTokens: 500_000, StopReason: "max_tokens",
	}}
	quota := &fakeQuota{}
	g, q := gatewayFixture(t, fp, quota)
	metrics := &usageMetrics{}
	g.SetMetrics(metrics)
	// 2 USD / 1M in, 4 USD / 1M out → 4 USD for this call.
	if _, err := q.AiInsertRate(ctx, db.AiInsertRateParams{ID: util.NewID(), Provider: "fake", Model: "fake", InputMicrosPerMtok: 2_000_000, OutputMicrosPerMtok: 4_000_000, EffectiveAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true}}); err != nil {
		t.Fatal(err)
	}
	_, err := g.Complete(ctx, askReq())
	if !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("err = %v, want ErrOutputInvalid", err)
	}
	if len(quota.recorded) != 1 || quota.recorded[0].Tokens != 1_500_000 || quota.recorded[0].UsageEventID == "" {
		t.Fatalf("truncated call not charged to quota: %+v", quota.recorded)
	}
	row, err := q.AiGetUsageEvent(ctx, quota.recorded[0].UsageEventID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "failed" || row.ReasonCode.String != ErrOutputInvalid.Code {
		t.Fatalf("row settled as %s/%s, want failed/%s", row.Status, row.ReasonCode.String, ErrOutputInvalid.Code)
	}
	if row.InputTokens != 1_000_000 || row.OutputTokens != 500_000 || row.CostMicros != 4_000_000 || !row.RateID.Valid {
		t.Fatalf("truncated row not priced: %+v", row)
	}
	if len(metrics.usage) != 1 || metrics.usage[0] != 4 {
		t.Fatalf("ObserveAIUsage = %v, want one 4 USD sample", metrics.usage)
	}
	if len(metrics.calls) != 1 || metrics.calls[0] != "failed" {
		t.Fatalf("ObserveAICall = %v, want one failed call", metrics.calls)
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
