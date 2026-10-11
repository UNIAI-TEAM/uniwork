package metrics

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// Graph is the Work Graph projector and read path (C-11 §5.6). Labels carry
// topics, node types and results only — never tenant or entity ids.
type Graph struct {
	Marked        *prometheus.CounterVec
	Projected     *prometheus.CounterVec
	Lag           prometheus.Histogram
	Layer2Dropped *prometheus.CounterVec
}

func NewGraph() *Graph {
	return &Graph{
		Marked: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_graph_marked_total",
			Help: "Outbox rows the graph marker handled, by topic and result (marked, disabled, no_org, no_id).",
		}, []string{"topic", "result"}),
		Projected: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_graph_projected_total",
			Help: "Dirty nodes the projector worker handled, by node type and result (ok, error).",
		}, []string{"node_type", "result"}),
		Lag: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "uniwork_graph_projector_lag_seconds",
			Help:    "Seconds from the newest event folded into a dirty node to its projection commit.",
			Buckets: []float64{0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300},
		}),
		Layer2Dropped: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_graph_layer2_dropped_total",
			Help: "Nodes layer 1 admitted but the module gate refused (stale projection), by node type.",
		}, []string{"node_type"}),
	}
}

func (g *Graph) Collectors() []prometheus.Collector {
	return []prometheus.Collector{g.Marked, g.Projected, g.Lag, g.Layer2Dropped}
}

func (g *Graph) IncGraphMarked(topic, result string) { g.Marked.WithLabelValues(topic, result).Inc() }
func (g *Graph) IncGraphProjected(nodeType, result string) {
	g.Projected.WithLabelValues(nodeType, result).Inc()
}
func (g *Graph) IncGraphLayer2Dropped(nodeType string) {
	g.Layer2Dropped.WithLabelValues(nodeType).Inc()
}

func (g *Graph) ObserveGraphLag(d time.Duration) {
	if d < 0 {
		d = 0
	}
	g.Lag.Observe(d.Seconds())
}

var (
	graphDirtyPendingDesc = prometheus.NewDesc("uniwork_graph_dirty_pending",
		"Nodes waiting in graph_dirty.", nil, nil)
	graphDirtyOldestDesc = prometheus.NewDesc("uniwork_graph_dirty_oldest_seconds",
		"Age of the oldest event waiting in graph_dirty.", nil, nil)
	graphDirtyUpDesc = prometheus.NewDesc("uniwork_graph_dirty_lag_up",
		"1 when graph_dirty was read at this scrape, 0 when the read failed.", nil, nil)
)

// GraphDirtyCollector reads graph_dirty at scrape time.
type GraphDirtyCollector struct{ pool *pgxpool.Pool }

func NewGraphDirtyCollector(pool *pgxpool.Pool) *GraphDirtyCollector {
	return &GraphDirtyCollector{pool: pool}
}

func (c *GraphDirtyCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- graphDirtyPendingDesc
	ch <- graphDirtyOldestDesc
	ch <- graphDirtyUpDesc
}

func (c *GraphDirtyCollector) Collect(ch chan<- prometheus.Metric) {
	if c.pool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), lagReadTimeout)
	defer cancel()
	var pending, oldest float64
	if err := c.pool.QueryRow(ctx, `SELECT count(*)::float8,
		COALESCE(EXTRACT(EPOCH FROM now() - min(last_event_at)), 0)::float8 FROM graph_dirty`).Scan(&pending, &oldest); err != nil {
		// An absent age would silence GraphProjectorLagHigh; say the read failed.
		ch <- prometheus.MustNewConstMetric(graphDirtyUpDesc, prometheus.GaugeValue, 0)
		return
	}
	ch <- prometheus.MustNewConstMetric(graphDirtyUpDesc, prometheus.GaugeValue, 1)
	ch <- prometheus.MustNewConstMetric(graphDirtyPendingDesc, prometheus.GaugeValue, pending)
	ch <- prometheus.MustNewConstMetric(graphDirtyOldestDesc, prometheus.GaugeValue, oldest)
}
