package metrics

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

var (
	chatReportsOpenDesc = prometheus.NewDesc("uniwork_chat_reports_open",
		"Chat reports (message or person) still open in the operator's queue, across every organization.", nil, nil)
	chatReportsOldestDesc = prometheus.NewDesc("uniwork_chat_reports_oldest_open_age_seconds",
		"Age of the oldest open chat report; 0 when none is open. The terms promise a review within 24 hours.", nil, nil)
	chatReportsUpDesc = prometheus.NewDesc("uniwork_chat_reports_up",
		"1 when the chat report queue was read at this scrape, 0 when the read failed (the queue gauges are then absent).", nil, nil)
)

// ChatReportQueueCollector reads the open chat reports at scrape time. The
// alerts that hold the 24-hour promise of the terms (UniChatReportFiled,
// UniChatReportOverdue) need queue state: a counter of chat.report.created
// is created lazily by the first report a process records, so increase()
// never sees that report, and it forgets a report 30 minutes after it lands.
// The read is counts only, never a reason, a person or a message, and goes
// through idx_chat_reports_open, so it follows the open backlog, not the
// table.
type ChatReportQueueCollector struct{ pool *pgxpool.Pool }

func NewChatReportQueueCollector(pool *pgxpool.Pool) *ChatReportQueueCollector {
	return &ChatReportQueueCollector{pool: pool}
}

func (c *ChatReportQueueCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- chatReportsOpenDesc
	ch <- chatReportsOldestDesc
	ch <- chatReportsUpDesc
}

func (c *ChatReportQueueCollector) Collect(ch chan<- prometheus.Metric) {
	if c.pool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), lagReadTimeout)
	defer cancel()
	var open, oldest float64
	if err := c.pool.QueryRow(ctx, `SELECT count(*)::float8,
		COALESCE(EXTRACT(EPOCH FROM now() - min(created_at)), 0)::float8
		FROM chat_reports WHERE status = 'open'`).Scan(&open, &oldest); err != nil {
		// An absent gauge would silence both report alerts; say the read failed.
		ch <- prometheus.MustNewConstMetric(chatReportsUpDesc, prometheus.GaugeValue, 0)
		return
	}
	ch <- prometheus.MustNewConstMetric(chatReportsUpDesc, prometheus.GaugeValue, 1)
	ch <- prometheus.MustNewConstMetric(chatReportsOpenDesc, prometheus.GaugeValue, open)
	ch <- prometheus.MustNewConstMetric(chatReportsOldestDesc, prometheus.GaugeValue, oldest)
}
