package migrations

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// captureTx records the last statement the generated code sends.
type captureTx struct {
	pgx.Tx
	sql string
}

func (c *captureTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	c.sql = sql
	return c.Tx.Query(ctx, sql, args...)
}

// Review R1 S2: the correlation id is client-settable, so a script that
// reuses one traceparent piles every task.created row under it. The rows of
// one transaction must be found by xact_id through the partial index, not by
// filtering everything under the correlation id. The generic plan is what a
// prepared statement settles on, so it is the one checked.
func TestTaskCreatedInTransactionReadsByXactIndex(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	capture := &captureTx{Tx: tx}
	if _, err := db.New(capture).ListTaskCreatedEventsInTransaction(ctx, db.ListTaskCreatedEventsInTransactionParams{
		CorrelationID: "corr", ResourceID: "task",
	}); err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		"SET LOCAL plan_cache_mode = force_generic_plan",
		"SET LOCAL enable_seqscan = off",
		"PREPARE task_created_xact AS " + capture.sql,
	} {
		if _, err := tx.Exec(ctx, stmt); err != nil {
			t.Fatal(stmt, err)
		}
	}
	rows, err := tx.Query(ctx, "EXPLAIN EXECUTE task_created_xact('corr', 'task')")
	if err != nil {
		t.Fatal(err)
	}
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(line + "\n")
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.String(), "idx_audit_events_task_created_xact") {
		t.Fatalf("the transaction's rows are not read through the xact index:\n%s", plan.String())
	}
}
