package middleware

import (
	"context"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// Counter budgets events that are not one HTTP request each, such as the
// write tools one MCP call runs (ADR 0033). It shares the limiter's script,
// timeout and in-flight cap, and fails open the same way: it slows a runaway
// loop, it does not authorize anything.
type Counter struct {
	rdb      *redis.Client
	bucket   string
	limit    int
	window   time.Duration
	inFlight chan struct{}
}

func NewCounter(rdb *redis.Client, bucket string, limit int, window time.Duration) *Counter {
	return &Counter{rdb: rdb, bucket: bucket, limit: limit, window: window, inFlight: make(chan struct{}, rateLimitMaxInFlight)}
}

// Allow counts one event for subject and reports whether it is within the
// budget. No Redis, or a Redis that fails, allows.
func (c *Counter) Allow(ctx context.Context, subject string) bool {
	if c == nil || c.rdb == nil {
		return true
	}
	n, err := countRequest(ctx, c.rdb, c.inFlight, rateLimitKey(c.limit, c.bucket, identitySubject(subject)), c.window)
	if err != nil {
		slog.Warn("ratelimit: redis error; allowing event", "bucket", c.bucket, "error", err)
		return true
	}
	return n <= int64(c.limit)
}
