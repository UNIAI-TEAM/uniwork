package ai

import (
	"errors"
	"testing"
	"time"
)

// RateLimited is ai_rate_limited with the wait in retry_after, clamped like a
// vendor's, so a service's own bound reads the same as a vendor 429.
func TestRateLimitedCarriesRetryAfter(t *testing.T) {
	for _, tc := range []struct {
		retry time.Duration
		want  int
	}{{5 * time.Second, 5}, {0, 30}, {time.Hour, 300}} {
		err := RateLimited(tc.retry)
		if !errors.Is(err, ErrRateLimited) || err.Status != 429 || err.Fields["retry_after"] != tc.want {
			t.Fatalf("RateLimited(%v) = %+v, want ai_rate_limited with retry_after %d", tc.retry, err, tc.want)
		}
	}
}
