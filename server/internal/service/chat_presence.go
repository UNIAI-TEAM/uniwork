package service

import (
	"context"
	"log/slog"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// Presence is state, not a stream of heartbeats. Every shell page beats every
// 15s; the tracker records the beat with a TTL and publishes to the workspace
// only when the caller's state changes: offline → online on the first beat,
// online → offline on an explicit leave or when the entry expires. The beat
// answers with who is online, so a page that opens late learns its peers from
// that answer rather than from a frame per peer per beat.
const (
	// presenceTTL outlives a beat from a backgrounded tab: Chrome wakes the
	// timers of a tab hidden for five minutes once a minute, so its 15s beat
	// arrives every ~60s, and a late request on top must not flap it offline.
	// A closed tab says so (pagehide); only a crash or a lost network waits
	// out the TTL.
	presenceTTL = 90 * time.Second
	// presenceSweepInterval bounds how often one process looks for expired
	// entries; an expiry is published within TTL + interval + one beat.
	presenceSweepInterval = 5 * time.Second
	// presenceSweepBatch caps one sweep; the next one takes the rest.
	presenceSweepBatch = 500
	// presenceSnapshotLimit caps the online list one beat returns (the
	// product's largest team is 1,000 people).
	presenceSnapshotLimit = 1000
)

// presenceEntry is one person online in one workspace.
type presenceEntry struct {
	workspaceID string
	userID      string
}

// presenceStore keeps who is online where until when. Each operation is
// atomic, so two processes seeing the same beat or the same expiry agree on
// which one of them saw the transition.
type presenceStore interface {
	// beat marks the user online until now + presenceTTL; true when they
	// were not (no entry, or one that lapsed before a sweep removed it).
	beat(ctx context.Context, workspaceID, userID string, now time.Time) (bool, error)
	// leave drops the user; true when an entry was there — expired or not,
	// since an entry nobody swept yet was never announced as offline.
	leave(ctx context.Context, workspaceID, userID string, now time.Time) (bool, error)
	// online lists the users whose entry outlives now.
	online(ctx context.Context, workspaceID string, now time.Time) ([]string, error)
	// expire removes and returns the entries that lapsed by now.
	expire(ctx context.Context, now time.Time) ([]presenceEntry, error)
}

type presenceTracker struct {
	store     presenceStore
	pub       EventPublisher
	now       func() time.Time
	lastSweep atomic.Int64 // unix nanos of the last sweep this process ran
}

func newPresenceTracker(store presenceStore, pub EventPublisher) *presenceTracker {
	return &presenceTracker{store: store, pub: pub, now: time.Now}
}

// SetPresenceStore keeps presence in Redis, shared by every replica. Without
// Redis (nil) it stays in this process, which is right only for a single
// replica — the same condition under which events fan out in-process only.
func (s *ChatService) SetPresenceStore(rdb *redis.Client) {
	var store presenceStore = newMemoryPresenceStore()
	if rdb != nil {
		store = newRedisPresenceStore(rdb, redisPresencePrefix)
	}
	s.presenceTracker.Store(newPresenceTracker(store, s.pub))
}

// presence returns the tracker SetPresenceStore installed, or an in-process
// one for a service that was never given a store (tests, single replica).
func (s *ChatService) presence() *presenceTracker {
	if t := s.presenceTracker.Load(); t != nil {
		return t
	}
	s.presenceTracker.CompareAndSwap(nil, newPresenceTracker(newMemoryPresenceStore(), s.pub))
	return s.presenceTracker.Load()
}

// beat records a heartbeat and returns who is online in the workspace, the
// caller included. A store error costs the beat its frame and its snapshot
// (nil), never the request: presence is best-effort.
func (t *presenceTracker) beat(ctx context.Context, workspaceID, userID string) ([]string, error) {
	now := t.now()
	cameOnline, err := t.store.beat(ctx, workspaceID, userID, now)
	if err != nil {
		slog.WarnContext(ctx, "presence: beat not recorded", "error", err, "workspace_id", workspaceID, "user_id", userID)
		return nil, nil
	}
	online, err := t.store.online(ctx, workspaceID, now)
	if err != nil {
		slog.WarnContext(ctx, "presence: snapshot unavailable", "error", err, "workspace_id", workspaceID)
		online = nil
	}
	if cameOnline {
		t.publish(ctx, "user.presence", presenceEntry{workspaceID: workspaceID, userID: userID})
	}
	t.maybeSweep(ctx, now)
	return online, nil
}

// leave records an explicit leave (the page closed or left the workspace).
func (t *presenceTracker) leave(ctx context.Context, workspaceID, userID string) error {
	now := t.now()
	wasOnline, err := t.store.leave(ctx, workspaceID, userID, now)
	if err != nil {
		slog.WarnContext(ctx, "presence: leave not recorded", "error", err, "workspace_id", workspaceID, "user_id", userID)
		return nil
	}
	if wasOnline {
		t.publish(ctx, "user.offline", presenceEntry{workspaceID: workspaceID, userID: userID})
	}
	t.maybeSweep(ctx, now)
	return nil
}

// maybeSweep runs a sweep when this process has not run one for an interval.
// Beats arrive from every open page, so they drive the sweep and no worker
// is needed; with nobody beating there is nobody to tell anyway.
func (t *presenceTracker) maybeSweep(ctx context.Context, now time.Time) {
	last := t.lastSweep.Load()
	if now.UnixNano()-last < int64(presenceSweepInterval) {
		return
	}
	if !t.lastSweep.CompareAndSwap(last, now.UnixNano()) {
		return
	}
	t.sweep(ctx)
}

// sweep publishes user.offline for every entry that expired. The store
// removes each entry atomically, so one process announces each expiry.
func (t *presenceTracker) sweep(ctx context.Context) {
	expired, err := t.store.expire(ctx, t.now())
	if err != nil {
		slog.WarnContext(ctx, "presence: sweep failed", "error", err)
		return
	}
	for _, e := range expired {
		t.publish(ctx, "user.offline", e)
	}
}

func (t *presenceTracker) publish(ctx context.Context, topic string, e presenceEntry) {
	t.pub.Publish(ctx, e.workspaceID, Event{
		Type:    topic,
		Payload: map[string]string{"user_id": e.userID},
	})
}

// memoryPresenceStore is the single-process store.
type memoryPresenceStore struct {
	mu      sync.Mutex
	entries map[presenceEntry]time.Time // → expires
}

func newMemoryPresenceStore() *memoryPresenceStore {
	return &memoryPresenceStore{entries: map[presenceEntry]time.Time{}}
}

func (m *memoryPresenceStore) beat(_ context.Context, workspaceID, userID string, now time.Time) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := presenceEntry{workspaceID: workspaceID, userID: userID}
	prev, ok := m.entries[key]
	m.entries[key] = now.Add(presenceTTL)
	return !ok || !prev.After(now), nil
}

func (m *memoryPresenceStore) leave(_ context.Context, workspaceID, userID string, _ time.Time) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := presenceEntry{workspaceID: workspaceID, userID: userID}
	_, ok := m.entries[key]
	delete(m.entries, key)
	return ok, nil
}

func (m *memoryPresenceStore) online(_ context.Context, workspaceID string, now time.Time) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []string{}
	for key, expires := range m.entries {
		if key.workspaceID == workspaceID && expires.After(now) {
			out = append(out, key.userID)
		}
	}
	sort.Strings(out)
	if len(out) > presenceSnapshotLimit {
		out = out[:presenceSnapshotLimit]
	}
	return out, nil
}

func (m *memoryPresenceStore) expire(_ context.Context, now time.Time) ([]presenceEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []presenceEntry
	for key, expires := range m.entries {
		if len(out) == presenceSweepBatch {
			break
		}
		if !expires.After(now) {
			out = append(out, key)
			delete(m.entries, key)
		}
	}
	return out, nil
}
