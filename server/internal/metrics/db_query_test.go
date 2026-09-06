package metrics

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestQueryName(t *testing.T) {
	cases := map[string]string{
		"-- name: GetUserByID :one\nSELECT 1":  "GetUserByID",
		"\n  -- name: ListTasks :many\nSELECT": "ListTasks",
		"SELECT 1":                             "raw",
		"-- name:\nSELECT":                     "raw",
	}
	for sql, want := range cases {
		if got := QueryName(sql); got != want {
			t.Errorf("QueryName(%q) = %q, want %q", sql, got, want)
		}
	}
}

type recordingTracer struct{ starts, ends int }

func (r *recordingTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	r.starts++
	return ctx
}
func (r *recordingTracer) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) { r.ends++ }

func TestDBQueryTracerObservesAndForwards(t *testing.T) {
	next := &recordingTracer{}
	tr := NewDBQueryTracer(next)
	ctx := tr.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{SQL: "-- name: GetUserByID :one\nSELECT 1"})
	tr.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{})
	if next.starts != 1 || next.ends != 1 {
		t.Fatalf("forwarded starts=%d ends=%d", next.starts, next.ends)
	}
	if n := testutil.CollectAndCount(tr.Duration, "uniwork_db_query_duration_seconds"); n != 1 {
		t.Fatalf("series = %d", n)
	}
	// A nil wrapped tracer is fine: histogram only.
	tr = NewDBQueryTracer(nil)
	ctx = tr.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{SQL: "SELECT 1"})
	tr.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{})
	_ = tr.TraceBatchStart(ctx, nil, pgx.TraceBatchStartData{})
}
