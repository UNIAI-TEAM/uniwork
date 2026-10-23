package realtime

import (
	"context"
	"encoding/json"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// relayTestRedis returns a client on this package's Redis test database,
// flushed before and after the test, or skips without REDIS_TEST_URL.
func relayTestRedis(t *testing.T) *redis.Client {
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
	bg := context.Background()
	if err := rdb.FlushDB(bg).Err(); err != nil {
		t.Fatalf("flush redis test db: %v", err)
	}
	t.Cleanup(func() {
		_ = rdb.FlushDB(bg).Err()
		_ = rdb.Close()
	})
	return rdb
}

// attachBufferedClient joins a client to one scope room with room for a
// backlog, so a replay shows up as extra frames instead of an eviction.
func attachBufferedClient(hub *Hub, scopeType, scopeID string) *Client {
	c := &Client{
		send:          make(chan []byte, 64),
		workspaceID:   "workspace-1",
		userID:        "user-1",
		subscriptions: map[scopeKey]bool{sk(scopeType, scopeID): true},
	}
	hub.mu.Lock()
	hub.clients[c] = true
	if hub.rooms[sk(scopeType, scopeID)] == nil {
		hub.rooms[sk(scopeType, scopeID)] = map[*Client]bool{}
	}
	hub.rooms[sk(scopeType, scopeID)][c] = true
	hub.mu.Unlock()
	return c
}

func detachClient(hub *Hub, c *Client, scopeType, scopeID string) {
	hub.mu.Lock()
	delete(hub.clients, c)
	delete(hub.rooms[sk(scopeType, scopeID)], c)
	if len(hub.rooms[sk(scopeType, scopeID)]) == 0 {
		delete(hub.rooms, sk(scopeType, scopeID))
	}
	hub.mu.Unlock()
}

// waitConsumerReading blocks until the relay's consumer for stream has
// issued an XREADGROUP (Redis creates the consumer on its first read).
func waitConsumerReading(t *testing.T, rdb *redis.Client, r *RedisRelay, stream string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		cs, err := rdb.XInfoConsumers(context.Background(), stream, "node:"+r.nodeID).Result()
		if err == nil && slices.ContainsFunc(cs, func(c redis.XInfoConsumer) bool { return c.Name == r.nodeID }) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("consumer on %s never started reading", stream)
}

// waitGroupGone blocks until the relay's group on stream is destroyed,
// which its consumer does last on the way out.
func waitGroupGone(t *testing.T, rdb *redis.Client, r *RedisRelay, stream string) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		groups, err := rdb.XInfoGroups(context.Background(), stream).Result()
		if err == nil && !slices.ContainsFunc(groups, func(g redis.XInfoGroup) bool { return g.Name == "node:"+r.nodeID }) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("group of %s on %s was never destroyed", r.nodeID, stream)
}

// framesWithin collects every event id the client receives within d.
func framesWithin(c *Client, d time.Duration) []string {
	var ids []string
	timeout := time.After(d)
	for {
		select {
		case raw := <-c.send:
			var probe struct {
				EventID string `json:"event_id"`
			}
			_ = json.Unmarshal(raw, &probe)
			ids = append(ids, probe.EventID)
		case <-timeout:
			return ids
		}
	}
}

func startTestRelay(t *testing.T, rdb *redis.Client, hub *Hub) (*RedisRelay, context.Context) {
	t.Helper()
	r := NewRedisRelay(hub, rdb)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		r.Stop()
		cancel()
		r.Wait()
	})
	return r, ctx
}

// A lobby room emptied and filled again must not hand its new member the
// approvals published while nobody on this node listened: the group kept
// its last-delivered id, so XREADGROUP '>' replayed the whole gap.
func TestRelayResubscribeDoesNotReplayTheGap(t *testing.T) {
	rdb := relayTestRedis(t)
	hub := NewHub()
	relay, ctx := startTestRelay(t, rdb, hub)
	other := NewRedisRelay(NewHub(), rdb)
	const scope, id = ScopeMeeting, "lobby-gap"
	stream := StreamKey(scope, id)

	first := attachBufferedClient(hub, scope, id)
	relay.startConsumer(ctx, scope, id)
	waitConsumerReading(t, rdb, relay, stream)
	if err := other.PublishWithID(scope, id, "", []byte(`{"type":"x"}`), "e1"); err != nil {
		t.Fatal(err)
	}
	if got := framesWithin(first, 300*time.Millisecond); !slices.Equal(got, []string{"e1"}) {
		t.Fatalf("first subscriber got %v, want [e1]", got)
	}

	detachClient(hub, first, scope, id)
	relay.stopConsumer(scope, id)
	waitGroupGone(t, rdb, relay, stream)
	for _, e := range []string{"e2", "e3"} {
		if err := other.PublishWithID(scope, id, "", []byte(`{"type":"x"}`), e); err != nil {
			t.Fatal(err)
		}
	}

	second := attachBufferedClient(hub, scope, id)
	relay.startConsumer(ctx, scope, id)
	waitConsumerReading(t, rdb, relay, stream)
	if err := other.PublishWithID(scope, id, "", []byte(`{"type":"x"}`), "e4"); err != nil {
		t.Fatal(err)
	}
	if got := framesWithin(second, 300*time.Millisecond); !slices.Equal(got, []string{"e4"}) {
		t.Fatalf("resubscribed client got %v, want only [e4]", got)
	}
}

// A group that outlived its consumer (a stop whose cleanup never reached
// Redis) is moved to the tail instead of being read from where it stopped.
func TestRelayMovesALeftoverGroupToTheTail(t *testing.T) {
	rdb := relayTestRedis(t)
	hub := NewHub()
	relay, ctx := startTestRelay(t, rdb, hub)
	other := NewRedisRelay(NewHub(), rdb)
	const scope, id = ScopeMeeting, "lobby-leftover"
	stream := StreamKey(scope, id)
	bg := context.Background()

	if err := other.PublishWithID(scope, id, "", []byte(`{"type":"x"}`), "old"); err != nil {
		t.Fatal(err)
	}
	if err := rdb.XGroupCreate(bg, stream, "node:"+relay.nodeID, "0").Err(); err != nil {
		t.Fatal(err)
	}

	c := attachBufferedClient(hub, scope, id)
	relay.startConsumer(ctx, scope, id)
	waitConsumerReading(t, rdb, relay, stream)
	if err := other.PublishWithID(scope, id, "", []byte(`{"type":"x"}`), "new"); err != nil {
		t.Fatal(err)
	}
	if got := framesWithin(c, 300*time.Millisecond); !slices.Equal(got, []string{"new"}) {
		t.Fatalf("client got %v, want only [new]", got)
	}
}

// Stopping a scope's consumer removes this node's group from the stream;
// another node's group on the same stream is untouched.
func TestRelayStopDestroysOnlyItsOwnGroup(t *testing.T) {
	rdb := relayTestRedis(t)
	hub := NewHub()
	relay, ctx := startTestRelay(t, rdb, hub)
	const scope, id = ScopeWorkspace, "ws-destroy"
	stream := StreamKey(scope, id)
	bg := context.Background()

	if err := rdb.XGroupCreateMkStream(bg, stream, "node:someone-else", "$").Err(); err != nil {
		t.Fatal(err)
	}
	relay.startConsumer(ctx, scope, id)
	waitConsumerReading(t, rdb, relay, stream)
	relay.stopConsumer(scope, id)
	waitGroupGone(t, rdb, relay, stream)

	groups, err := rdb.XInfoGroups(bg, stream).Result()
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, g := range groups {
		names = append(names, g.Name)
	}
	if !slices.Equal(names, []string{"node:someone-else"}) {
		t.Fatalf("groups after stop = %v, want only the other node's", names)
	}
}

// A stop followed at once by a start (a member leaving and rejoining) ends
// with a working consumer: the old one's cleanup cannot take the new one's
// group away.
func TestRelayRestartRightAfterStopStillDelivers(t *testing.T) {
	rdb := relayTestRedis(t)
	hub := NewHub()
	relay, ctx := startTestRelay(t, rdb, hub)
	other := NewRedisRelay(NewHub(), rdb)
	const scope, id = ScopeMeeting, "lobby-flap"
	stream := StreamKey(scope, id)

	c := attachBufferedClient(hub, scope, id)
	relay.startConsumer(ctx, scope, id)
	waitConsumerReading(t, rdb, relay, stream)
	relay.stopConsumer(scope, id)
	relay.startConsumer(ctx, scope, id)

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if err := other.PublishWithID(scope, id, "", []byte(`{"type":"x"}`), "flap"); err != nil {
			t.Fatal(err)
		}
		if got := framesWithin(c, 200*time.Millisecond); len(got) > 0 {
			return
		}
	}
	t.Fatal("restarted consumer never delivered")
}

// A stream that disappears under a live consumer (expired or deleted) is
// recreated by that consumer rather than leaving it failing on NOGROUP.
func TestRelayRecreatesAVanishedStream(t *testing.T) {
	rdb := relayTestRedis(t)
	hub := NewHub()
	relay, ctx := startTestRelay(t, rdb, hub)
	other := NewRedisRelay(NewHub(), rdb)
	const scope, id = ScopeWorkspace, "ws-vanish"
	stream := StreamKey(scope, id)

	c := attachBufferedClient(hub, scope, id)
	relay.startConsumer(ctx, scope, id)
	waitConsumerReading(t, rdb, relay, stream)
	if err := rdb.Del(context.Background(), stream).Err(); err != nil {
		t.Fatal(err)
	}
	// The consumer recreates the stream and its group, and the recreated
	// stream expires like any other.
	waitConsumerReading(t, rdb, relay, stream)
	if ttl := rdb.TTL(context.Background(), stream).Val(); ttl <= 0 {
		t.Fatalf("recreated stream TTL = %v, want > 0", ttl)
	}

	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		if err := other.PublishWithID(scope, id, "", []byte(`{"type":"x"}`), "again"); err != nil {
			t.Fatal(err)
		}
		if got := framesWithin(c, 200*time.Millisecond); len(got) > 0 {
			return
		}
	}
	t.Fatal("consumer never recovered after its stream vanished")
}

// Per-scope keys carry a TTL: publishing refreshes the stream's, and a node
// with local subscribers keeps both its stream and its registry alive.
func TestRelayKeysExpireWhenIdle(t *testing.T) {
	rdb := relayTestRedis(t)
	hub := NewHub()
	relay, ctx := startTestRelay(t, rdb, hub)
	bg := context.Background()

	if err := relay.PublishWithID(ScopeTask, "t-ttl", "", []byte(`{"type":"x"}`), "e"); err != nil {
		t.Fatal(err)
	}
	if ttl := rdb.TTL(bg, StreamKey(ScopeTask, "t-ttl")).Val(); ttl <= 0 || ttl > streamIdleTTL {
		t.Fatalf("published stream TTL = %v, want (0, %v]", ttl, streamIdleTTL)
	}

	const scope, id = ScopeWorkspace, "ws-ttl"
	attachBufferedClient(hub, scope, id)
	relay.startConsumer(ctx, scope, id)
	waitConsumerReading(t, rdb, relay, StreamKey(scope, id))
	for _, key := range []string{StreamKey(scope, id), NodesKey(scope, id)} {
		if ttl := rdb.TTL(bg, key).Val(); ttl <= 0 {
			t.Fatalf("%s TTL = %v after the consumer registered, want > 0", key, ttl)
		}
		if err := rdb.Expire(bg, key, 5*time.Second).Err(); err != nil {
			t.Fatal(err)
		}
	}
	relay.heartbeatOnce(bg)
	for _, key := range []string{StreamKey(scope, id), NodesKey(scope, id)} {
		if ttl := rdb.TTL(bg, key).Val(); ttl <= 5*time.Second {
			t.Fatalf("%s TTL = %v after a heartbeat, want it refreshed", key, ttl)
		}
	}
}

// The dual-write path already fanned an event out on this node, so the
// relay drops that envelope when its own consumer reads it back; an event
// published straight through the relay still loops back, because nothing
// else delivers it locally.
func TestRelaySkipsItsOwnDualWriteLoopback(t *testing.T) {
	rdb := relayTestRedis(t)
	hub := NewHub()
	relay, _ := startTestRelay(t, rdb, hub)
	dual := NewDualWriteBroadcaster(hub, relay)
	const scope, id = ScopeWorkspace, "ws-loop"

	c := attachBufferedClient(hub, scope, id)
	dual.BroadcastToScope(scope, id, []byte(`{"type":"x"}`))
	drainClientSend(c)

	msgs, err := rdb.XRange(context.Background(), StreamKey(scope, id), "-", "+").Result()
	if err != nil || len(msgs) != 1 {
		t.Fatalf("stream entries = %v (err %v), want 1", msgs, err)
	}
	// A fresh client stands in for one that has not seen the event: the
	// hub's per-client dedup must not be what hides the loopback.
	hub2 := NewHub()
	fresh := attachBufferedClient(hub2, scope, id)
	own := NewRedisRelay(hub2, rdb)
	own.nodeID = relay.nodeID
	own.deliverMessage(scope, id, msgs[0])
	if got := framesWithin(fresh, 100*time.Millisecond); len(got) != 0 {
		t.Fatalf("own dual-write loopback delivered %v, want nothing", got)
	}

	foreign := NewRedisRelay(hub2, rdb)
	foreign.deliverMessage(scope, id, msgs[0])
	if got := framesWithin(fresh, 100*time.Millisecond); len(got) != 1 {
		t.Fatalf("another node's copy delivered %v, want one frame", got)
	}

	if err := relay.PublishWithID(scope, id, "", []byte(`{"type":"y"}`), "direct"); err != nil {
		t.Fatal(err)
	}
	msgs, err = rdb.XRange(context.Background(), StreamKey(scope, id), "-", "+").Result()
	if err != nil || len(msgs) != 2 {
		t.Fatalf("stream entries = %d (err %v), want 2", len(msgs), err)
	}
	own.deliverMessage(scope, id, msgs[1])
	if got := framesWithin(fresh, 100*time.Millisecond); !slices.Equal(got, []string{"direct"}) {
		t.Fatalf("direct publish loopback delivered %v, want [direct]", got)
	}
}

// A node that died without cleaning up (SIGKILL, or a shutdown that did not
// wait out its blocked reads) leaves its group on every stream it read. A
// stream someone still listens on never goes idle long enough to expire,
// so the sweep of a live node drops the dead node's group along with its
// registry entry, and leaves a live node's alone.
func TestRelaySweepDestroysDeadNodesGroups(t *testing.T) {
	rdb := relayTestRedis(t)
	hub := NewHub()
	relay, _ := startTestRelay(t, rdb, hub)
	const scope, id = ScopeWorkspace, "ws-sweep"
	stream, nodes := StreamKey(scope, id), NodesKey(scope, id)
	bg := context.Background()

	attachBufferedClient(hub, scope, id)
	for _, g := range []string{"node:dead", "node:alive"} {
		if err := rdb.XGroupCreateMkStream(bg, stream, g, "$").Err(); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	if err := rdb.ZAdd(bg, nodes,
		redis.Z{Score: float64(now.Add(-time.Minute).Unix()), Member: "dead"},
		redis.Z{Score: float64(now.Add(time.Minute).Unix()), Member: "alive"},
	).Err(); err != nil {
		t.Fatal(err)
	}

	relay.sweepOnce(bg, now)

	groups, err := rdb.XInfoGroups(bg, stream).Result()
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, g := range groups {
		names = append(names, g.Name)
	}
	if !slices.Equal(names, []string{"node:alive"}) {
		t.Fatalf("groups after sweep = %v, want only the live node's", names)
	}
	if members := rdb.ZRange(bg, nodes, 0, -1).Val(); !slices.Equal(members, []string{"alive"}) {
		t.Fatalf("registry after sweep = %v, want [alive]", members)
	}
}
