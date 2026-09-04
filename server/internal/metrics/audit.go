package metrics

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// Outbox counts what the dispatcher does and how much audit it records. One
// type covers both because they answer the same question in an incident: did
// the command land, and did anyone hear about it.
type Outbox struct {
	Done      prometheus.Counter
	Retry     prometheus.Counter
	Dead      prometheus.Counter
	AuditRows *prometheus.CounterVec
}

func NewOutbox() *Outbox {
	return &Outbox{
		Done: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_outbox_delivered_total",
			Help: "Outbox rows delivered to every consumer of their topic.",
		}),
		Retry: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_outbox_retry_total",
			Help: "Outbox rows put back for another attempt after a consumer failed.",
		}),
		Dead: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_outbox_dead_total",
			Help: "Outbox rows parked as dead letters after exhausting their attempts.",
		}),
		AuditRows: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_audit_events_total",
			Help: "Audit rows written, by action.",
		}, []string{"action"}),
	}
}

func (o *Outbox) Collectors() []prometheus.Collector {
	return []prometheus.Collector{o.Done, o.Retry, o.Dead, o.AuditRows}
}

// IncOutboxDone, IncOutboxRetry and IncOutboxDeadLetter satisfy
// outbox.Metrics; IncAuditEvent satisfies audit.Counter. Both interfaces are
// declared where they are used so those packages never import Prometheus.
func (o *Outbox) IncOutboxDone() { o.Done.Inc() }

func (o *Outbox) IncOutboxRetry() { o.Retry.Inc() }

func (o *Outbox) IncOutboxDeadLetter() { o.Dead.Inc() }

func (o *Outbox) IncAuditEvent(action string) { o.AuditRows.WithLabelValues(action).Inc() }

// outboxLagDesc is a gauge read straight from the table rather than tracked in
// memory: the number that matters is how old the oldest undelivered row is
// across every process, and only the database knows that.
var outboxLagDesc = prometheus.NewDesc(
	"uniwork_outbox_pending_age_seconds",
	"Age of the oldest outbox row that has not been delivered yet.",
	nil, nil,
)

var outboxDeadGaugeDesc = prometheus.NewDesc(
	"uniwork_outbox_dead_rows",
	"Outbox rows currently parked as dead letters.",
	nil, nil,
)

// OutboxLagCollector reports the queue's health at scrape time.
type OutboxLagCollector struct{ pool *pgxpool.Pool }

func NewOutboxLagCollector(pool *pgxpool.Pool) *OutboxLagCollector {
	return &OutboxLagCollector{pool: pool}
}

func (c *OutboxLagCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- outboxLagDesc
	ch <- outboxDeadGaugeDesc
}

func (c *OutboxLagCollector) Collect(ch chan<- prometheus.Metric) {
	if c.pool == nil {
		return
	}
	ctx := context.Background()
	var ageSeconds float64
	if err := c.pool.QueryRow(ctx, `
		SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))), 0)::float8
		FROM outbox_events
		WHERE done_at IS NULL AND dead_at IS NULL AND status <> 'DEAD_LETTER'`).Scan(&ageSeconds); err == nil {
		ch <- prometheus.MustNewConstMetric(outboxLagDesc, prometheus.GaugeValue, ageSeconds)
	}
	var dead float64
	if err := c.pool.QueryRow(ctx,
		`SELECT count(*)::float8 FROM outbox_events WHERE dead_at IS NOT NULL OR status = 'DEAD_LETTER'`,
	).Scan(&dead); err == nil {
		ch <- prometheus.MustNewConstMetric(outboxDeadGaugeDesc, prometheus.GaugeValue, dead)
	}
}
