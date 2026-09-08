package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	redismock "github.com/go-redis/redismock/v9"
	"github.com/redis/go-redis/v9"
)

// allowAnyRedisCommand returns a clone of m that matches expectations by
// command name only, ignoring dynamic arguments (ULIDs, timestamps, scores).
// Set expectations on the returned clone, but always verify with
// ExpectationsWereMet on the ORIGINAL mock: the clone delegates storage to
// its parent, and calling ExpectationsWereMet on the clone itself recurses
// forever (redismock v9.2.0). Dummy values supplied to Expect* must still
// produce the same argument count as the real call.
func allowAnyRedisCommand(m redismock.ClientMock) redismock.ClientMock {
	return m.CustomMatch(func(expected, actual []interface{}) error {
		if len(expected) == 0 || len(actual) == 0 {
			return nil
		}
		if fmt.Sprint(expected[0]) != fmt.Sprint(actual[0]) {
			return fmt.Errorf("command mismatch: want %v got %v", expected[0], actual[0])
		}
		return nil
	})
}

func dummyXAddArgs(stream string) *redis.XAddArgs {
	return &redis.XAddArgs{
		Stream: stream,
		MaxLen: streamMaxLen,
		Approx: true,
		Values: envelopeRedisValues(envelope{
			EventID: "dummy", EventType: "t", Scope: "s", ScopeID: "id",
			WorkspaceID: "w", ActorID: "a", CreatedAt: "c", NodeID: "n", PayloadJSON: "{}",
		}),
	}
}

func waitForExpectations(t *testing.T, mocks ...redismock.ClientMock) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		allMet := true
		for _, m := range mocks {
			if err := m.ExpectationsWereMet(); err != nil {
				allMet = false
				break
			}
		}
		if allMet {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	for _, m := range mocks {
		if err := m.ExpectationsWereMet(); err != nil {
			t.Fatalf("redis expectations not met: %v", err)
		}
	}
}

func TestRelayKeyHelpers(t *testing.T) {
	if got := StreamKey("workspace", "ws1"); got != "ws:scope:workspace:ws1:stream" {
		t.Fatalf("StreamKey = %q", got)
	}
	if got := NodesKey("task", "t1"); got != "ws:scope:task:t1:nodes" {
		t.Fatalf("NodesKey = %q", got)
	}
	if got := HeartbeatKey("node1"); got != "ws:node:node1:heartbeat" {
		t.Fatalf("HeartbeatKey = %q", got)
	}
}

func TestNewEnvelopeVariants(t *testing.T) {
	ev := newEnvelope("node1", ScopeWorkspace, "ws1", "", []byte(`{"type":"issue:updated","actor_id":"u1"}`), "event-1")
	if ev.EventID != "event-1" || ev.NodeID != "node1" || ev.Scope != ScopeWorkspace || ev.ScopeID != "ws1" {
		t.Fatalf("unexpected envelope %+v", ev)
	}
	if ev.EventType != "issue:updated" || ev.ActorID != "u1" {
		t.Fatalf("expected type/actor lifted, got %+v", ev)
	}
	if ev.WorkspaceID != "" {
		t.Fatalf("expected empty workspace without exclude, got %q", ev.WorkspaceID)
	}

	excluded := newEnvelope("node1", ScopeUser, "u1", "ws9", []byte(`{"type":"x"}`), "event-2")
	if excluded.WorkspaceID != "ws9" {
		t.Fatalf("expected exclude preserved, got %q", excluded.WorkspaceID)
	}

	invalid := newEnvelope("node1", ScopeWorkspace, "ws1", "", []byte(`not json`), "event-3")
	if invalid.EventType != "" || invalid.ActorID != "" {
		t.Fatalf("expected empty type/actor for invalid frame, got %+v", invalid)
	}
	if typ, actor := peekTypeActor([]byte(`{"type":"a","actor_id":"b"}`)); typ != "a" || actor != "b" {
		t.Fatalf("peekTypeActor = %q/%q", typ, actor)
	}
	if typ, actor := peekTypeActor([]byte(`{bad`)); typ != "" || actor != "" {
		t.Fatalf("peekTypeActor on bad json = %q/%q", typ, actor)
	}
}

func TestRedisStringVariants(t *testing.T) {
	if got := redisString("hello"); got != "hello" {
		t.Fatalf("string branch = %q", got)
	}
	if got := redisString([]byte("bytes")); got != "bytes" {
		t.Fatalf("bytes branch = %q", got)
	}
	if got := redisString(42); got != "" {
		t.Fatalf("default branch = %q", got)
	}
	if got := redisString(nil); got != "" {
		t.Fatalf("nil branch = %q", got)
	}
}

func TestDeliverEnvelopeFanoutBranches(t *testing.T) {
	// Empty payload is a no-op.
	deliverEnvelope(NewHub(), envelope{EventID: "e0"})

	// Global fanout.
	hub := NewHub()
	globalClient := attachRealtimeTestClient(hub, ScopeWorkspace, "ws1")
	deliverEnvelope(hub, envelope{EventID: "e-global", Scope: "global", PayloadJSON: `{"type":"announce"}`})
	select {
	case raw := <-globalClient.send:
		if !strings.Contains(string(raw), "announce") {
			t.Fatalf("global fanout payload = %s", raw)
		}
	case <-time.After(time.Second):
		t.Fatal("expected global fanout delivery")
	}

	// User scope with exclude.
	hub2 := NewHub()
	inUser := &Client{send: make(chan []byte, 2), workspaceID: "ws1", userID: "u1", subscriptions: map[scopeKey]bool{}}
	outUser := &Client{send: make(chan []byte, 2), workspaceID: "ws-excluded", userID: "u1", subscriptions: map[scopeKey]bool{}}
	hub2.mu.Lock()
	hub2.clients[inUser] = true
	hub2.clients[outUser] = true
	hub2.rooms[sk(ScopeUser, "u1")] = map[*Client]bool{inUser: true, outUser: true}
	inUser.subscriptions[sk(ScopeUser, "u1")] = true
	outUser.subscriptions[sk(ScopeUser, "u1")] = true
	hub2.mu.Unlock()
	deliverEnvelope(hub2, envelope{EventID: "e-user", Scope: ScopeUser, ScopeID: "u1", WorkspaceID: "ws-excluded", PayloadJSON: `{"type":"dm"}`})
	select {
	case <-inUser.send:
	case <-time.After(time.Second):
		t.Fatal("expected user fanout delivery")
	}
	select {
	case msg := <-outUser.send:
		t.Fatalf("excluded workspace received user message: %s", msg)
	case <-time.After(20 * time.Millisecond):
	}

	// Default scope branch.
	hub3 := NewHub()
	taskClient := attachRealtimeTestClient(hub3, ScopeTask, "task-1")
	deliverEnvelope(hub3, envelope{EventID: "e-task", Scope: ScopeTask, ScopeID: "task-1", PayloadJSON: `{"type":"task:updated"}`})
	select {
	case raw := <-taskClient.send:
		var frame map[string]any
		if err := json.Unmarshal(raw, &frame); err != nil {
			t.Fatalf("task frame not JSON: %v", err)
		}
		if frame["event_id"] != "e-task" {
			t.Fatalf("event_id = %v", frame["event_id"])
		}
	case <-time.After(time.Second):
		t.Fatal("expected task scope delivery")
	}
}

func TestRedisRelayNodeIDAndNilReadClient(t *testing.T) {
	writeClient := redis.NewClient(&redis.Options{Addr: "127.0.0.1:0"})
	t.Cleanup(func() { writeClient.Close() })
	hub := NewHub()
	r := NewRedisRelayWithClients(hub, writeClient, nil)
	if r.readRDB != r.writeRDB {
		t.Fatal("expected nil read client to default to write client")
	}
	if r.NodeID() == "" {
		t.Fatal("expected non-empty node id")
	}
	single := NewRedisRelay(hub, writeClient)
	if single.NodeID() == "" {
		t.Fatal("expected non-empty node id from NewRedisRelay")
	}
	if NewDualWriteBroadcaster(hub, single) == nil {
		t.Fatal("expected dual-write broadcaster")
	}
}

func TestRedisRelayPublishWrappersSuccess(t *testing.T) {
	hub := NewHub()
	rdb, mock := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdb.Close() })
	anyMock := allowAnyRedisCommand(mock)
	relay := NewRedisRelay(hub, rdb)

	// One XADD per publish wrapper plus PublishWithID.
	anyMock.ExpectXAdd(dummyXAddArgs(StreamKey(ScopeWorkspace, "ws1"))).SetVal("1-0")
	anyMock.ExpectXAdd(dummyXAddArgs(StreamKey(ScopeWorkspace, "ws1"))).SetVal("2-0")
	anyMock.ExpectXAdd(dummyXAddArgs(StreamKey(ScopeUser, "u1"))).SetVal("3-0")
	anyMock.ExpectXAdd(dummyXAddArgs(StreamKey(ScopeUser, "u1"))).SetVal("4-0")
	anyMock.ExpectXAdd(dummyXAddArgs(StreamKey("global", "all"))).SetVal("5-0")
	anyMock.ExpectXAdd(dummyXAddArgs(StreamKey(ScopeTask, "t1"))).SetVal("6-0")

	relay.BroadcastToScope(ScopeWorkspace, "ws1", []byte(`{"type":"a"}`))
	relay.BroadcastToWorkspace("ws1", []byte(`{"type":"b"}`))
	relay.SendToUser("u1", []byte(`{"type":"c"}`))
	relay.SendToUser("u1", []byte(`{"type":"d"}`), "ws-excluded")
	relay.Broadcast([]byte(`{"type":"e"}`))
	if err := relay.PublishWithID(ScopeTask, "t1", "", []byte(`{"type":"f"}`), "fixed-id"); err != nil {
		t.Fatalf("PublishWithID: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRedisRelayPublishErrorPaths(t *testing.T) {
	hub := NewHub()
	rdb, mock := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdb.Close() })
	anyMock := allowAnyRedisCommand(mock)
	relay := NewRedisRelay(hub, rdb)

	// Error paths must not panic; XADD failures are logged and dropped.
	anyMock.ExpectXAdd(dummyXAddArgs(StreamKey(ScopeWorkspace, "ws1"))).SetErr(errors.New("boom"))
	anyMock.ExpectXAdd(dummyXAddArgs(StreamKey(ScopeWorkspace, "ws1"))).SetErr(errors.New("boom"))
	anyMock.ExpectXAdd(dummyXAddArgs(StreamKey(ScopeUser, "u1"))).SetErr(errors.New("boom"))
	anyMock.ExpectXAdd(dummyXAddArgs(StreamKey("global", "all"))).SetErr(errors.New("boom"))
	anyMock.ExpectXAdd(dummyXAddArgs(StreamKey(ScopeWorkspace, "ws1"))).SetErr(errors.New("boom"))
	relay.BroadcastToScope(ScopeWorkspace, "ws1", []byte(`{"type":"a"}`))
	relay.BroadcastToWorkspace("ws1", []byte(`{"type":"b"}`))
	relay.SendToUser("u1", []byte(`{"type":"c"}`))
	relay.Broadcast([]byte(`{"type":"d"}`))
	if err := relay.PublishWithID(ScopeWorkspace, "ws1", "", []byte(`{"type":"e"}`), "id-1"); err == nil {
		t.Fatal("expected PublishWithID error")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}

	// An unreachable redis surfaces the same error branch.
	bad := redis.NewClient(&redis.Options{Addr: "127.0.0.1:0"})
	t.Cleanup(func() { bad.Close() })
	badRelay := NewRedisRelay(hub, bad)
	if err := badRelay.PublishWithID(ScopeWorkspace, "ws1", "", []byte(`{"type":"e"}`), "id-2"); err == nil {
		t.Fatal("expected PublishWithID error against unreachable redis")
	}
}

func TestRedisRelayStartConsumerBranches(t *testing.T) {
	hub := NewHub()
	bad := redis.NewClient(&redis.Options{Addr: "127.0.0.1:0"})
	t.Cleanup(func() { bad.Close() })

	// Cancelled parent context: no consumer started.
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	r1 := NewRedisRelay(hub, bad)
	r1.startConsumer(cancelled, ScopeWorkspace, "ws-cancelled")
	r1.mu.Lock()
	n := len(r1.consumers)
	r1.mu.Unlock()
	if n != 0 {
		t.Fatalf("cancelled parent started %d consumers", n)
	}

	// Duplicate start: manually seed the map, then startConsumer is a no-op.
	r2 := NewRedisRelay(hub, bad)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	_, c2cancel := context.WithCancel(ctx)
	r2.mu.Lock()
	r2.consumers[sk(ScopeWorkspace, "ws-dup")] = &scopeConsumer{cancel: c2cancel, done: make(chan struct{})}
	r2.mu.Unlock()
	r2.startConsumer(ctx, ScopeWorkspace, "ws-dup")
	r2.mu.Lock()
	n = len(r2.consumers)
	r2.mu.Unlock()
	if n != 1 {
		t.Fatalf("duplicate start changed consumer count to %d", n)
	}
	c2cancel()

	// Happy-path start: consumer registered; the background loop serves a
	// Nil read and then backs off on unexpected reads until Stop cancels it.
	wrdb, wmock := redismock.NewClientMock()
	rrdb, rmock := redismock.NewClientMock()
	t.Cleanup(func() { _ = wrdb.Close(); _ = rrdb.Close() })
	wAny := allowAnyRedisCommand(wmock)
	rAny := allowAnyRedisCommand(rmock)
	r3 := NewRedisRelayWithClients(hub, wrdb, rrdb)
	r3.nodeID = "live-node-1"
	liveStream := StreamKey(ScopeWorkspace, "ws-live")
	liveGroup := "node:live-node-1"
	wAny.ExpectXGroupCreateMkStream(liveStream, liveGroup, "$").SetVal("OK")
	wAny.ExpectZAdd(NodesKey(ScopeWorkspace, "ws-live"), redis.Z{}).SetVal(1)
	rAny.ExpectXReadGroup(&redis.XReadGroupArgs{
		Group: liveGroup, Consumer: "live-node-1",
		Streams: []string{liveStream, ">"}, Count: 32, Block: 5 * time.Second,
	}).SetErr(redis.Nil)
	r3.startConsumer(ctx, ScopeWorkspace, "ws-live")
	// Second start for the same scope is a no-op.
	r3.startConsumer(ctx, ScopeWorkspace, "ws-live")
	r3.mu.Lock()
	if len(r3.consumers) != 1 {
		r3.mu.Unlock()
		t.Fatalf("expected 1 consumer")
	}
	r3.mu.Unlock()
	waitForExpectations(t, wmock, rmock)
	r3.Stop()
	stop()
	r3.Wait()
	if err := wmock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if err := rmock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRedisRelayStopConsumerBranches(t *testing.T) {
	hub := NewHub()
	bad := redis.NewClient(&redis.Options{Addr: "127.0.0.1:0"})
	t.Cleanup(func() { bad.Close() })
	relay := NewRedisRelay(hub, bad)

	// Unknown scope: no-op.
	relay.stopConsumer(ScopeWorkspace, "ws-missing")

	// Known scope: removed and cancelled.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	innerCtx, innerCancel := context.WithCancel(ctx)
	relay.mu.Lock()
	relay.consumers[sk(ScopeTask, "t1")] = &scopeConsumer{cancel: innerCancel, done: make(chan struct{})}
	relay.mu.Unlock()
	relay.stopConsumer(ScopeTask, "t1")
	relay.mu.Lock()
	_, ok := relay.consumers[sk(ScopeTask, "t1")]
	relay.mu.Unlock()
	if ok {
		t.Fatal("expected consumer to be removed")
	}
	select {
	case <-innerCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("expected consumer context cancelled")
	}
}

func TestRedisRelayDeliverMessageVariants(t *testing.T) {
	hub := NewHub()
	bad := redis.NewClient(&redis.Options{Addr: "127.0.0.1:0"})
	t.Cleanup(func() { bad.Close() })
	relay := NewRedisRelay(hub, bad)

	// Empty payload: dropped.
	relay.deliverMessage(ScopeTask, "task-1", redis.XMessage{Values: map[string]any{}})

	// Envelope scope empty: falls back to the consumer's scope.
	client := attachRealtimeTestClient(hub, ScopeTask, "task-fallback")
	relay.deliverMessage(ScopeTask, "task-fallback", redis.XMessage{Values: map[string]any{
		"event_id": "e-fallback", "payload_json": `{"type":"task:updated"}`,
	}})
	select {
	case <-client.send:
	case <-time.After(time.Second):
		t.Fatal("expected fallback-scope delivery")
	}

	// Envelope scope id empty: falls back to consumer scope id.
	hub2 := NewHub()
	client2 := attachRealtimeTestClient(hub2, ScopeWorkspace, "ws-fallback")
	relay2 := NewRedisRelay(hub2, bad)
	relay2.deliverMessage(ScopeWorkspace, "ws-fallback", redis.XMessage{Values: map[string]any{
		"event_id": "e-fallback-2", "scope": ScopeWorkspace, "payload_json": `{"type":"x"}`,
	}})
	select {
	case <-client2.send:
	case <-time.After(time.Second):
		t.Fatal("expected fallback scope-id delivery")
	}
}

func TestRedisRelayHeartbeatOnce(t *testing.T) {
	hub := NewHub()

	// Failure: Set errors flip RedisConnected off.
	rdbFail, mockFail := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdbFail.Close() })
	anyFail := allowAnyRedisCommand(mockFail)
	relayFail := NewRedisRelay(hub, rdbFail)
	anyFail.ExpectSet(HeartbeatKey(relayFail.NodeID()), "v", heartbeatTTL).SetErr(errors.New("down"))
	relayFail.heartbeatOnce(context.Background())
	if err := mockFail.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}

	// Success with local scopes fans out ZADDs.
	hub2 := NewHub()
	attachRealtimeTestClient(hub2, ScopeWorkspace, "ws-hb")
	rdb, mock := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdb.Close() })
	anyMock := allowAnyRedisCommand(mock)
	relay := NewRedisRelay(hub2, rdb)
	anyMock.ExpectSet(HeartbeatKey(relay.NodeID()), "v", heartbeatTTL).SetVal("OK")
	anyMock.ExpectZAdd(NodesKey(ScopeWorkspace, "ws-hb"), redis.Z{}).SetVal(1)
	relay.heartbeatOnce(context.Background())
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDualWriteBroadcasterWrappers(t *testing.T) {
	hub := NewHub()
	client := attachRealtimeTestClient(hub, ScopeWorkspace, "ws1")
	pub := &localFirstPublisher{t: t, client: client}
	b := newDualWriteBroadcaster(hub, pub)

	b.BroadcastToWorkspace("ws1", []byte(`{"type":"w"}`))
	if !pub.called || pub.scopeType != ScopeWorkspace {
		t.Fatalf("BroadcastToWorkspace relayed to %+v", pub)
	}
	drainClientSend(client)

	pub.called = false
	hub2 := NewHub()
	userClient := &Client{send: make(chan []byte, 4), workspaceID: "ws1", userID: "u1", subscriptions: map[scopeKey]bool{}}
	hub2.mu.Lock()
	hub2.clients[userClient] = true
	hub2.rooms[sk(ScopeUser, "u1")] = map[*Client]bool{userClient: true}
	userClient.subscriptions[sk(ScopeUser, "u1")] = true
	hub2.mu.Unlock()
	pub2 := &recordingDualPublisher{}
	b2 := newDualWriteBroadcaster(hub2, pub2)
	b2.SendToUser("u1", []byte(`{"type":"dm"}`), "ws-excluded")
	if len(pub2.calls) != 1 || pub2.calls[0].exclude != "ws-excluded" {
		t.Fatalf("SendToUser exclude not propagated: %+v", pub2.calls)
	}
	select {
	case <-userClient.send:
	case <-time.After(time.Second):
		t.Fatal("expected local user fanout")
	}

	b2.Broadcast([]byte(`{"type":"announce"}`))
	if len(pub2.calls) != 2 || pub2.calls[1].scopeType != "global" {
		t.Fatalf("Broadcast not relayed to global: %+v", pub2.calls)
	}
}

func drainClientSend(c *Client) {
	for {
		select {
		case <-c.send:
		default:
			return
		}
	}
}

type recordingDualPublisher struct {
	calls []relayPublishCall
}

func (r *recordingDualPublisher) PublishWithID(scopeType, scopeID, exclude string, frame []byte, id string) error {
	r.calls = append(r.calls, relayPublishCall{scopeType: scopeType, scopeID: scopeID, exclude: exclude, frame: string(frame), eventID: id})
	return nil
}

func TestInjectEventIDEdgeCases(t *testing.T) {
	if got := string(injectEventID([]byte(`{"a":1}`), "")); got != `{"a":1}` {
		t.Fatalf("empty id should be identity, got %s", got)
	}
	if got := string(injectEventID([]byte(`[1,2]`), "e1")); got != `[1,2]` {
		t.Fatalf("non-object should be identity, got %s", got)
	}
	if got := string(injectEventID([]byte(`{bad`), "e1")); got != `{bad` {
		t.Fatalf("invalid json should be identity, got %s", got)
	}
	existing := `{"event_id":"old","a":1}`
	if got := string(injectEventID([]byte(existing), "new")); got != existing {
		t.Fatalf("existing event_id should be preserved, got %s", got)
	}
	injected := injectEventID([]byte(`{"type":"x"}`), "e-new")
	var obj map[string]any
	if err := json.Unmarshal(injected, &obj); err != nil {
		t.Fatalf("injected frame not JSON: %v", err)
	}
	if obj["event_id"] != "e-new" {
		t.Fatalf("event_id not injected: %s", injected)
	}
}

func TestRedisRelayStartPingBranches(t *testing.T) {
	// Shared-client success.
	hub := NewHub()
	rdb, mock := redismock.NewClientMock()
	t.Cleanup(func() { _ = rdb.Close() })
	anyMock := allowAnyRedisCommand(mock)
	relay := NewRedisRelay(hub, rdb)
	anyMock.ExpectPing().SetVal("PONG")
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
	anyMock2 := allowAnyRedisCommand(mock2)
	relay2 := NewRedisRelay(hub2, rdb2)
	anyMock2.ExpectPing().SetErr(errors.New("ping down"))
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
	wAny := allowAnyRedisCommand(wmock)
	rAny := allowAnyRedisCommand(rmock)
	relay3 := NewRedisRelayWithClients(hub3, wrdb, rrdb)
	wAny.ExpectPing().SetVal("PONG")
	rAny.ExpectPing().SetErr(errors.New("read down"))
	wAny.ExpectSet(HeartbeatKey(relay3.NodeID()), "v", heartbeatTTL).SetVal("OK")
	ctx3, cancel3 := context.WithCancel(context.Background())
	relay3.Start(ctx3)
	waitForExpectations(t, wmock, rmock)
	cancel3()
	relay3.Wait()
	relay3.Stop()

	// Separate read client success, with a pre-existing local scope.
	hub4 := NewHub()
	attachRealtimeTestClient(hub4, ScopeWorkspace, "ws-start")
	wrdb4, wmock4 := redismock.NewClientMock()
	rrdb4, rmock4 := redismock.NewClientMock()
	t.Cleanup(func() { _ = wrdb4.Close(); _ = rrdb4.Close() })
	// Heartbeat and consumer goroutines race: match without order.
	wmock4.MatchExpectationsInOrder(false)
	rmock4.MatchExpectationsInOrder(false)
	wAny4 := allowAnyRedisCommand(wmock4)
	rAny4 := allowAnyRedisCommand(rmock4)
	relay4 := NewRedisRelayWithClients(hub4, wrdb4, rrdb4)
	relay4.nodeID = "start-node-1"
	stream4 := StreamKey(ScopeWorkspace, "ws-start")
	wAny4.ExpectPing().SetVal("PONG")
	rAny4.ExpectPing().SetVal("PONG")
	// startConsumer for the pre-existing scope: group create + node registry.
	wAny4.ExpectXGroupCreateMkStream(stream4, "node:start-node-1", "$").SetVal("OK")
	wAny4.ExpectZAdd(NodesKey(ScopeWorkspace, "ws-start"), redis.Z{}).SetVal(1)
	// Blocking read returns nothing; further reads error out and back off
	// until the test cancels below.
	rAny4.ExpectXReadGroup(&redis.XReadGroupArgs{
		Group: "node:start-node-1", Consumer: "start-node-1",
		Streams: []string{stream4, ">"}, Count: 32, Block: 5 * time.Second,
	}).SetErr(redis.Nil)
	// Heartbeat (runs concurrently with the consumer read above).
	wAny4.ExpectSet(HeartbeatKey("start-node-1"), "v", heartbeatTTL).SetVal("OK")
	wAny4.ExpectZAdd(NodesKey(ScopeWorkspace, "ws-start"), redis.Z{}).SetVal(1)
	ctx4, cancel4 := context.WithCancel(context.Background())
	relay4.Start(ctx4)
	waitForExpectations(t, wmock4, rmock4)
	cancel4()
	relay4.Wait()
	relay4.Stop()
}

func TestRedisRelayRunConsumerDeliversAndAcks(t *testing.T) {
	hub := NewHub()
	client := attachRealtimeTestClient(hub, ScopeWorkspace, "ws-consumer")
	wrdb, wmock := redismock.NewClientMock()
	rrdb, rmock := redismock.NewClientMock()
	t.Cleanup(func() { _ = wrdb.Close(); _ = rrdb.Close() })
	wAny := allowAnyRedisCommand(wmock)
	rAny := allowAnyRedisCommand(rmock)
	relay := NewRedisRelayWithClients(hub, wrdb, rrdb)
	relay.nodeID = "consumer-node-1"
	stream := StreamKey(ScopeWorkspace, "ws-consumer")
	group := "node:consumer-node-1"

	wAny.ExpectXGroupCreateMkStream(stream, group, "$").SetVal("OK")
	wAny.ExpectZAdd(NodesKey(ScopeWorkspace, "ws-consumer"), redis.Z{}).SetVal(1)
	rAny.ExpectXReadGroup(&redis.XReadGroupArgs{
		Group: group, Consumer: "consumer-node-1",
		Streams: []string{stream, ">"}, Count: 32, Block: 5 * time.Second,
	}).SetVal([]redis.XStream{{
		Stream: stream,
		Messages: []redis.XMessage{{
			ID: "1-0",
			Values: envelopeRedisValues(envelope{
				EventID: "e-consumer-1", Scope: ScopeWorkspace, ScopeID: "ws-consumer",
				PayloadJSON: `{"type":"issue:updated"}`,
			}),
		}},
	}})
	wAny.ExpectXAck(stream, group, "1-0").SetVal(1)
	// No cleanup expectation: after the ack the loop issues another read
	// with no expectation queued, hits the error backoff, and the cancel
	// below lands in that backoff (which returns without cleanup).

	ctx, cancel := context.WithCancel(context.Background())
	c := &scopeConsumer{done: make(chan struct{})}
	done := make(chan struct{})
	go func() { relay.runConsumer(ctx, c, ScopeWorkspace, "ws-consumer"); close(done) }()
	select {
	case raw := <-client.send:
		if !strings.Contains(string(raw), "issue:updated") {
			t.Fatalf("consumer payload = %s", raw)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected consumer delivery")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("runConsumer did not exit after cancel")
	}
	if err := wmock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if err := rmock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRedisRelayRunConsumerCleanupOnCancelledContext(t *testing.T) {
	hub := NewHub()
	wrdb, wmock := redismock.NewClientMock()
	rrdb, _ := redismock.NewClientMock()
	t.Cleanup(func() { _ = wrdb.Close(); _ = rrdb.Close() })
	wAny := allowAnyRedisCommand(wmock)
	relay := NewRedisRelayWithClients(hub, wrdb, rrdb)
	relay.nodeID = "cleanup-node-1"
	stream := StreamKey(ScopeWorkspace, "ws-cleanup")
	group := "node:cleanup-node-1"

	wAny.ExpectXGroupCreateMkStream(stream, group, "$").SetVal("OK")
	wAny.ExpectZAdd(NodesKey(ScopeWorkspace, "ws-cleanup"), redis.Z{}).SetVal(1)
	// The loop observes the already-cancelled context at the top and runs
	// the best-effort consumer cleanup before returning.
	wAny.ExpectXGroupDelConsumer(stream, group, "cleanup-node-1").SetVal(1)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	c := &scopeConsumer{done: make(chan struct{})}
	relay.runConsumer(ctx, c, ScopeWorkspace, "ws-cleanup")
	select {
	case <-c.done:
	case <-time.After(time.Second):
		t.Fatal("expected consumer done channel closed")
	}
	if err := wmock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRedisRelayRunConsumerAckErrorAndBusyGroup(t *testing.T) {
	hub := NewHub()
	client := attachRealtimeTestClient(hub, ScopeWorkspace, "ws-busy")
	wrdb, wmock := redismock.NewClientMock()
	rrdb, rmock := redismock.NewClientMock()
	t.Cleanup(func() { _ = wrdb.Close(); _ = rrdb.Close() })
	wAny := allowAnyRedisCommand(wmock)
	rAny := allowAnyRedisCommand(rmock)
	relay := NewRedisRelayWithClients(hub, wrdb, rrdb)
	relay.nodeID = "busy-node-1"
	stream := StreamKey(ScopeWorkspace, "ws-busy")
	group := "node:busy-node-1"

	// BUSYGROUP from a pre-existing group is ignored.
	wAny.ExpectXGroupCreateMkStream(stream, group, "$").SetErr(errors.New("BUSYGROUP Consumer Group name already exists"))
	wAny.ExpectZAdd(NodesKey(ScopeWorkspace, "ws-busy"), redis.Z{}).SetVal(1)
	rAny.ExpectXReadGroup(&redis.XReadGroupArgs{
		Group: group, Consumer: "busy-node-1",
		Streams: []string{stream, ">"}, Count: 32, Block: 5 * time.Second,
	}).SetVal([]redis.XStream{{
		Stream: stream,
		Messages: []redis.XMessage{{
			ID: "2-0",
			Values: envelopeRedisValues(envelope{
				EventID: "e-busy-1", Scope: ScopeWorkspace, ScopeID: "ws-busy",
				PayloadJSON: `{"type":"ping"}`,
			}),
		}},
	}})
	// Failed ack is logged and skipped.
	wAny.ExpectXAck(stream, group, "2-0").SetErr(errors.New("ack down"))
	// No cleanup expectation: the cancel below lands in the error backoff
	// after the loop exhausts the queued read (see the test above).

	ctx, cancel := context.WithCancel(context.Background())
	c := &scopeConsumer{done: make(chan struct{})}
	done := make(chan struct{})
	go func() { relay.runConsumer(ctx, c, ScopeWorkspace, "ws-busy"); close(done) }()
	select {
	case <-client.send:
	case <-time.After(2 * time.Second):
		t.Fatal("expected delivery despite BUSYGROUP")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("runConsumer did not exit after cancel")
	}
	if err := wmock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
