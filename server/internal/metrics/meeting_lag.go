package metrics

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// MeetingLagCollector exposes queue age gauges for meeting workers.
type MeetingLagCollector struct {
	pool *pgxpool.Pool

	outboxLag  *prometheus.Desc
	webhookLag *prometheus.Desc
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
	}
}

func (c *MeetingLagCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.outboxLag
	ch <- c.webhookLag
}

func (c *MeetingLagCollector) Collect(ch chan<- prometheus.Metric) {
	if c.pool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	var outboxAge, webhookAge float64
	_ = c.pool.QueryRow(ctx, `
		SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))), 0)::float8
		FROM outbox_events WHERE status IN ('PENDING', 'PROCESSING')
	`).Scan(&outboxAge)
	_ = c.pool.QueryRow(ctx, `
		SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(received_at))), 0)::float8
		FROM webhook_inbox WHERE status IN ('PENDING', 'PROCESSING')
	`).Scan(&webhookAge)

	ch <- prometheus.MustNewConstMetric(c.outboxLag, prometheus.GaugeValue, outboxAge)
	ch <- prometheus.MustNewConstMetric(c.webhookLag, prometheus.GaugeValue, webhookAge)
}
