package metrics

import (
	"context"
	"sync"
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
	// RetentionDeleted and RetentionErrors count what the event retention
	// sweep (service.EventRetention) removed and where it failed, by table.
	RetentionDeleted *prometheus.CounterVec
	RetentionErrors  *prometheus.CounterVec
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
		RetentionDeleted: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_event_retention_deleted_total",
			Help: "Rows the event retention sweep deleted, by table (outbox_events, webhook_inbox, meeting_provider_events).",
		}, []string{"table"}),
		RetentionErrors: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_event_retention_errors_total",
			Help: "Event retention sweeps that failed on a table.",
		}, []string{"table"}),
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
	return []prometheus.Collector{o.Done, o.Retry, o.Dead, o.AuditRows, o.AuditExpired, o.PublishLatency, o.RetentionDeleted, o.RetentionErrors}
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

// AddEventRetentionDeleted and IncEventRetentionError satisfy
// service.EventRetentionMetrics.
func (o *Outbox) AddEventRetentionDeleted(table string, n int64) {
	o.RetentionDeleted.WithLabelValues(table).Add(float64(n))
}

func (o *Outbox) IncEventRetentionError(table string) { o.RetentionErrors.WithLabelValues(table).Inc() }

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

var outboxLagUpDesc = prometheus.NewDesc(
	"uniwork_outbox_lag_up",
	"1 when the last outbox lag read succeeded, 0 when it failed (the outbox gauges are then absent).",
	nil, nil,
)

// lagReadTimeout bounds a scrape-time queue read. Past it the read counts as
// failed: an overloaded database shows up as a down gauge, not a stalled
// scrape or a 0-second lag.
const lagReadTimeout = 2 * time.Second

// OutboxLagCollector reports the queue's health at scrape time. It reads only
// the rows that are not delivered (PENDING, PROCESSING, DEAD_LETTER) through
// idx_outbox_events_pending, never the DONE rows that make up the table, so
// the read stays cheap however large the table grows. A topic seen once keeps
// its series at 0 after it drains rather than vanishing from the panels.
type OutboxLagCollector struct {
	pool *pgxpool.Pool

	mu     sync.Mutex
	topics map[string]struct{}
}

func NewOutboxLagCollector(pool *pgxpool.Pool) *OutboxLagCollector {
	return &OutboxLagCollector{pool: pool, topics: map[string]struct{}{}}
}

func (c *OutboxLagCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- outboxLagDesc
	ch <- outboxPendingDesc
	ch <- outboxDeadByTopicDesc
	ch <- outboxDeadGaugeDesc
	ch <- outboxLagUpDesc
}

type outboxTopicLag struct {
	pending, dead, age float64
}

func (c *OutboxLagCollector) Collect(ch chan<- prometheus.Metric) {
	if c.pool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), lagReadTimeout)
	defer cancel()
	byTopic, err := c.read(ctx)
	if err != nil {
		ch <- prometheus.MustNewConstMetric(outboxLagUpDesc, prometheus.GaugeValue, 0)
		return
	}
	c.mu.Lock()
	for topic := range byTopic {
		c.topics[topic] = struct{}{}
	}
	topics := make([]string, 0, len(c.topics))
	for topic := range c.topics {
		topics = append(topics, topic)
	}
	c.mu.Unlock()

	var dead float64
	for _, topic := range topics {
		l := byTopic[topic]
		dead += l.dead
		ch <- prometheus.MustNewConstMetric(outboxLagDesc, prometheus.GaugeValue, l.age, topic)
		ch <- prometheus.MustNewConstMetric(outboxPendingDesc, prometheus.GaugeValue, l.pending, topic)
		ch <- prometheus.MustNewConstMetric(outboxDeadByTopicDesc, prometheus.GaugeValue, l.dead, topic)
	}
	ch <- prometheus.MustNewConstMetric(outboxDeadGaugeDesc, prometheus.GaugeValue, dead)
	ch <- prometheus.MustNewConstMetric(outboxLagUpDesc, prometheus.GaugeValue, 1)
}

// read returns every topic with an undelivered or dead row. Any error, a
// row that does not scan included, fails the whole read.
func (c *OutboxLagCollector) read(ctx context.Context) (map[string]outboxTopicLag, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT topic,
		  count(*) FILTER (WHERE status IN ('PENDING', 'PROCESSING'))::float8 AS pending,
		  count(*) FILTER (WHERE status = 'DEAD_LETTER')::float8 AS dead,
		  COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status IN ('PENDING', 'PROCESSING')))), 0)::float8 AS age
		FROM outbox_events
		WHERE status IN ('PENDING', 'PROCESSING', 'DEAD_LETTER')
		GROUP BY topic`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]outboxTopicLag{}
	for rows.Next() {
		var topic string
		var l outboxTopicLag
		if err := rows.Scan(&topic, &l.pending, &l.dead, &l.age); err != nil {
			return nil, err
		}
		out[topic] = l
	}
	return out, rows.Err()
}
