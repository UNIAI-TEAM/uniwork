package outbox

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type nullConsumer struct{}

func (nullConsumer) Name() string                      { return "bench" }
func (nullConsumer) Topics() []string                  { return []string{"task.updated"} }
func (nullConsumer) Handle(context.Context, Row) error { return nil }

// The throughput number the audit spec asks for before shipping: how many rows
// one worker drains per second on a developer machine. It is a guard against a
// change that turns the claim query into a sequential scan, not a benchmark to
// optimize — run it with -run=Throughput and read the line it prints.
func TestOutboxThroughput(t *testing.T) {
	if testing.Short() {
		t.Skip("throughput measurement")
	}
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	const rows = 2000
	batch := make([][]any, 0, rows)
	for range rows {
		batch = append(batch, []any{util.NewID(), "task.updated", `{"task_id":"t1","workspace_id":"ws1"}`})
	}
	for _, r := range batch {
		if err := q.InsertDomainOutboxEvent(ctx, db.InsertDomainOutboxEventParams{
			ID: r[0].(string), Topic: r[1].(string), Payload: r[2].(string), EventVersion: 1,
			WorkspaceID: pgtype.Text{String: "ws1", Valid: true},
		}); err != nil {
			t.Fatal(err)
		}
	}

	d := New(pool, q, Options{Batch: 200})
	d.Register(nullConsumer{})

	start := time.Now()
	for {
		if err := d.Process(ctx, 200); err != nil {
			t.Fatal(err)
		}
		var pending int
		if err := pool.QueryRow(ctx,
			`SELECT count(*) FROM outbox_events WHERE done_at IS NULL AND dead_at IS NULL`).Scan(&pending); err != nil {
			t.Fatal(err)
		}
		if pending == 0 {
			break
		}
		if time.Since(start) > 60*time.Second {
			t.Fatalf("%d rows still pending after 60s", pending)
		}
	}
	elapsed := time.Since(start)
	fmt.Printf("outbox throughput: %d rows in %s (%.0f rows/s, one worker)\n",
		rows, elapsed.Round(time.Millisecond), float64(rows)/elapsed.Seconds())
}
