package metrics

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// Outbox counts what the dispatcher does and how much audit it records. One
// type covers both because they answer the same question in an incident: did
// the command land, and did anyone hear about it.
type Outbox struct {
	Done         prometheus.Counter
	Retry        prometheus.Counter
	Dead         prometheus.Counter
	AuditRows    *prometheus.CounterVec
	AuditExpired *prometheus.GaugeVec
	// PublishLatency is commit → realtime frame, measured by the realtime
	// consumer as now minus the outbox row's created_at (F-11 §6.3).
	PublishLatency *prometheus.HistogramVec
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
		AuditExpired: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "uniwork_audit_events_expired",
			Help: "Audit rows past an organization's retention window. Nothing deletes them yet; the number is what makes the policy visible.",
		}, []string{"organization"}),
		PublishLatency: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "uniwork_realtime_publish_latency_seconds",
			Help:    "Seconds from an outbox row's commit to its realtime frame being handed to the hub.",
			Buckets: []float64{0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60},
		}, []string{"topic"}),
	}
}

// ObserveRealtimePublish satisfies outbox.PublishMetrics.
func (o *Outbox) ObserveRealtimePublish(topic string, d time.Duration) {
	if d < 0 {
		d = 0
	}
	o.PublishLatency.WithLabelValues(topic).Observe(d.Seconds())
}

func (o *Outbox) Collectors() []prometheus.Collector {
	return []prometheus.Collector{o.Done, o.Retry, o.Dead, o.AuditRows, o.AuditExpired, o.PublishLatency}
}

// IncOutboxDone, IncOutboxRetry and IncOutboxDeadLetter satisfy
// outbox.Metrics; IncAuditEvent satisfies audit.Counter. Both interfaces are
// declared where they are used so those packages never import Prometheus.
func (o *Outbox) IncOutboxDone() { o.Done.Inc() }

func (o *Outbox) IncOutboxRetry() { o.Retry.Inc() }

func (o *Outbox) IncOutboxDeadLetter() { o.Dead.Inc() }

func (o *Outbox) IncAuditEvent(action string) { o.AuditRows.WithLabelValues(action).Inc() }

// SetAuditExpired satisfies service.ExpiryCounter.
func (o *Outbox) SetAuditExpired(organizationID string, count float64) {
	o.AuditExpired.WithLabelValues(organizationID).Set(count)
}

// outboxLagDesc is a gauge read straight from the table rather than tracked in
// memory: the number that matters is how old the oldest undelivered row is
// across every process, and only the database knows that.
var outboxLagDesc = prometheus.NewDesc(
	"uniwork_outbox_pending_age_seconds",
	"Age of the oldest outbox row of the topic that has not been delivered yet.",
	[]string{"topic"}, nil,
)

var outboxPendingDesc = prometheus.NewDesc(
	"uniwork_outbox_pending_total",
	"Outbox rows of the topic still waiting for delivery.",
	[]string{"topic"}, nil,
)

var outboxDeadByTopicDesc = prometheus.NewDesc(
	"uniwork_outbox_dead_letter_total",
	"Outbox rows of the topic parked as dead letters.",
	[]string{"topic"}, nil,
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
	ch <- outboxPendingDesc
	ch <- outboxDeadByTopicDesc
	ch <- outboxDeadGaugeDesc
}

func (c *OutboxLagCollector) Collect(ch chan<- prometheus.Metric) {
	if c.pool == nil {
		return
	}
	ctx := context.Background()
	rows, err := c.pool.Query(ctx, `
		SELECT topic,
		  count(*) FILTER (WHERE done_at IS NULL AND dead_at IS NULL AND status <> 'DEAD_LETTER')::float8 AS pending,
		  count(*) FILTER (WHERE dead_at IS NOT NULL OR status = 'DEAD_LETTER')::float8 AS dead,
		  COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE done_at IS NULL AND dead_at IS NULL AND status <> 'DEAD_LETTER'))), 0)::float8 AS age
		FROM outbox_events GROUP BY topic`)
	if err == nil {
		for rows.Next() {
			var topic string
			var pending, dead, age float64
			if rows.Scan(&topic, &pending, &dead, &age) != nil {
				continue
			}
			ch <- prometheus.MustNewConstMetric(outboxLagDesc, prometheus.GaugeValue, age, topic)
			ch <- prometheus.MustNewConstMetric(outboxPendingDesc, prometheus.GaugeValue, pending, topic)
			ch <- prometheus.MustNewConstMetric(outboxDeadByTopicDesc, prometheus.GaugeValue, dead, topic)
		}
		rows.Close()
	}
	var dead float64
	if err := c.pool.QueryRow(ctx,
		`SELECT count(*)::float8 FROM outbox_events WHERE dead_at IS NOT NULL OR status = 'DEAD_LETTER'`,
	).Scan(&dead); err == nil {
		ch <- prometheus.MustNewConstMetric(outboxDeadGaugeDesc, prometheus.GaugeValue, dead)
	}
}
