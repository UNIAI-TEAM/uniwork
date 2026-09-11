package outbox

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

type fakePub struct{ n int }

func (f *fakePub) PublishWorkspace(context.Context, string, string, map[string]string) { f.n++ }
func (f *fakePub) PublishScope(context.Context, string, string, string, map[string]string) {
	f.n++
}
func (f *fakePub) PublishUser(context.Context, string, string, map[string]string) { f.n++ }

type fakeLatency struct {
	topic string
	d     time.Duration
}

func (f *fakeLatency) ObserveRealtimePublish(topic string, d time.Duration) { f.topic, f.d = topic, d }

// Publish latency is commit (row created_at) to frame, as seen by the consumer.
func TestRealtimeConsumerObservesCommitToFrameLatency(t *testing.T) {
	pub := &fakePub{}
	c := NewRealtimeConsumer(pub)
	lat := &fakeLatency{}
	c.SetMetrics(lat)
	created := time.Now().Add(-750 * time.Millisecond)
	c.now = func() time.Time { return created.Add(750 * time.Millisecond) }
	err := c.Handle(context.Background(), Row{
		Topic: "task.updated", Payload: `{"task_id":"t1","workspace_id":"w1"}`,
		CreatedAt: pgtype.Timestamptz{Time: created, Valid: true},
	})
	if err != nil || pub.n != 1 {
		t.Fatalf("handle: %v published=%d", err, pub.n)
	}
	if lat.topic != "task.updated" || lat.d != 750*time.Millisecond {
		t.Fatalf("latency = %s %s", lat.topic, lat.d)
	}
}
