package metrics

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/prometheus/client_golang/prometheus"
)

// DBQueryTracer observes every pgx query into
// uniwork_db_query_duration_seconds{query_name} and forwards the same
// callbacks to the OpenTelemetry tracer it wraps, so one ConnConfig.Tracer
// yields both spans and a histogram (F-11 §6.3). query_name is the sqlc name
// from the leading `-- name:` comment, or "raw" for ad-hoc SQL.
type DBQueryTracer struct {
	next     pgx.QueryTracer
	Duration *prometheus.HistogramVec
}

func NewDBQueryTracer(next pgx.QueryTracer) *DBQueryTracer {
	return &DBQueryTracer{next: next, Duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "uniwork_db_query_duration_seconds",
		Help:    "Database query duration by sqlc query name.",
		Buckets: []float64{0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5},
	}, []string{"query_name"})}
}

func (t *DBQueryTracer) Collectors() []prometheus.Collector {
	return []prometheus.Collector{t.Duration}
}

type dbQueryStart struct {
	name string
	at   time.Time
}

type dbQueryKey struct{}

func (t *DBQueryTracer) TraceQueryStart(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	ctx = context.WithValue(ctx, dbQueryKey{}, dbQueryStart{name: QueryName(data.SQL), at: time.Now()})
	if t.next != nil {
		ctx = t.next.TraceQueryStart(ctx, conn, data)
	}
	return ctx
}

func (t *DBQueryTracer) TraceQueryEnd(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryEndData) {
	if s, ok := ctx.Value(dbQueryKey{}).(dbQueryStart); ok {
		t.Duration.WithLabelValues(s.name).Observe(time.Since(s.at).Seconds())
	}
	if t.next != nil {
		t.next.TraceQueryEnd(ctx, conn, data)
	}
}

// The remaining pgx tracer hooks pass straight through when the wrapped
// tracer implements them (otelpgx does), so no span is lost.

func (t *DBQueryTracer) TraceBatchStart(ctx context.Context, conn *pgx.Conn, data pgx.TraceBatchStartData) context.Context {
	if n, ok := t.next.(pgx.BatchTracer); ok {
		return n.TraceBatchStart(ctx, conn, data)
	}
	return ctx
}

func (t *DBQueryTracer) TraceBatchQuery(ctx context.Context, conn *pgx.Conn, data pgx.TraceBatchQueryData) {
	if n, ok := t.next.(pgx.BatchTracer); ok {
		n.TraceBatchQuery(ctx, conn, data)
	}
}

func (t *DBQueryTracer) TraceBatchEnd(ctx context.Context, conn *pgx.Conn, data pgx.TraceBatchEndData) {
	if n, ok := t.next.(pgx.BatchTracer); ok {
		n.TraceBatchEnd(ctx, conn, data)
	}
}

func (t *DBQueryTracer) TraceCopyFromStart(ctx context.Context, conn *pgx.Conn, data pgx.TraceCopyFromStartData) context.Context {
	if n, ok := t.next.(pgx.CopyFromTracer); ok {
		return n.TraceCopyFromStart(ctx, conn, data)
	}
	return ctx
}

func (t *DBQueryTracer) TraceCopyFromEnd(ctx context.Context, conn *pgx.Conn, data pgx.TraceCopyFromEndData) {
	if n, ok := t.next.(pgx.CopyFromTracer); ok {
		n.TraceCopyFromEnd(ctx, conn, data)
	}
}

func (t *DBQueryTracer) TraceConnectStart(ctx context.Context, data pgx.TraceConnectStartData) context.Context {
	if n, ok := t.next.(pgx.ConnectTracer); ok {
		return n.TraceConnectStart(ctx, data)
	}
	return ctx
}

func (t *DBQueryTracer) TraceConnectEnd(ctx context.Context, data pgx.TraceConnectEndData) {
	if n, ok := t.next.(pgx.ConnectTracer); ok {
		n.TraceConnectEnd(ctx, data)
	}
}

func (t *DBQueryTracer) TracePrepareStart(ctx context.Context, conn *pgx.Conn, data pgx.TracePrepareStartData) context.Context {
	if n, ok := t.next.(pgx.PrepareTracer); ok {
		return n.TracePrepareStart(ctx, conn, data)
	}
	return ctx
}

func (t *DBQueryTracer) TracePrepareEnd(ctx context.Context, conn *pgx.Conn, data pgx.TracePrepareEndData) {
	if n, ok := t.next.(pgx.PrepareTracer); ok {
		n.TracePrepareEnd(ctx, conn, data)
	}
}

// QueryName reads the sqlc `-- name: X :kind` header; anything else is raw.
func QueryName(sql string) string {
	line, _, _ := strings.Cut(strings.TrimLeft(sql, " \t\r\n"), "\n")
	rest, ok := strings.CutPrefix(line, "-- name:")
	if !ok {
		return "raw"
	}
	name, _, _ := strings.Cut(strings.TrimSpace(rest), " ")
	if name == "" {
		return "raw"
	}
	return name
}
