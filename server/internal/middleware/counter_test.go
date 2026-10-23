package middleware

import (
	"context"
	"testing"
	"time"
)

func TestCounterAllowsUpToTheLimitPerSubject(t *testing.T) {
	c := NewCounter(newRedisTestClient(t), "mcp-write-test", 2, time.Minute)
	ctx := context.Background()
	for i := 1; i <= 2; i++ {
		if !c.Allow(ctx, "g1") {
			t.Fatalf("event %d refused under the limit", i)
		}
	}
	if c.Allow(ctx, "g1") {
		t.Fatal("third event allowed over a limit of 2")
	}
	if !c.Allow(ctx, "g2") {
		t.Fatal("another subject shares the first one's budget")
	}
}

func TestCounterWithoutRedisAllows(t *testing.T) {
	var nilCounter *Counter
	if !NewCounter(nil, "b", 1, time.Minute).Allow(context.Background(), "g") || !nilCounter.Allow(context.Background(), "g") {
		t.Fatal("a counter without Redis refused")
	}
}
