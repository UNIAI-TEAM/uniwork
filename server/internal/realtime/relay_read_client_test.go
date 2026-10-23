package realtime

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// redisTestDB differs from every other package's (auth 15, middleware 14):
// `go test ./...` runs packages in parallel and each flushes its own DB.
const redisTestDB = 13

func TestNewRelayReadClientHasItsOwnPool(t *testing.T) {
	shared := redis.NewClient(&redis.Options{Addr: "127.0.0.1:0", DB: 3, Password: "pw", PoolSize: 7})
	t.Cleanup(func() { _ = shared.Close() })

	reader := NewRelayReadClient(shared)
	t.Cleanup(func() { _ = reader.Close() })

	if reader == shared {
		t.Fatal("reader must be a separate client")
	}
	got := reader.Options()
	if got.PoolSize != relayReadPoolSize {
		t.Fatalf("reader PoolSize = %d, want %d", got.PoolSize, relayReadPoolSize)
	}
	if got.Addr != "127.0.0.1:0" || got.DB != 3 || got.Password != "pw" {
		t.Fatalf("reader must reach the same server and database, got %s db=%d", got.Addr, got.DB)
	}
	if shared.Options().PoolSize != 7 {
		t.Fatalf("shared options were mutated: PoolSize = %d", shared.Options().PoolSize)
	}
}

// One blocked XREADGROUP per scope must not take the connections that every
// HTTP request needs (the global rate limiter, the membership cache): that
// starvation made /healthz miss its probe timeout and got the pod killed.
func TestRelayConsumersDoNotStarveTheSharedPool(t *testing.T) {
	url := os.Getenv("REDIS_TEST_URL")
	if url == "" {
		t.Skip("REDIS_TEST_URL not set")
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("parse REDIS_TEST_URL: %v", err)
	}
	opts.DB = redisTestDB
	opts.PoolSize = 2
	shared := redis.NewClient(opts)
	reader := NewRelayReadClient(shared)
	bg := context.Background()
	if err := shared.FlushDB(bg).Err(); err != nil {
		t.Fatalf("flush redis test db: %v", err)
	}

	hub := NewHub()
	relay := NewRedisRelayWithClients(hub, shared, reader)
	ctx, cancel := context.WithCancel(bg)
	relay.Start(ctx)
	t.Cleanup(func() {
		relay.Stop()
		cancel()
		relay.Wait()
		_ = shared.FlushDB(bg).Err()
		_ = reader.Close()
		_ = shared.Close()
	})

	for i := range 2 * opts.PoolSize {
		relay.startConsumer(ctx, ScopeWorkspace, fmt.Sprintf("starve-%d", i))
	}
	time.Sleep(500 * time.Millisecond) // every consumer is now blocked in XREADGROUP

	pingCtx, pingCancel := context.WithTimeout(bg, 500*time.Millisecond)
	defer pingCancel()
	if err := shared.Ping(pingCtx).Err(); err != nil {
		t.Fatalf("shared client starved by relay consumers: %v", err)
	}
}
