package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/redis/go-redis/v9"
)

// Stream / registry key naming. Centralised so tests can introspect.
func StreamKey(scopeType, scopeID string) string {
	return fmt.Sprintf("ws:scope:%s:%s:stream", scopeType, scopeID)
}
func NodesKey(scopeType, scopeID string) string {
	return fmt.Sprintf("ws:scope:%s:%s:nodes", scopeType, scopeID)
}
func HeartbeatKey(nodeID string) string {
	return fmt.Sprintf("ws:node:%s:heartbeat", nodeID)
}

const (
	streamMaxLen        int64 = 10000
	heartbeatTTL              = 90 * time.Second
	heartbeatPeriod           = 30 * time.Second
	consumerIdleGrace         = 10 * time.Minute
	consumerSweepPeriod       = 5 * time.Minute
	// streamIdleTTL is how long a scope's stream and node registry outlive
	// their last write or heartbeat. Every XADD and every heartbeat of a
	// node with local subscribers pushes it back, so only keys nobody
	// publishes to or listens on expire — and their groups go with them.
	streamIdleTTL = time.Hour
)

// envelope is what we serialise into each XADD message. It is opaque to the
// hub: the relay decodes payload_json before fanning out.
type envelope struct {
	EventID     string `json:"event_id"`
	EventType   string `json:"event_type"`
	Scope       string `json:"scope"`
	ScopeID     string `json:"scope_id"`
	WorkspaceID string `json:"workspace_id"`
	ActorID     string `json:"actor_id"`
	CreatedAt   string `json:"created_at"`
	NodeID      string `json:"node_id"`
	PayloadJSON string `json:"payload_json"` // raw JSON of the original ws frame
	// LocalDelivered marks an envelope the publishing node already fanned
	// out to its own clients (DualWriteBroadcaster); that node's consumer
	// drops it when it reads it back.
	LocalDelivered bool `json:"local_delivered"`
}

func newEnvelope(nodeID, scopeType, scopeID, exclude string, frame []byte, id string) envelope {
	ev := envelope{
		EventID:     id,
		Scope:       scopeType,
		ScopeID:     scopeID,
		NodeID:      nodeID,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		PayloadJSON: string(frame),
	}
	if exclude != "" {
		ev.WorkspaceID = exclude
	}
	if t, a := peekTypeActor(frame); t != "" {
		ev.EventType = t
		ev.ActorID = a
	}
	return ev
}

func envelopeRedisValues(ev envelope) map[string]any {
	return map[string]any{
		"event_id":        ev.EventID,
		"event_type":      ev.EventType,
		"scope":           ev.Scope,
		"scope_id":        ev.ScopeID,
		"workspace_id":    ev.WorkspaceID,
		"actor_id":        ev.ActorID,
		"created_at":      ev.CreatedAt,
		"node_id":         ev.NodeID,
		"payload_json":    ev.PayloadJSON,
		"local_delivered": localDeliveredValue(ev.LocalDelivered),
	}
}

func localDeliveredValue(b bool) string {
	if b {
		return "1"
	}
	return ""
}

func envelopeFromXMessage(msg redis.XMessage) (envelope, bool) {
	ev := envelope{
		EventID:     redisString(msg.Values["event_id"]),
		EventType:   redisString(msg.Values["event_type"]),
		Scope:       redisString(msg.Values["scope"]),
		ScopeID:     redisString(msg.Values["scope_id"]),
		WorkspaceID: redisString(msg.Values["workspace_id"]),
		ActorID:     redisString(msg.Values["actor_id"]),
		CreatedAt:   redisString(msg.Values["created_at"]),
		NodeID:      redisString(msg.Values["node_id"]),
		PayloadJSON: redisString(msg.Values["payload_json"]),
		// Envelopes from a node that predates the field read as not
		// delivered, which is what they were: those nodes fan out locally
		// only through the loopback.
		LocalDelivered: redisString(msg.Values["local_delivered"]) == "1",
	}
	return ev, ev.PayloadJSON != ""
}

func redisString(v any) string {
	switch s := v.(type) {
	case string:
		return s
	case []byte:
		return string(s)
	default:
		return ""
	}
}

func deliverEnvelope(hub *Hub, ev envelope) {
	if ev.PayloadJSON == "" {
		return
	}
	frame := injectEventID([]byte(ev.PayloadJSON), ev.EventID)
	switch ev.Scope {
	case "global":
		hub.fanoutAllDedup(frame, "", ev.EventID)
	case ScopeUser:
		hub.fanoutUser(ev.ScopeID, frame, ev.WorkspaceID, ev.EventID)
	default:
		hub.BroadcastToScopeDedup(ev.Scope, ev.ScopeID, frame, ev.EventID)
	}
}

// RedisRelay is a Broadcaster implementation that writes every message to a
// per-scope Redis Stream and consumes streams for which there are local
// subscribers. Local fanout is delegated to the wrapped *Hub.
type RedisRelay struct {
	hub      *Hub
	writeRDB *redis.Client
	readRDB  *redis.Client
	nodeID   string

	mu        sync.Mutex
	consumers map[scopeKey]*scopeConsumer
	stopping  bool
	wg        sync.WaitGroup
}

type scopeConsumer struct {
	cancel context.CancelFunc
	done   chan struct{}
}

// NewRedisRelay constructs a relay. The caller is responsible for invoking
// Start before producing messages.
func NewRedisRelay(hub *Hub, rdb *redis.Client) *RedisRelay {
	return NewRedisRelayWithClients(hub, rdb, rdb)
}

// NewRedisRelayWithClients constructs a relay with separate Redis clients for
// writes and blocking reads. The read client is reserved for XREADGROUP BLOCK
// calls so long-polling stream consumers cannot exhaust the pool used by XADD,
// heartbeats, acks, and other request-path Redis operations.
func NewRedisRelayWithClients(hub *Hub, writeRDB, readRDB *redis.Client) *RedisRelay {
	if readRDB == nil {
		readRDB = writeRDB
	}
	return &RedisRelay{
		hub:       hub,
		writeRDB:  writeRDB,
		readRDB:   readRDB,
		nodeID:    ulid.Make().String(),
		consumers: make(map[scopeKey]*scopeConsumer),
	}
}

// NodeID returns this relay's randomly-assigned node identifier.
func (r *RedisRelay) NodeID() string { return r.nodeID }

// Wait blocks until all relay-owned goroutines have exited after the Start
// context is canceled.
func (r *RedisRelay) Wait() {
	r.wg.Wait()
}

// Stop prevents new scope consumers from being started and cancels any active
// consumers. The Start context still controls heartbeat and sweeper shutdown;
// callers should cancel it before calling Wait.
func (r *RedisRelay) Stop() {
	r.hub.SetSubscriptionCallbacks(nil, nil)

	r.mu.Lock()
	r.stopping = true
	for _, c := range r.consumers {
		c.cancel()
	}
	r.mu.Unlock()
}

// Start wires the hub→relay subscription callbacks, kicks off the heartbeat
// goroutine, and spins up consumers for any scopes the hub already knows
// about. ctx controls all background goroutines: cancelling it shuts the
// relay down.
func (r *RedisRelay) Start(ctx context.Context) {
	M.NodeID.Store(r.nodeID)
	if err := r.writeRDB.Ping(ctx).Err(); err != nil {
		slog.Error("realtime/redis: initial ping failed", "error", err)
		M.RedisConnected.Store(false)
		M.SetRedisLastError(err.Error())
	} else if r.readRDB != r.writeRDB {
		if err := r.readRDB.Ping(ctx).Err(); err != nil {
			slog.Error("realtime/redis: initial read-client ping failed", "error", err)
			M.RedisConnected.Store(false)
			M.SetRedisLastError(err.Error())
		} else {
			M.RedisConnected.Store(true)
		}
	} else {
		M.RedisConnected.Store(true)
	}

	r.hub.SetSubscriptionCallbacks(
		func(scopeType, scopeID string) { r.startConsumer(ctx, scopeType, scopeID) },
		func(scopeType, scopeID string) { r.stopConsumer(scopeType, scopeID) },
	)

	for _, key := range r.hub.LocalScopes() {
		r.startConsumer(ctx, key.Type, key.ID)
	}

	r.wg.Add(2)
	go func() {
		defer r.wg.Done()
		r.heartbeatLoop(ctx)
	}()
	go func() {
		defer r.wg.Done()
		r.consumerSweeper(ctx)
	}()
}

// BroadcastToScope publishes message into the scope's Redis stream. The
// envelope contains an event_id for client-side dedup. Local fanout happens
// when this node consumes its own write back through XREADGROUP — except in
// the dual-write configuration where the local hub is invoked directly.
func (r *RedisRelay) BroadcastToScope(scopeType, scopeID string, message []byte) {
	r.publish(scopeType, scopeID, "", message)
}

// BroadcastToWorkspace / SendToUser / Broadcast satisfy the back-compat
// portion of Broadcaster.
func (r *RedisRelay) BroadcastToWorkspace(workspaceID string, message []byte) {
	r.publish(ScopeWorkspace, workspaceID, "", message)
}
func (r *RedisRelay) SendToUser(userID string, message []byte, excludeWorkspace ...string) {
	exclude := ""
	if len(excludeWorkspace) > 0 {
		exclude = excludeWorkspace[0]
	}
	r.publish(ScopeUser, userID, exclude, message)
}
func (r *RedisRelay) Broadcast(message []byte) {
	// Global broadcast — write to a special "global" stream so other nodes
	// can fan out to all clients regardless of subscriptions.
	r.publish("global", "all", "", message)
}

func (r *RedisRelay) publish(scopeType, scopeID, exclude string, frame []byte) {
	_ = r.xadd(newEnvelope(r.nodeID, scopeType, scopeID, exclude, frame, ulid.Make().String()))
}

// xadd appends ev to its scope's stream and pushes the stream's expiry
// back in the same round trip.
func (r *RedisRelay) xadd(ev envelope) error {
	stream := StreamKey(ev.Scope, ev.ScopeID)
	args := &redis.XAddArgs{
		Stream: stream,
		MaxLen: streamMaxLen,
		Approx: true,
		Values: envelopeRedisValues(ev),
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := r.writeRDB.Pipelined(ctx, func(p redis.Pipeliner) error {
		p.XAdd(ctx, args)
		p.Expire(ctx, stream, streamIdleTTL)
		return nil
	})
	if err != nil {
		M.RedisXAddErrors.Add(1)
		M.SetRedisLastError(err.Error())
		slog.Warn("realtime/redis: XADD failed", "error", err, "scope", ev.Scope, "scope_id", ev.ScopeID)
		return err
	}
	M.RedisXAddTotal.Add(1)
	M.RedisLastXAddLagMicros.Store(time.Since(start).Microseconds())
	return nil
}

// startConsumer kicks off a single per-scope XREADGROUP loop if not already
// running.
func (r *RedisRelay) startConsumer(parent context.Context, scopeType, scopeID string) {
	key := sk(scopeType, scopeID)
	r.mu.Lock()
	if r.stopping || parent.Err() != nil {
		r.mu.Unlock()
		return
	}
	if _, exists := r.consumers[key]; exists {
		r.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(parent)
	c := &scopeConsumer{cancel: cancel, done: make(chan struct{})}
	r.consumers[key] = c
	r.wg.Add(1)
	r.mu.Unlock()

	go func() {
		defer r.wg.Done()
		r.runConsumer(ctx, c, scopeType, scopeID)
	}()
}

func (r *RedisRelay) stopConsumer(scopeType, scopeID string) {
	key := sk(scopeType, scopeID)
	r.mu.Lock()
	c, ok := r.consumers[key]
	if ok {
		delete(r.consumers, key)
	}
	r.mu.Unlock()
	if !ok {
		return
	}
	c.cancel()
}

func (r *RedisRelay) runConsumer(ctx context.Context, c *scopeConsumer, scopeType, scopeID string) {
	defer close(c.done)

	stream := StreamKey(scopeType, scopeID)
	group := "node:" + r.nodeID
	consumerName := r.nodeID

	if err := r.ensureGroup(ctx, stream, group); err != nil && ctx.Err() == nil {
		slog.Warn("realtime/redis: XGROUP CREATE failed", "error", err, "scope", scopeType, "scope_id", scopeID)
	}
	r.register(ctx, []scopeKey{sk(scopeType, scopeID)})

read:
	for ctx.Err() == nil {
		readCtx, readCancel := context.WithTimeout(ctx, 6*time.Second)
		res, err := r.readRDB.XReadGroup(readCtx, &redis.XReadGroupArgs{
			Group:    group,
			Consumer: consumerName,
			Streams:  []string{stream, ">"},
			Count:    32,
			Block:    5 * time.Second,
		}).Result()
		readCancel()
		if errors.Is(err, redis.Nil) || (err != nil && (errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled))) {
			continue
		}
		if err != nil {
			M.RedisXReadErrors.Add(1)
			M.SetRedisLastError(err.Error())
			// The stream expired or was deleted under us, taking the group
			// with it: recreate both at the tail rather than failing on
			// NOGROUP until the scope empties, and give the recreated
			// stream its expiry at once.
			if streamGone(err) && r.ensureGroup(ctx, stream, group) == nil {
				r.register(ctx, []scopeKey{sk(scopeType, scopeID)})
				continue
			}
			// Brief backoff to avoid busy-looping on a flapping connection.
			select {
			case <-ctx.Done():
				break read
			case <-time.After(time.Second):
			}
			continue
		}
		for _, s := range res {
			for _, msg := range s.Messages {
				M.RedisXReadTotal.Add(1)
				r.deliverMessage(scopeType, scopeID, msg)
				ackCtx, ackCancel := context.WithTimeout(ctx, time.Second)
				if err := r.writeRDB.XAck(ackCtx, stream, group, msg.ID).Err(); err != nil {
					slog.Debug("realtime/redis: XACK failed", "error", err, "id", msg.ID)
				} else {
					M.RedisAckTotal.Add(1)
				}
				ackCancel()
			}
		}
	}

	// The group is this node's alone, so dropping it leaves other nodes'
	// reads untouched and leaves nothing behind for a later 0→1 to replay.
	// A consumer started for the scope while this one was still blocked in
	// its read (a member leaving and rejoining) owns the group now and is
	// left alone; if it registered just after this check, its next read
	// sees NOGROUP and recreates the group.
	r.mu.Lock()
	successor, ok := r.consumers[sk(scopeType, scopeID)]
	r.mu.Unlock()
	if ok && successor != c {
		return
	}
	cleanCtx, cleanCancel := context.WithTimeout(context.Background(), 2*time.Second)
	if err := r.writeRDB.XGroupDestroy(cleanCtx, stream, group).Err(); err != nil {
		slog.Debug("realtime/redis: XGROUP DESTROY failed", "error", err, "scope", scopeType, "scope_id", scopeID)
	}
	cleanCancel()
}

// ensureGroup creates this node's group on stream at the tail, or moves an
// existing one there. The group is created when a scope goes 0→1 local
// subscribers; a group left over from an earlier subscription (a cleanup
// that never reached Redis) still points at the last id it delivered, and
// reading '>' from there would hand the new subscriber every event it
// missed while nobody on this node listened.
func (r *RedisRelay) ensureGroup(ctx context.Context, stream, group string) error {
	gctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	err := r.writeRDB.XGroupCreateMkStream(gctx, stream, group, "$").Err()
	if err != nil && strings.Contains(err.Error(), "BUSYGROUP") {
		err = r.writeRDB.XGroupSetID(gctx, stream, group, "$").Err()
	}
	return err
}

// streamGone reports a read that failed because the stream or this node's
// group no longer exists.
func streamGone(err error) bool {
	msg := err.Error()
	return strings.HasPrefix(msg, "NOGROUP") || strings.HasPrefix(msg, "UNBLOCKED")
}

// register records this node under each scope's registry and pushes back
// the expiry of the scope's registry and stream, in one round trip.
func (r *RedisRelay) register(ctx context.Context, scopes []scopeKey) {
	if len(scopes) == 0 {
		return
	}
	rctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	expiry := float64(time.Now().Add(heartbeatTTL).Unix())
	if _, err := r.writeRDB.Pipelined(rctx, func(p redis.Pipeliner) error {
		for _, key := range scopes {
			nodes := NodesKey(key.Type, key.ID)
			p.ZAdd(rctx, nodes, redis.Z{Score: expiry, Member: r.nodeID})
			p.Expire(rctx, nodes, streamIdleTTL)
			p.Expire(rctx, StreamKey(key.Type, key.ID), streamIdleTTL)
		}
		return nil
	}); err != nil && ctx.Err() == nil {
		slog.Debug("realtime/redis: scope registration failed", "error", err, "scopes", len(scopes))
	}
}

func (r *RedisRelay) deliverMessage(scopeType, scopeID string, msg redis.XMessage) {
	ev, ok := envelopeFromXMessage(msg)
	if !ok {
		return
	}
	if ev.Scope == "" {
		ev.Scope = scopeType
	}
	if ev.ScopeID == "" {
		ev.ScopeID = scopeID
	}
	if ev.LocalDelivered && ev.NodeID == r.nodeID {
		return // fanned out here when it was published
	}
	deliverEnvelope(r.hub, ev)
}

// fanoutUser is implemented in hub.go.

func (r *RedisRelay) heartbeatLoop(ctx context.Context) {
	t := time.NewTicker(heartbeatPeriod)
	defer t.Stop()
	for {
		r.heartbeatOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (r *RedisRelay) heartbeatOnce(ctx context.Context) {
	hbCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := r.writeRDB.Set(hbCtx, HeartbeatKey(r.nodeID), time.Now().UTC().Format(time.RFC3339Nano), heartbeatTTL).Err(); err != nil {
		M.RedisConnected.Store(false)
		M.SetRedisLastError(err.Error())
		return
	}
	M.RedisConnected.Store(true)
	r.register(ctx, r.hub.LocalScopes())
}

// consumerSweeper periodically drops stale ZSET entries (nodes whose TTL
// expired) and those nodes' groups. Best-effort: we only sweep the scopes
// this node currently has local subscribers for, since they're the only ones
// we can reason about without scanning all keys — and they are the streams
// that never sit idle long enough to expire with their dead groups.
func (r *RedisRelay) consumerSweeper(ctx context.Context) {
	t := time.NewTicker(consumerSweepPeriod)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		r.sweepOnce(ctx, time.Now())
	}
}

// sweepStaleNodes removes every node whose registry entry expired from a
// scope's registry (KEYS[1]) and destroys its group on the scope's stream
// (KEYS[2]). A node that died without its consumers' cleanup (SIGKILL, or
// a shutdown that did not wait out their blocked reads) leaves a group
// behind on every stream it read. It runs as one script so a node
// re-registering cannot be judged stale from an entry it has just
// refreshed.
var sweepStaleNodes = redis.NewScript(`
local stale = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
for _, node in ipairs(stale) do
  redis.pcall('XGROUP', 'DESTROY', KEYS[2], 'node:' .. node)
  redis.call('ZREM', KEYS[1], node)
end
return #stale
`)

func (r *RedisRelay) sweepOnce(ctx context.Context, now time.Time) {
	cutoff := strconv.FormatInt(now.Unix(), 10)
	for _, key := range r.hub.LocalScopes() {
		swCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		keys := []string{NodesKey(key.Type, key.ID), StreamKey(key.Type, key.ID)}
		if err := sweepStaleNodes.Run(swCtx, r.writeRDB, keys, cutoff).Err(); err != nil && ctx.Err() == nil {
			slog.Debug("realtime/redis: stale node sweep failed", "error", err, "scope", key.Type, "scope_id", key.ID)
		}
		cancel()
	}
}

// peekTypeActor parses the WS frame just enough to lift event_type / actor_id
// for the envelope. Failures yield empty strings — the envelope still works.
func peekTypeActor(frame []byte) (string, string) {
	var probe struct {
		Type    string `json:"type"`
		ActorID string `json:"actor_id"`
	}
	_ = json.Unmarshal(frame, &probe)
	return probe.Type, probe.ActorID
}

// injectEventID inserts the event_id field into an existing JSON object frame
// without re-encoding the payload. The frame must be a JSON object.
func injectEventID(frame []byte, eventID string) []byte {
	if eventID == "" || len(frame) == 0 || frame[0] != '{' {
		return frame
	}
	// Decode-encode round-trip is simplest and avoids edge cases with
	// trailing whitespace / nested escapes. A few extra allocations per
	// message are fine relative to the network cost.
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(frame, &obj); err != nil {
		return frame
	}
	if _, exists := obj["event_id"]; exists {
		return frame
	}
	idJSON, _ := json.Marshal(eventID)
	obj["event_id"] = idJSON
	out, err := json.Marshal(obj)
	if err != nil {
		return frame
	}
	return out
}

// DualWriteBroadcaster delivers each message both to the local hub (immediate
// fanout) AND to the Redis relay (cross-node fanout). It dedups via
// Client.markSeen so the same client doesn't see the same event twice when
// the Redis relay loops the message back.
type DualWriteBroadcaster struct {
	local *Hub
	relay RelayPublisher
}

// RelayPublisher is implemented by Redis relay backends that can publish a
// caller-supplied event id for local/Redis loopback deduplication.
type RelayPublisher interface {
	PublishWithID(scopeType, scopeID, exclude string, frame []byte, id string) error
}

func NewDualWriteBroadcaster(local *Hub, relay RelayPublisher) *DualWriteBroadcaster {
	return newDualWriteBroadcaster(local, relay)
}

func newDualWriteBroadcaster(local *Hub, relay RelayPublisher) *DualWriteBroadcaster {
	return &DualWriteBroadcaster{local: local, relay: relay}
}

func (d *DualWriteBroadcaster) BroadcastToScope(scopeType, scopeID string, message []byte) {
	id := ulid.Make().String()
	frame := injectEventID(message, id)
	// Local fast path: BroadcastToScopeDedup marks each client as having
	// seen `id`, so the Redis loopback for the same id will be ignored.
	d.local.BroadcastToScopeDedup(scopeType, scopeID, frame, id)
	d.publish(scopeType, scopeID, "", message, id)
}

func (d *DualWriteBroadcaster) BroadcastToWorkspace(workspaceID string, message []byte) {
	d.BroadcastToScope(ScopeWorkspace, workspaceID, message)
}

func (d *DualWriteBroadcaster) SendToUser(userID string, message []byte, excludeWorkspace ...string) {
	exclude := ""
	if len(excludeWorkspace) > 0 {
		exclude = excludeWorkspace[0]
	}
	id := ulid.Make().String()
	frame := injectEventID(message, id)
	d.local.fanoutUser(userID, frame, exclude, id)
	d.publish(ScopeUser, userID, exclude, message, id)
}

func (d *DualWriteBroadcaster) Broadcast(message []byte) {
	id := ulid.Make().String()
	frame := injectEventID(message, id)
	d.local.fanoutAllDedup(frame, "", id)
	d.publish("global", "all", "", message, id)
}

// publish hands the event to the relay after the local fanout. A
// *RedisRelay is told the event is already delivered here, so its own
// consumer does not decode and re-fan it when it reads it back.
func (d *DualWriteBroadcaster) publish(scopeType, scopeID, exclude string, message []byte, id string) {
	if r, ok := d.relay.(*RedisRelay); ok {
		ev := newEnvelope(r.nodeID, scopeType, scopeID, exclude, message, id)
		ev.LocalDelivered = true
		_ = r.xadd(ev)
		return
	}
	_ = d.relay.PublishWithID(scopeType, scopeID, exclude, message, id)
}

// SendToUsers delivers one frame to many users: their sockets here at once,
// and through the relay only the users connected to another node.
func (d *DualWriteBroadcaster) SendToUsers(userIDs []string, message []byte) {
	id := ulid.Make().String()
	frame := injectEventID(message, id)
	for _, userID := range userIDs {
		d.local.fanoutUser(userID, frame, "", id)
	}
	if r, ok := d.relay.(*RedisRelay); ok {
		r.xaddRemoteUsers(userIDs, message, id)
		return
	}
	for _, userID := range userIDs {
		_ = d.relay.PublishWithID(ScopeUser, userID, "", message, id)
	}
}

// xaddRemoteUsers appends frame, already delivered on this node, to the
// stream of each user another node holds a socket for. Two round trips
// whatever the count: one reads the users' node registries, one writes.
func (r *RedisRelay) xaddRemoteUsers(userIDs []string, frame []byte, id string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	live := &redis.ZRangeBy{Min: strconv.FormatInt(time.Now().Unix(), 10), Max: "+inf"}
	nodes := make([]*redis.StringSliceCmd, len(userIDs))
	if _, err := r.writeRDB.Pipelined(ctx, func(p redis.Pipeliner) error {
		for i, userID := range userIDs {
			nodes[i] = p.ZRangeByScore(ctx, NodesKey(ScopeUser, userID), live)
		}
		return nil
	}); err != nil {
		M.SetRedisLastError(err.Error())
		slog.Warn("realtime/redis: user node lookup failed", "error", err, "users", len(userIDs))
		return
	}
	var remote []string
	for i, userID := range userIDs {
		if slices.ContainsFunc(nodes[i].Val(), func(n string) bool { return n != r.nodeID }) {
			remote = append(remote, userID)
		}
	}
	if len(remote) == 0 {
		return
	}
	start := time.Now()
	if _, err := r.writeRDB.Pipelined(ctx, func(p redis.Pipeliner) error {
		for _, userID := range remote {
			ev := newEnvelope(r.nodeID, ScopeUser, userID, "", frame, id)
			ev.LocalDelivered = true
			stream := StreamKey(ScopeUser, userID)
			p.XAdd(ctx, &redis.XAddArgs{Stream: stream, MaxLen: streamMaxLen, Approx: true, Values: envelopeRedisValues(ev)})
			p.Expire(ctx, stream, streamIdleTTL)
		}
		return nil
	}); err != nil {
		M.RedisXAddErrors.Add(1)
		M.SetRedisLastError(err.Error())
		slog.Warn("realtime/redis: batched XADD failed", "error", err, "users", len(remote))
		return
	}
	M.RedisXAddTotal.Add(int64(len(remote)))
	M.RedisLastXAddLagMicros.Store(time.Since(start).Microseconds())
}

// PublishWithID is like publish but uses a caller-supplied event id so the
// dual-write path can dedup.
func (r *RedisRelay) PublishWithID(scopeType, scopeID, exclude string, frame []byte, id string) error {
	return r.xadd(newEnvelope(r.nodeID, scopeType, scopeID, exclude, frame, id))
}

var _ Broadcaster = (*RedisRelay)(nil)
var _ Broadcaster = (*DualWriteBroadcaster)(nil)
var _ RelayPublisher = (*RedisRelay)(nil)
