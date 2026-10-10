package realtime

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// roundTrips counts the commands and pipelines a client sends, each one a
// network round trip.
type roundTrips struct{ n atomic.Int64 }

func (h *roundTrips) DialHook(next redis.DialHook) redis.DialHook { return next }

func (h *roundTrips) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		h.n.Add(1)
		return next(ctx, cmd)
	}
}

func (h *roundTrips) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		h.n.Add(1)
		return next(ctx, cmds)
	}
}

// A room activity frame to a 1,000-member room costs two Redis round trips,
// not one XADD+EXPIRE per member, and only members with a socket on another
// node get a stream entry: an offline member, or one only this node serves
// (already delivered locally), gets nothing written for them.
func TestDualWriteSendToUsersWritesOnlyRemoteSocketsInTwoRoundTrips(t *testing.T) {
	rdb := relayTestRedis(t)
	hub := NewHub()
	relay := NewRedisRelay(hub, rdb)
	ctx := context.Background()
	live := float64(time.Now().Add(heartbeatTTL).Unix())
	stale := float64(time.Now().Add(-time.Minute).Unix())
	rdb.ZAdd(ctx, NodesKey(ScopeUser, "u-remote"), redis.Z{Score: live, Member: "other-node"})
	rdb.ZAdd(ctx, NodesKey(ScopeUser, "u-here"), redis.Z{Score: live, Member: relay.nodeID})
	rdb.ZAdd(ctx, NodesKey(ScopeUser, "u-gone"), redis.Z{Score: stale, Member: "other-node"})
	local := attachBufferedClient(hub, ScopeUser, "u-here")

	ids := []string{"u-remote", "u-here", "u-gone"}
	for i := range 997 {
		ids = append(ids, fmt.Sprintf("u-offline-%d", i))
	}
	counter := &roundTrips{}
	rdb.AddHook(counter)

	NewDualWriteBroadcaster(hub, relay).SendToUsers(ids, []byte(`{"type":"chat.room.activity"}`))

	if got := counter.n.Load(); got > 2 {
		t.Fatalf("round trips = %d, want at most 2", got)
	}
	if len(framesWithin(local, 50*time.Millisecond)) != 1 {
		t.Fatal("the member connected here did not get the frame")
	}
	streams, err := rdb.Keys(ctx, StreamKey(ScopeUser, "*")).Result()
	if err != nil {
		t.Fatal(err)
	}
	if len(streams) != 1 || streams[0] != StreamKey(ScopeUser, "u-remote") {
		t.Fatalf("user streams written = %v, want only u-remote's", streams)
	}
	if n := rdb.XLen(ctx, streams[0]).Val(); n != 1 {
		t.Fatalf("u-remote stream has %d entries, want 1", n)
	}
}

// blockingBroadcaster holds SendToUser until released, standing in for a
// slow Redis.
type blockingBroadcaster struct {
	Broadcaster
	release chan struct{}
	mu      sync.Mutex
	got     []string
}

func (b *blockingBroadcaster) SendToUser(userID string, _ []byte, _ ...string) {
	<-b.release
	b.mu.Lock()
	b.got = append(b.got, userID)
	b.mu.Unlock()
}

func (b *blockingBroadcaster) delivered() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.got)
}

// While Run drains the queue, SendToUsers returns before any delivery, and
// stopping Run still delivers what was queued.
func TestPublisherSendToUsersRunsOffTheCaller(t *testing.T) {
	b := &blockingBroadcaster{release: make(chan struct{})}
	pub := NewPublisher(b, slog.Default())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { pub.Run(ctx); close(done) }()
	waitRunning(t, pub)

	returned := make(chan struct{})
	go func() {
		pub.SendToUsers(context.Background(), []string{"u1", "u2"}, service.Event{Type: "chat.room.activity"})
		close(returned)
	}()
	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("SendToUsers waited on delivery")
	}
	cancel()
	close(b.release)
	<-done
	if got := b.delivered(); got != 2 {
		t.Fatalf("delivered %d users after shutdown, want 2", got)
	}
}

// Without Run (tests, tools) SendToUsers delivers on the caller.
func TestPublisherSendToUsersInlineWithoutRun(t *testing.T) {
	b := &blockingBroadcaster{release: make(chan struct{})}
	close(b.release)
	NewPublisher(b, slog.Default()).SendToUsers(context.Background(), []string{"u1"}, service.Event{Type: "x"})
	if b.delivered() != 1 {
		t.Fatal("inline delivery did not happen")
	}
}

func waitRunning(t *testing.T, pub *Publisher) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		pub.mu.RLock()
		running := pub.batches != nil
		pub.mu.RUnlock()
		if running {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("Run never started")
		}
		time.Sleep(time.Millisecond)
	}
}
