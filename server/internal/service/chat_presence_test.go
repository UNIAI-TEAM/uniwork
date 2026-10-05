package service

import (
	"context"
	"errors"
	"os"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// presenceRedisTestDB is apart from the packages that flush theirs (auth 15,
// middleware 14, realtime 13, router 12). These tests never flush: every
// tracker writes under a prefix of its own and deletes only that.
const presenceRedisTestDB = 11

type presenceFrame struct {
	workspaceID string
	ev          Event
}

// presenceRecorder is an EventPublisher that keeps the workspace each frame
// went to; presence only ever publishes to a workspace.
type presenceRecorder struct {
	mu     sync.Mutex
	frames []presenceFrame
}

func (r *presenceRecorder) Publish(_ context.Context, workspaceID string, ev Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.frames = append(r.frames, presenceFrame{workspaceID: workspaceID, ev: ev})
}

func (r *presenceRecorder) PublishToScope(context.Context, string, string, Event) {
	panic("presence publishes to the workspace only")
}

func (r *presenceRecorder) SendToUser(context.Context, string, Event) {
	panic("presence publishes to the workspace only")
}

func (r *presenceRecorder) take() []presenceFrame {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := r.frames
	r.frames = nil
	return out
}

// presenceClock is a hand-driven clock shared by the tracker under test.
type presenceClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *presenceClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *presenceClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func presenceRedis(t *testing.T) *redis.Client {
	t.Helper()
	url := os.Getenv("REDIS_TEST_URL")
	if url == "" {
		t.Skip("REDIS_TEST_URL not set")
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("parse REDIS_TEST_URL: %v", err)
	}
	opts.DB = presenceRedisTestDB
	rdb := redis.NewClient(opts)
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}

// eachPresenceStore runs fn once over the in-process store and once over
// Redis (skipped without REDIS_TEST_URL): both must behave the same.
func eachPresenceStore(t *testing.T, fn func(t *testing.T, tr *presenceTracker, pub *presenceRecorder, clock *presenceClock)) {
	t.Helper()
	build := map[string]func(t *testing.T) presenceStore{
		"memory": func(*testing.T) presenceStore { return newMemoryPresenceStore() },
		"redis": func(t *testing.T) presenceStore {
			rdb := presenceRedis(t)
			prefix := "test:presence:" + util.NewID() + ":"
			t.Cleanup(func() {
				ctx := context.Background()
				keys, err := rdb.Keys(ctx, prefix+"*").Result()
				if err == nil && len(keys) > 0 {
					_ = rdb.Del(ctx, keys...).Err()
				}
			})
			return newRedisPresenceStore(rdb, prefix)
		},
	}
	for _, name := range []string{"memory", "redis"} {
		t.Run(name, func(t *testing.T) {
			pub := &presenceRecorder{}
			clock := &presenceClock{now: time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)}
			tr := newPresenceTracker(build[name](t), pub)
			tr.now = clock.Now
			fn(t, tr, pub, clock)
		})
	}
}

func wantFrames(t *testing.T, got []presenceFrame, want ...presenceFrame) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("frames = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i].workspaceID != want[i].workspaceID || got[i].ev.Type != want[i].ev.Type ||
			got[i].ev.Payload["user_id"] != want[i].ev.Payload["user_id"] {
			t.Fatalf("frame %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func onlineFrame(ws, user string) presenceFrame {
	return presenceFrame{workspaceID: ws, ev: Event{Type: "user.presence", Payload: map[string]string{"user_id": user}}}
}

func offlineFrame(ws, user string) presenceFrame {
	return presenceFrame{workspaceID: ws, ev: Event{Type: "user.offline", Payload: map[string]string{"user_id": user}}}
}

// Every shell page beats every 15s; before, each beat became a frame to the
// whole workspace. Only the first beat of a session is news.
func TestPresenceRepeatedBeatsPublishOnce(t *testing.T) {
	eachPresenceStore(t, func(t *testing.T, tr *presenceTracker, pub *presenceRecorder, clock *presenceClock) {
		ctx := context.Background()
		for i := 0; i < 10; i++ {
			if _, err := tr.beat(ctx, "WS1", "U1"); err != nil {
				t.Fatalf("beat %d: %v", i, err)
			}
			clock.advance(15 * time.Second)
		}
		wantFrames(t, pub.take(), onlineFrame("WS1", "U1"))
	})
}

// Chrome wakes the timers of a tab hidden for five minutes once a minute
// (intensive throttling), so a backgrounded shell beats every ~60s, not
// 15s. That tab must stay online: flapping it offline and back each minute
// would cost two workspace frames a minute per background tab.
func TestPresenceBackgroundTabBeatingOnceAMinuteStaysOnline(t *testing.T) {
	eachPresenceStore(t, func(t *testing.T, tr *presenceTracker, pub *presenceRecorder, clock *presenceClock) {
		ctx := context.Background()
		for i := 0; i < 5; i++ {
			if _, err := tr.beat(ctx, "WS1", "U1"); err != nil {
				t.Fatalf("beat %d: %v", i, err)
			}
			// A minute-aligned wake-up plus a slow request.
			clock.advance(65 * time.Second)
			tr.sweep(ctx)
		}
		wantFrames(t, pub.take(), onlineFrame("WS1", "U1"))
	})
}

// Coming online in one workspace is not news in another, and a second
// person's first beat is news of its own.
func TestPresenceTransitionsArePerWorkspaceAndUser(t *testing.T) {
	eachPresenceStore(t, func(t *testing.T, tr *presenceTracker, pub *presenceRecorder, _ *presenceClock) {
		ctx := context.Background()
		for _, b := range [][2]string{{"WS1", "U1"}, {"WS2", "U1"}, {"WS1", "U2"}, {"WS1", "U1"}} {
			if _, err := tr.beat(ctx, b[0], b[1]); err != nil {
				t.Fatal(err)
			}
		}
		wantFrames(t, pub.take(), onlineFrame("WS1", "U1"), onlineFrame("WS2", "U1"), onlineFrame("WS1", "U2"))
	})
}

// The beat answers with who is online, so a page that opens after its peers
// came online learns about them without waiting for a frame.
func TestPresenceBeatReturnsTheOnlineSnapshot(t *testing.T) {
	eachPresenceStore(t, func(t *testing.T, tr *presenceTracker, _ *presenceRecorder, clock *presenceClock) {
		ctx := context.Background()
		mustBeat := func(ws, user string) []string {
			t.Helper()
			online, err := tr.beat(ctx, ws, user)
			if err != nil {
				t.Fatal(err)
			}
			slices.Sort(online)
			return online
		}
		mustBeat("WS1", "U1")
		mustBeat("WS2", "U9")
		clock.advance(30 * time.Second)
		if got := mustBeat("WS1", "U2"); !slices.Equal(got, []string{"U1", "U2"}) {
			t.Fatalf("snapshot = %v, want [U1 U2]", got)
		}
		// U1 has not beaten for presenceTTL: no longer in anybody's snapshot,
		// even before a sweep has published the expiry.
		clock.advance(presenceTTL - 30*time.Second)
		if got := mustBeat("WS1", "U2"); !slices.Equal(got, []string{"U2"}) {
			t.Fatalf("snapshot after U1 expired = %v, want [U2]", got)
		}
	})
}

// A tab that closes says so; a tab that crashes, loses the network or sleeps
// stops beating, and the sweep publishes the offline frame once its entry
// expires. Whichever happens, it happens once.
func TestPresenceExpiryAndLeavePublishOffline(t *testing.T) {
	eachPresenceStore(t, func(t *testing.T, tr *presenceTracker, pub *presenceRecorder, clock *presenceClock) {
		ctx := context.Background()
		for _, u := range []string{"U1", "U2", "U3"} {
			if _, err := tr.beat(ctx, "WS1", u); err != nil {
				t.Fatal(err)
			}
		}
		pub.take()

		if err := tr.leave(ctx, "WS1", "U3"); err != nil {
			t.Fatal(err)
		}
		if err := tr.leave(ctx, "WS1", "U3"); err != nil {
			t.Fatal(err)
		}
		wantFrames(t, pub.take(), offlineFrame("WS1", "U3"))

		// U2 keeps beating, U1 stops. Nothing expires before the TTL.
		clock.advance(presenceTTL - time.Second)
		if _, err := tr.beat(ctx, "WS1", "U2"); err != nil {
			t.Fatal(err)
		}
		wantFrames(t, pub.take())

		clock.advance(2 * time.Second)
		tr.sweep(ctx)
		tr.sweep(ctx)
		wantFrames(t, pub.take(), offlineFrame("WS1", "U1"))

		// Back after the expiry: online again, once.
		if _, err := tr.beat(ctx, "WS1", "U1"); err != nil {
			t.Fatal(err)
		}
		wantFrames(t, pub.take(), onlineFrame("WS1", "U1"))
	})
}

// The sweep runs on the beats themselves, at most once per interval per
// process, so no worker is needed and a busy workspace does not sweep on
// every request.
func TestPresenceBeatSweepsAtMostOncePerInterval(t *testing.T) {
	eachPresenceStore(t, func(t *testing.T, tr *presenceTracker, pub *presenceRecorder, clock *presenceClock) {
		ctx := context.Background()
		mustBeat := func(user string) {
			t.Helper()
			if _, err := tr.beat(ctx, "WS1", user); err != nil {
				t.Fatal(err)
			}
		}
		mustBeat("U1")
		clock.advance(3 * time.Second)
		mustBeat("U3")
		pub.take()

		// U1 lapsed; the beat that notices sweeps it.
		clock.advance(presenceTTL - 2*time.Second)
		mustBeat("U2")
		wantFrames(t, pub.take(), onlineFrame("WS1", "U2"), offlineFrame("WS1", "U1"))

		// U3 lapses a moment later, inside the interval: no sweep yet.
		clock.advance(3 * time.Second)
		mustBeat("U2")
		wantFrames(t, pub.take())

		clock.advance(presenceSweepInterval)
		mustBeat("U2")
		wantFrames(t, pub.take(), offlineFrame("WS1", "U3"))
	})
}

// Two replicas share Redis: a beat seen by both is one transition, and an
// expiry swept by both is one offline frame.
func TestPresenceRedisTransitionsAreSharedAcrossReplicas(t *testing.T) {
	rdb := presenceRedis(t)
	prefix := "test:presence:" + util.NewID() + ":"
	t.Cleanup(func() {
		keys, err := rdb.Keys(context.Background(), prefix+"*").Result()
		if err == nil && len(keys) > 0 {
			_ = rdb.Del(context.Background(), keys...).Err()
		}
	})
	clock := &presenceClock{now: time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)}
	pubA, pubB := &presenceRecorder{}, &presenceRecorder{}
	a := newPresenceTracker(newRedisPresenceStore(rdb, prefix), pubA)
	b := newPresenceTracker(newRedisPresenceStore(rdb, prefix), pubB)
	a.now, b.now = clock.Now, clock.Now
	ctx := context.Background()

	if _, err := a.beat(ctx, "WS1", "U1"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.beat(ctx, "WS1", "U1"); err != nil {
		t.Fatal(err)
	}
	wantFrames(t, append(pubA.take(), pubB.take()...), onlineFrame("WS1", "U1"))

	clock.advance(presenceTTL + time.Second)
	a.sweep(ctx)
	b.sweep(ctx)
	wantFrames(t, append(pubA.take(), pubB.take()...), offlineFrame("WS1", "U1"))
}

// A Redis that does not answer costs the beat its snapshot and its frame,
// never the request: presence is best-effort.
func TestPresenceStoreErrorDegradesQuietly(t *testing.T) {
	pub := &presenceRecorder{}
	tr := newPresenceTracker(failingPresenceStore{}, pub)
	online, err := tr.beat(context.Background(), "WS1", "U1")
	if err != nil || online != nil {
		t.Fatalf("beat = %v, %v; want nil, nil", online, err)
	}
	if err := tr.leave(context.Background(), "WS1", "U1"); err != nil {
		t.Fatalf("leave: %v", err)
	}
	tr.sweep(context.Background())
	wantFrames(t, pub.take())
}

type failingPresenceStore struct{}

var errPresenceDown = errors.New("presence store down")

func (failingPresenceStore) beat(context.Context, string, string, time.Time) (bool, error) {
	return false, errPresenceDown
}

func (failingPresenceStore) leave(context.Context, string, string, time.Time) (bool, error) {
	return false, errPresenceDown
}

func (failingPresenceStore) online(context.Context, string, time.Time) ([]string, error) {
	return nil, errPresenceDown
}

func (failingPresenceStore) expire(context.Context, time.Time) ([]presenceEntry, error) {
	return nil, errPresenceDown
}

// Through the service: only a workspace member may beat, the beat answers
// with the members online, and the leave publishes once.
func TestSignalPresenceRequiresMembershipAndReturnsSnapshot(t *testing.T) {
	s, _, q, ua, ub, w, _ := chatFixtureWithPool(t)
	ctx := context.Background()
	pub := &presenceRecorder{}
	s.pub = pub

	if _, err := s.SignalPresence(ctx, ub.ID, w.ID, "online"); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member beat: err = %v, want forbidden/not found", err)
	}
	if _, err := s.SignalPresence(ctx, ua.ID, w.ID, "away"); err == nil {
		t.Fatal("unknown state accepted")
	}
	wantFrames(t, pub.take())

	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	if _, err := s.SignalPresence(ctx, ua.ID, w.ID, ""); err != nil {
		t.Fatal(err)
	}
	online, err := s.SignalPresence(ctx, ub.ID, w.ID, "online")
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(online)
	want := []string{ua.ID, ub.ID}
	slices.Sort(want)
	if !slices.Equal(online, want) {
		t.Fatalf("snapshot = %v, want %v", online, want)
	}
	if _, err := s.SignalPresence(ctx, ub.ID, w.ID, "online"); err != nil {
		t.Fatal(err)
	}
	gone, err := s.SignalPresence(ctx, ub.ID, w.ID, "offline")
	if err != nil || gone != nil {
		t.Fatalf("leave = %v, %v; want nil snapshot", gone, err)
	}
	wantFrames(t, pub.take(), onlineFrame(w.ID, ua.ID), onlineFrame(w.ID, ub.ID), offlineFrame(w.ID, ub.ID))
}
