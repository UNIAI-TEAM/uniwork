package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

func TestAskMemIncrementResetsAfterWindow(t *testing.T) {
	s := &AskUNIService{}
	now := time.Date(2026, 3, 26, 12, 0, 0, 0, time.UTC)
	window := time.Minute
	if n := s.askMemIncrement("u1", now, window); n != 1 {
		t.Fatalf("first hit = %d, want 1", n)
	}
	if n := s.askMemIncrement("u1", now.Add(30*time.Second), window); n != 2 {
		t.Fatalf("second hit = %d, want 2", n)
	}
	if n := s.askMemIncrement("u1", now.Add(2*time.Minute), window); n != 1 {
		t.Fatalf("after window = %d, want 1", n)
	}
}

func TestRateLimitWithoutRedis(t *testing.T) {
	s := &AskUNIService{rdb: nil, now: time.Now}
	ctx := context.Background()
	for i := 0; i < askRateLimit; i++ {
		if err := s.rateLimit(ctx, "user-a"); err != nil {
			t.Fatalf("hit %d: %v", i+1, err)
		}
	}
	if err := s.rateLimit(ctx, "user-a"); err != ai.ErrRateLimited {
		t.Fatalf("want rate limited, got %v", err)
	}
}

// The counts belong to the service, like its per-pod run cap: a second
// service in the same process starts from zero for the same person.
func TestAskMemRateIsPerService(t *testing.T) {
	ctx := context.Background()
	spent := &AskUNIService{rdb: nil, now: time.Now}
	for i := 0; i < askRateLimit; i++ {
		if err := spent.rateLimit(ctx, "user-a"); err != nil {
			t.Fatalf("hit %d: %v", i+1, err)
		}
	}
	if err := spent.rateLimit(ctx, "user-a"); err != ai.ErrRateLimited {
		t.Fatalf("spent service: want rate limited, got %v", err)
	}
	fresh := &AskUNIService{rdb: nil, now: time.Now}
	if err := fresh.rateLimit(ctx, "user-a"); err != nil {
		t.Fatalf("fresh service: %v", err)
	}
}
