package auth

import (
	"context"
	"os"
	"testing"

	"github.com/redis/go-redis/v9"
)

// redisTestDB keeps test keys away from any local dev data on the same server.
const redisTestDB = 15

// newRedisTestClient connects to REDIS_TEST_URL (skipping the test when it is
// unset), selects an isolated database, and flushes it before and after the
// test so rate-limit counters from one case never bleed into the next.
func newRedisTestClient(t *testing.T) *redis.Client {
	t.Helper()
	url := os.Getenv("REDIS_TEST_URL")
	if url == "" {
		t.Skip("REDIS_TEST_URL not set")
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("parse REDIS_TEST_URL: %v", err)
	}
	opts.DB = redisTestDB
	rdb := redis.NewClient(opts)
	ctx := context.Background()
	if err := rdb.FlushDB(ctx).Err(); err != nil {
		t.Fatalf("flush redis test db: %v", err)
	}
	t.Cleanup(func() {
		_ = rdb.FlushDB(ctx).Err()
		_ = rdb.Close()
	})
	return rdb
}
