package metrics

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// MeetingLagCollector exposes queue age gauges for meeting workers: the
// oldest outbox row not delivered yet and the oldest webhook callback waiting
// or leased. Each read goes through a partial index of the open rows
// (idx_outbox_events_open; idx_webhook_inbox_pending and
// idx_webhook_inbox_processing), so its cost follows the backlog, not the
// table. A read that fails or runs past lagReadTimeout leaves its gauge absent
// and sets uniwork_meeting_queue_lag_up{queue} to 0: a stuck queue behind an
// overloaded database never reads as a 0-second lag.
type MeetingLagCollector struct {
	pool *pgxpool.Pool

	outboxLag  *prometheus.Desc
	webhookLag *prometheus.Desc
	up         *prometheus.Desc
}

func NewMeetingLagCollector(pool *pgxpool.Pool) *MeetingLagCollector {
	return &MeetingLagCollector{
		pool: pool,
		outboxLag: prometheus.NewDesc(
			"uniwork_meeting_outbox_oldest_pending_seconds",
			"Age in seconds of the oldest pending or processing outbox row.",
			nil, nil,
		),
		webhookLag: prometheus.NewDesc(
			"uniwork_meeting_webhook_inbox_oldest_pending_seconds",
			"Age in seconds of the oldest pending or processing webhook inbox row.",
			nil, nil,
		),
		up: prometheus.NewDesc(
			"uniwork_meeting_queue_lag_up",
			"1 when the last lag read of a meeting queue (outbox, webhook_inbox) succeeded, 0 when it failed (the lag gauge is then absent).",
			[]string{"queue"}, nil,
		),
	}
}

func (c *MeetingLagCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.outboxLag
	ch <- c.webhookLag
	ch <- c.up
}

func (c *MeetingLagCollector) Collect(ch chan<- prometheus.Metric) {
	if c.pool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), lagReadTimeout)
	defer cancel()

	// One probe of idx_outbox_events_open: the first entry is the oldest.
	c.emit(ch, "outbox", c.outboxLag, c.age(ctx, `
		SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))), 0)::float8
		FROM outbox_events WHERE status IN ('PENDING', 'PROCESSING')
	`))
	// Two subqueries, one per partial index: a single IN ('PENDING',
	// 'PROCESSING') matches neither index predicate and scans the table.
	c.emit(ch, "webhook_inbox", c.webhookLag, c.age(ctx, `
		SELECT COALESCE(EXTRACT(EPOCH FROM (now() - LEAST(
		  (SELECT min(received_at) FROM webhook_inbox WHERE status = 'PENDING'),
		  (SELECT min(received_at) FROM webhook_inbox WHERE status = 'PROCESSING')
		))), 0)::float8
	`))
}

type lagRead struct {
	seconds float64
	err     error
}

func (c *MeetingLagCollector) age(ctx context.Context, sql string) lagRead {
	var r lagRead
	r.err = c.pool.QueryRow(ctx, sql).Scan(&r.seconds)
	return r
}

func (c *MeetingLagCollector) emit(ch chan<- prometheus.Metric, queue string, desc *prometheus.Desc, r lagRead) {
	if r.err != nil {
		ch <- prometheus.MustNewConstMetric(c.up, prometheus.GaugeValue, 0, queue)
		return
	}
	ch <- prometheus.MustNewConstMetric(desc, prometheus.GaugeValue, r.seconds)
	ch <- prometheus.MustNewConstMetric(c.up, prometheus.GaugeValue, 1, queue)
}
