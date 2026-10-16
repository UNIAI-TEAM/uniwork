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
