package realtime

import (
	"context"
	"errors"
	"testing"
	"time"

	redismock "github.com/go-redis/redismock/v9"
	"github.com/redis/go-redis/v9"
)

func TestShardedRelayNodeIDStopWait(t *testing.T) {
	rdb, _ := redismock.NewClientMock()
	relay := NewShardedStreamRelay(NewHub(), rdb, nil, ShardedStreamRelayConfig{})
	if relay.NodeID() == "" {
		t.Fatal("expected non-empty node id")
	}
	if relay.readRDB != relay.writeRDB {
		t.Fatal("expected nil read client to default to write client")
	}
	relay.Stop()
	if !relay.isStopping() {
		t.Fatal("expected isStopping after Stop")
	}
	// Wait with no goroutines returns immediately.
	relay.Wait()

	if got := ShardedStreamKey(3); got != "ws:relay:shard:3" {
		t.Fatalf("ShardedStreamKey = %q", got)
	}
}

func TestShardedRelayWithDefaultsBranches(t *testing.T) {
	c := ShardedStreamRelayConfig{Shards: 4}.withDefaults()
	if c.Shards != 4 {
		t.Fatalf("Shards = %d", c.Shards)
	}
	if c.StreamMaxLen != defaultShardedRelayStreamMaxLen || c.ReadCount != defaultShardedRelayReadCount ||
		c.ReadBlock != defaultShardedRelayReadBlock || c.ReplayGrace != defaultShardedRelayReplayGrace {
		t.Fatalf("defaults not applied: %+v", c)
	}
	full := ShardedStreamRelayConfig{Shards: 2, StreamMaxLen: 10, ReadCount: 5, ReadBlock: time.Second, ReplayGrace: time.Minute}.withDefaults()
	if full.Shards != 2 || full.StreamMaxLen != 10 || full.ReadCount != 5 || full.ReadBlock != time.Second || full.ReplayGrace != time.Minute {
		t.Fatalf("explicit config overwritten: %+v", full)
	}
}

func TestShardedRelayShardForBounded(t *testing.T) {
	relay := NewShardedStreamRelay(NewHub(), nil, nil, ShardedStreamRelayConfig{Shards: 8})
	seen := map[int]bool{}
	for _, scope := range []struct{ typ, id string }{
		{ScopeWorkspace, "ws1"}, {ScopeUser, "u1"}, {ScopeTask, "t1"}, {"global", "all"},
	} {
		s := relay.shardFor(scope.typ, scope.id)
		if s < 0 || s >= 8 {
			t.Fatalf("shard %d out of range", s)
		}
		seen[s] = true
	}
	if len(seen) == 0 {
		t.Fatal("expected shard mapping")
	}
}

func TestShardedRelayBroadcastWrappersSuccess(t *testing.T) {
	hub := NewHub()
	rdb, mock := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdb.Close() })
	anyMock := allowAnyRedisCommand(mock)
	relay := NewShardedStreamRelay(hub, rdb, rdb, ShardedStreamRelayConfig{Shards: 2})

	anyMock.ExpectXAdd(dummyXAddArgs(ShardedStreamKey(0))).SetVal("1-0")
	anyMock.ExpectXAdd(dummyXAddArgs(ShardedStreamKey(0))).SetVal("2-0")
	anyMock.ExpectXAdd(dummyXAddArgs(ShardedStreamKey(0))).SetVal("3-0")
	anyMock.ExpectXAdd(dummyXAddArgs(ShardedStreamKey(0))).SetVal("4-0")
	anyMock.ExpectXAdd(dummyXAddArgs(ShardedStreamKey(0))).SetVal("5-0")

	relay.BroadcastToScope(ScopeWorkspace, "ws1", []byte(`{"type":"a"}`))
	relay.BroadcastToWorkspace("ws1", []byte(`{"type":"b"}`))
	relay.SendToUser("u1", []byte(`{"type":"c"}`))
	relay.SendToUser("u1", []byte(`{"type":"d"}`), "ws-excluded")
	relay.Broadcast([]byte(`{"type":"e"}`))
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestShardedRelayPublishError(t *testing.T) {
	rdb, mock := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdb.Close() })
	anyMock := allowAnyRedisCommand(mock)
	relay := NewShardedStreamRelay(NewHub(), rdb, rdb, ShardedStreamRelayConfig{})
	anyMock.ExpectXAdd(dummyXAddArgs(ShardedStreamKey(0))).SetErr(errors.New("boom"))
	anyMock.ExpectXAdd(dummyXAddArgs(ShardedStreamKey(0))).SetErr(errors.New("boom"))
	anyMock.ExpectXAdd(dummyXAddArgs(ShardedStreamKey(0))).SetErr(errors.New("boom"))
	if err := relay.PublishWithID(ScopeWorkspace, "ws1", "", []byte(`{"type":"x"}`), "id-1"); err == nil {
		t.Fatal("expected XADD error")
	}
	// Wrappers swallow errors and must not panic.
	relay.BroadcastToScope(ScopeWorkspace, "ws1", []byte(`{"type":"x"}`))
	relay.Broadcast([]byte(`{"type":"x"}`))
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestShardedRelayDeliverMessageDrops(t *testing.T) {
	relay := NewShardedStreamRelay(NewHub(), nil, nil, ShardedStreamRelayConfig{})
	// Empty payload.
	relay.deliverMessage(redis.XMessage{Values: map[string]any{}})
	// Missing scope.
	relay.deliverMessage(redis.XMessage{Values: map[string]any{
		"event_id": "e1", "scope_id": "ws1", "payload_json": `{"type":"x"}`,
	}})
	// Missing scope id.
	relay.deliverMessage(redis.XMessage{Values: map[string]any{
		"event_id": "e2", "scope": ScopeWorkspace, "payload_json": `{"type":"x"}`,
	}})
}

func TestShardedRelayReadShardOnceVariants(t *testing.T) {
	hub := NewHub()

	// redis.Nil advances nothing but continues.
	rdbNil, mockNil := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdbNil.Close() })
	relayNil := NewShardedStreamRelay(hub, rdbNil, rdbNil, ShardedStreamRelayConfig{ReadBlock: time.Millisecond, ReadCount: 2, ReplayGrace: time.Minute})
	stream := ShardedStreamKey(0)
	lastID := "100-0"
	mockNil.ExpectXRead(&redis.XReadArgs{Streams: []string{stream, lastID}, Count: 2, Block: time.Millisecond}).SetErr(redis.Nil)
	if !relayNil.readShardOnce(context.Background(), 0, stream, &lastID) {
		t.Fatal("redis.Nil should continue")
	}
	if lastID != "100-0" {
		t.Fatalf("lastID changed on Nil: %q", lastID)
	}

	// DeadlineExceeded continues.
	rdbTO, mockTO := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdbTO.Close() })
	relayTO := NewShardedStreamRelay(hub, rdbTO, rdbTO, ShardedStreamRelayConfig{ReadBlock: time.Millisecond, ReadCount: 2, ReplayGrace: time.Minute})
	lastID2 := "100-0"
	mockTO.ExpectXRead(&redis.XReadArgs{Streams: []string{stream, lastID2}, Count: 2, Block: time.Millisecond}).SetErr(context.DeadlineExceeded)
	if !relayTO.readShardOnce(context.Background(), 0, stream, &lastID2) {
		t.Fatal("DeadlineExceeded should continue")
	}

	// Generic error with cancelled context exits quickly without the 1s backoff.
	rdbErr, mockErr := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdbErr.Close() })
	relayErr := NewShardedStreamRelay(hub, rdbErr, rdbErr, ShardedStreamRelayConfig{ReadBlock: time.Millisecond, ReadCount: 2, ReplayGrace: time.Minute})
	lastID3 := "100-0"
	mockErr.ExpectXRead(&redis.XReadArgs{Streams: []string{stream, lastID3}, Count: 2, Block: time.Millisecond}).SetErr(errors.New("boom"))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if relayErr.readShardOnce(ctx, 0, stream, &lastID3) {
		t.Fatal("cancelled context should stop the shard loop")
	}

	// Success with mixed valid/invalid messages advances lastID past each.
	hub4 := NewHub()
	client := attachRealtimeTestClient(hub4, ScopeTask, "task-multi")
	rdbOK, mockOK := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdbOK.Close() })
	relayOK := NewShardedStreamRelay(hub4, rdbOK, rdbOK, ShardedStreamRelayConfig{ReadBlock: time.Millisecond, ReadCount: 10, ReplayGrace: time.Minute})
	lastID4 := "100-0"
	mockOK.ExpectXRead(&redis.XReadArgs{Streams: []string{stream, lastID4}, Count: 10, Block: time.Millisecond}).SetVal([]redis.XStream{{
		Stream: stream,
		Messages: []redis.XMessage{
			{ID: "101-0", Values: map[string]any{"event_id": "drop", "payload_json": ""}},
			{ID: "102-0", Values: envelopeRedisValues(envelope{EventID: "e-multi", Scope: ScopeTask, ScopeID: "task-multi", PayloadJSON: `{"type":"task:updated"}`})},
		},
	}})
	if !relayOK.readShardOnce(context.Background(), 0, stream, &lastID4) {
		t.Fatal("successful read should continue")
	}
	if lastID4 != "102-0" {
		t.Fatalf("lastID = %q, want 102-0", lastID4)
	}
	select {
	case <-client.send:
	case <-time.After(time.Second):
		t.Fatal("expected valid message delivery")
	}
}

func TestShardedRelayReadShardExits(t *testing.T) {
	bad := redis.NewClient(&redis.Options{Addr: "127.0.0.1:0"})
	t.Cleanup(func() { bad.Close() })
	relay := NewShardedStreamRelay(NewHub(), bad, bad, ShardedStreamRelayConfig{})

	// Cancelled context exits immediately.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	relay.readShard(ctx, 0)

	// Stopping flag exits immediately.
	relay2 := NewShardedStreamRelay(NewHub(), bad, bad, ShardedStreamRelayConfig{})
	relay2.Stop()
	relay2.readShard(context.Background(), 0)
}

func TestShardedRelayHeartbeatOnce(t *testing.T) {
	hub := NewHub()
	rdbFail, mockFail := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdbFail.Close() })
	anyFail := allowAnyRedisCommand(mockFail)
	relayFail := NewShardedStreamRelay(hub, rdbFail, rdbFail, ShardedStreamRelayConfig{})
	anyFail.ExpectSet(HeartbeatKey(relayFail.NodeID()), "v", heartbeatTTL).SetErr(errors.New("down"))
	relayFail.heartbeatOnce(context.Background())
	if err := mockFail.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}

	rdb, mock := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdb.Close() })
	anyMock := allowAnyRedisCommand(mock)
	relay := NewShardedStreamRelay(hub, rdb, rdb, ShardedStreamRelayConfig{})
	anyMock.ExpectSet(HeartbeatKey(relay.NodeID()), "v", heartbeatTTL).SetVal("OK")
	relay.heartbeatOnce(context.Background())
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestShardedRelayStartPingBranches(t *testing.T) {
	// Shared-client success with one shard.
	hub := NewHub()
	rdb, mock := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdb.Close() })
	mock.MatchExpectationsInOrder(false)
	anyMock := allowAnyRedisCommand(mock)
	relay := NewShardedStreamRelay(hub, rdb, rdb, ShardedStreamRelayConfig{Shards: 1, ReadBlock: time.Millisecond, ReadCount: 1, ReplayGrace: time.Minute})
	anyMock.ExpectPing().SetVal("PONG")
	// readShard blocks in XREAD; fail fast with Nil so the loop spins until cancel.
	// The cursor is time-derived, so the dummy only needs the same shape.
	anyMock.ExpectXRead(&redis.XReadArgs{Streams: []string{ShardedStreamKey(0), "0-0"}, Count: 1, Block: time.Millisecond}).SetErr(redis.Nil)
	anyMock.ExpectSet(HeartbeatKey(relay.NodeID()), "v", heartbeatTTL).SetVal("OK")
	ctx, cancel := context.WithCancel(context.Background())
	relay.Start(ctx)
	waitForExpectations(t, mock)
	cancel()
	relay.Wait()
	relay.Stop()

	// Write ping failure.
	hub2 := NewHub()
	rdb2, mock2 := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdb2.Close() })
	mock2.MatchExpectationsInOrder(false)
	anyMock2 := allowAnyRedisCommand(mock2)
	relay2 := NewShardedStreamRelay(hub2, rdb2, rdb2, ShardedStreamRelayConfig{Shards: 1, ReadBlock: time.Millisecond, ReadCount: 1, ReplayGrace: time.Minute})
	anyMock2.ExpectPing().SetErr(errors.New("ping down"))
	anyMock2.ExpectXRead(&redis.XReadArgs{Streams: []string{ShardedStreamKey(0), "0-0"}, Count: 1, Block: time.Millisecond}).SetErr(redis.Nil)
	anyMock2.ExpectSet(HeartbeatKey(relay2.NodeID()), "v", heartbeatTTL).SetVal("OK")
	ctx2, cancel2 := context.WithCancel(context.Background())
	relay2.Start(ctx2)
	waitForExpectations(t, mock2)
	cancel2()
	relay2.Wait()
	relay2.Stop()

	// Separate read client whose ping fails.
	hub3 := NewHub()
	wrdb, wmock := redismock.NewClientMock()
	rrdb, rmock := redismock.NewClientMock()
	t.Cleanup(func() { _ = wrdb.Close(); _ = rrdb.Close() })
	wmock.MatchExpectationsInOrder(false)
	rmock.MatchExpectationsInOrder(false)
	wAny := allowAnyRedisCommand(wmock)
	rAny := allowAnyRedisCommand(rmock)
	relay3 := NewShardedStreamRelay(hub3, wrdb, rrdb, ShardedStreamRelayConfig{Shards: 1, ReadBlock: time.Millisecond, ReadCount: 1, ReplayGrace: time.Minute})
	wAny.ExpectPing().SetVal("PONG")
	rAny.ExpectPing().SetErr(errors.New("read down"))
	wAny.ExpectSet(HeartbeatKey(relay3.NodeID()), "v", heartbeatTTL).SetVal("OK")
	rAny.ExpectXRead(&redis.XReadArgs{Streams: []string{ShardedStreamKey(0), "0-0"}, Count: 1, Block: time.Millisecond}).SetErr(redis.Nil)
	ctx3, cancel3 := context.WithCancel(context.Background())
	relay3.Start(ctx3)
	waitForExpectations(t, wmock, rmock)
	cancel3()
	relay3.Wait()
	relay3.Stop()
}
