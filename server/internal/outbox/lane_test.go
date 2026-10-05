package outbox

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func enqueueIn(t *testing.T, q *db.Queries, topic, workspaceID string) string {
	t.Helper()
	id := util.NewID()
	if err := q.InsertDomainOutboxEvent(context.Background(), db.InsertDomainOutboxEventParams{
		ID: id, Topic: topic, Payload: "{}", EventVersion: 1,
		WorkspaceID: pgtype.Text{String: workspaceID, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

// gateConsumer stands in for a slow downstream (an LLM, an audit export): it
// reports that it started and then holds the row until released.
type gateConsumer struct {
	recordingConsumer
	once    sync.Once
	started chan struct{}
	release chan struct{}
	honour  bool // return when ctx is done; false ignores ctx entirely
}

func newGate(name, topic string, honourCtx bool) *gateConsumer {
	return &gateConsumer{
		recordingConsumer: recordingConsumer{name: name, topic: topic},
		started:           make(chan struct{}), release: make(chan struct{}), honour: honourCtx,
	}
}

func (c *gateConsumer) DeliveryTimeout() time.Duration { return time.Minute }
func (c *gateConsumer) Handle(ctx context.Context, ev Row) error {
	_ = c.recordingConsumer.Handle(ctx, ev)
	c.once.Do(func() { close(c.started) })
	if !c.honour {
		<-c.release
		return nil
	}
	select {
	case <-c.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func waitFor(t *testing.T, what string, within time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(within)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out after %s waiting for %s", within, what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func rowStatus(t *testing.T, ctx context.Context, d *Dispatcher, id string) (string, int32) {
	t.Helper()
	var status string
	var attempts int32
	if err := d.pool.QueryRow(ctx, `SELECT status, attempts FROM outbox_events WHERE id = $1`, id).Scan(&status, &attempts); err != nil {
		t.Fatal(err)
	}
	return status, attempts
}

// The G3 failure: one row of slow work (an LLM summary, an audit export)
// froze every realtime frame behind it. With lanes, the realtime row is
// delivered while the slow one is still held.
func TestSlowLaneDoesNotDelayARealtimeRow(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	slow := newGate("summary", "chat.voice.call.completed", true)
	fast := &recordingConsumer{name: "realtime", topic: "join_request.approved"}
	d := New(pool, q, Options{Tick: 10 * time.Millisecond})
	d.RegisterLane(LaneSlow, slow)
	d.Register(fast)

	held := enqueue(t, q, "chat.voice.call.completed")
	runCtx, cancel := context.WithCancel(ctx)
	stopped := make(chan struct{})
	go func() { d.Run(runCtx); close(stopped) }()
	t.Cleanup(func() { close(slow.release); cancel(); <-stopped })

	select {
	case <-slow.started:
	case <-time.After(10 * time.Second):
		t.Fatal("slow consumer never started")
	}
	approved := enqueue(t, q, "join_request.approved")
	waitFor(t, "the realtime row", 3*time.Second, func() bool { return fast.calls() == 1 })
	waitFor(t, "the realtime row to be marked done", 3*time.Second, func() bool {
		s, _ := rowStatus(t, ctx, d, approved)
		return s == "DONE"
	})
	if s, _ := rowStatus(t, ctx, d, held); s != "PROCESSING" {
		t.Fatalf("slow row status = %q, want it still held", s)
	}
}

// Two nodes, every lane busy, a topic read on two lanes and a topic nobody
// reads: each row reaches each of its consumers exactly once and ends DONE.
func TestLanesDeliverEachRowOnceAcrossNodes(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	consumers := []struct {
		lane Lane
		c    *recordingConsumer
	}{
		{LaneRealtime, &recordingConsumer{name: "realtime", topic: "meeting.started"}},
		{LaneRealtime, &recordingConsumer{name: "realtime-task", topic: "task.updated"}},
		{LaneNotify, &recordingConsumer{name: "notification", topic: "task.updated"}},
		{LaneProvider, &recordingConsumer{name: "provider", topic: "provider.ensure_session"}},
		{LanePush, &recordingConsumer{name: "push", topic: "notification.push"}},
		{LaneSlow, &recordingConsumer{name: "export", topic: "audit.export_requested"}},
	}
	nodes := []*Dispatcher{
		New(pool, q, Options{Tick: 10 * time.Millisecond, Batch: 7}),
		New(pool, q, Options{Tick: 10 * time.Millisecond, Batch: 7}),
	}
	for _, d := range nodes {
		for _, c := range consumers {
			d.RegisterLane(c.lane, c.c)
		}
	}
	want := map[string][]string{}
	topics := []string{"meeting.started", "task.updated", "provider.ensure_session",
		"notification.push", "audit.export_requested", "nobody.listens"}
	for i := range 30 {
		for _, topic := range topics {
			want[topic] = append(want[topic], enqueueIn(t, q, topic, fmt.Sprintf("ws%d", i%5)))
		}
	}

	runCtx, cancel := context.WithCancel(ctx)
	var wg sync.WaitGroup
	for _, d := range nodes {
		wg.Add(1)
		go func() { defer wg.Done(); d.Run(runCtx) }()
	}
	t.Cleanup(func() { cancel(); wg.Wait() })

	waitFor(t, "every row to be DONE", 30*time.Second, func() bool {
		var open int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE status <> 'DONE'`).Scan(&open); err != nil {
			t.Fatal(err)
		}
		return open == 0
	})
	cancel()
	wg.Wait()
	for _, c := range consumers {
		c.c.mu.Lock()
		got := slices.Clone(c.c.seen)
		c.c.mu.Unlock()
		slices.Sort(got)
		exp := slices.Clone(want[c.c.topic])
		slices.Sort(exp)
		if !slices.Equal(got, exp) {
			t.Errorf("%s saw %d deliveries for %d rows (duplicates or gaps)", c.c.name, len(got), len(exp))
		}
	}
}

// Run is what main awaits at shutdown, so it must not return while any lane
// is still claiming or recording, and a hung consumer must not keep it from
// returning. The row delivered just before the hang is already DONE when Run
// returns (the lane finished its batch bookkeeping first); the row the hung
// consumer held keeps its claim and attempt count rather than being charged a
// failure for the shutdown.
func TestRunReturnsOnlyAfterEveryLaneStopped(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	deaf := newGate("export", "audit.export_requested", false)
	defer close(deaf.release)
	d := New(pool, q, Options{Tick: 10 * time.Millisecond})
	d.RegisterLane(LaneSlow, deaf)
	d.RegisterLane(LaneSlow, &recordingConsumer{name: "webhook", topic: "webhook.deliver"})
	d.RegisterLane(LaneProvider, &recordingConsumer{name: "provider", topic: "provider.end_session"})
	d.Register(&recordingConsumer{name: "realtime", topic: "meeting.ended"})

	// One slow-lane claim takes both rows; the first is delivered, the second
	// hangs behind it in the same workspace.
	delivered := enqueue(t, q, "webhook.deliver")
	held := enqueue(t, q, "audit.export_requested")
	runCtx, cancel := context.WithCancel(ctx)
	stopped := make(chan struct{})
	go func() { d.Run(runCtx); close(stopped) }()
	select {
	case <-deaf.started:
	case <-time.After(10 * time.Second):
		t.Fatal("slow consumer never started")
	}
	cancel()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after cancel while a consumer was hung")
	}
	if s, _ := rowStatus(t, ctx, d, delivered); s != "DONE" {
		t.Fatalf("row delivered before shutdown: status %q when Run returned, want DONE", s)
	}

	late := []string{
		enqueue(t, q, "meeting.ended"),
		enqueue(t, q, "provider.end_session"),
		enqueue(t, q, "audit.export_requested"),
	}
	time.Sleep(200 * time.Millisecond) // 20 ticks: any lane still running would claim
	for _, id := range late {
		if s, _ := rowStatus(t, ctx, d, id); s != "PENDING" {
			t.Fatalf("row %s claimed after Run returned: status %q", id, s)
		}
	}
	if s, attempts := rowStatus(t, ctx, d, held); s != "PROCESSING" || attempts != 0 {
		t.Fatalf("held row after shutdown: status %q attempts %d, want PROCESSING 0", s, attempts)
	}
}

// The consumers of one row run side by side: in the notify lane the realtime
// frame for task.updated must not wait for the notification fan-out.
func TestDeliverRunsARowsConsumersConcurrently(t *testing.T) {
	other := make(chan struct{})
	waiter := &funcConsumer{name: "waits", topic: "task.updated", fn: func(ctx context.Context) error {
		select {
		case <-other:
			return nil
		case <-time.After(2 * time.Second):
			return errors.New("sibling never ran: consumers are serialised")
		}
	}}
	closer := &funcConsumer{name: "closes", topic: "task.updated", fn: func(context.Context) error {
		close(other)
		return nil
	}}
	d := New(nil, nil, Options{})
	d.RegisterLane(LaneNotify, waiter)
	d.Register(closer)
	if err := d.deliver(context.Background(), Row{ID: "r1", Topic: "task.updated"}); err != nil {
		t.Fatal(err)
	}
}

type funcConsumer struct {
	name, topic string
	fn          func(context.Context) error
}

func (c *funcConsumer) Name() string                            { return c.name }
func (c *funcConsumer) Topics() []string                        { return []string{c.topic} }
func (c *funcConsumer) Handle(ctx context.Context, _ Row) error { return c.fn(ctx) }

// A topic runs on the slowest lane any of its consumers asked for, whatever
// the registration order; the realtime lane claims everything else.
func TestTopicRunsOnItsSlowestConsumersLane(t *testing.T) {
	for _, notifyFirst := range []bool{true, false} {
		d := New(nil, nil, Options{Batch: 50})
		notify := func() { d.RegisterLane(LaneNotify, &recordingConsumer{name: "n", topic: "task.updated"}) }
		realtime := func() { d.Register(&recordingConsumer{name: "r", topic: "task.updated"}) }
		if notifyFirst {
			notify()
			realtime()
		} else {
			realtime()
			notify()
		}
		d.RegisterLane(LaneSlow, &recordingConsumer{name: "s", topic: "audit.export_requested"})
		d.Register(&recordingConsumer{name: "m", topic: "meeting.started"})

		got := map[Lane]laneClaim{}
		for _, c := range d.claims() {
			got[c.name] = c
		}
		if len(got) != 3 {
			t.Fatalf("lanes = %v, want realtime, notify, slow", got)
		}
		rt := got[LaneRealtime]
		if !rt.all || !rt.reap || !slices.Equal(rt.except, []string{"audit.export_requested", "task.updated"}) {
			t.Fatalf("realtime lane = %+v", rt)
		}
		if n := got[LaneNotify]; !slices.Equal(n.topics, []string{"task.updated"}) || n.reap {
			t.Fatalf("notify lane = %+v", n)
		}
		if s := got[LaneSlow]; !slices.Equal(s.topics, []string{"audit.export_requested"}) || s.batch != 2 {
			t.Fatalf("slow lane = %+v", s)
		}
	}
}

func TestRegisterLaneRejectsAnUnknownLane(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("RegisterLane accepted an unknown lane")
		}
	}()
	New(nil, nil, Options{}).RegisterLane("fast-ish", &recordingConsumer{name: "x", topic: "x"})
}

// Rows of one workspace stay in commit order on one worker, whatever order
// the claim returned them in.
func TestGroupRowsKeepsCommitOrderPerWorkspace(t *testing.T) {
	base := time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)
	row := func(id, ws string, sec int) Row {
		return Row{
			ID: id, WorkspaceID: pgtype.Text{String: ws, Valid: ws != ""},
			CreatedAt: pgtype.Timestamptz{Time: base.Add(time.Duration(sec) * time.Second), Valid: true},
		}
	}
	rows := []Row{row("d", "b", 4), row("a", "a", 1), row("c", "a", 3), row("e", "", 5), row("b", "b", 2)}
	var got [][]string
	for _, g := range groupRows(rows) {
		var ids []string
		for _, r := range g {
			ids = append(ids, r.ID)
		}
		got = append(got, ids)
	}
	want := [][]string{{"a", "c"}, {"b", "d"}, {"e"}}
	if !slices.EqualFunc(got, want, slices.Equal[[]string]) {
		t.Fatalf("groups = %v, want %v", got, want)
	}
}
