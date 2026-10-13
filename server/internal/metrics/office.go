package metrics

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// Office counts Office engine jobs as Go sees them (G2-02): the terminal
// outcome, the time from accept to settle, and the engine's own readiness and
// queue depth as last probed. The engine exports its per-worker metrics on
// its private /metrics; these are the API-side view. It satisfies
// service.OfficeMetrics.
type Office struct {
	Jobs       *prometheus.CounterVec
	Duration   *prometheus.HistogramVec
	Ready      prometheus.Gauge
	QueueDepth prometheus.Gauge
	// The file commit intents of G5-07 (service.OfficeIntentMetrics): lookups
	// by outcome, replays of a committed key and intents the retention sweep
	// deleted. The 409 at commit is uniwork_document_conflicts_total.
	IntentLookups     *prometheus.CounterVec
	IdempotentReplays prometheus.Counter
	IntentsSwept      prometheus.Counter
}

func NewOffice() *Office {
	return &Office{
		Jobs: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_office_jobs_total",
			Help: "Office engine jobs by operation and terminal outcome.",
		}, []string{"operation", "outcome"}),
		Duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "uniwork_office_job_duration_seconds",
			Help:    "Office engine job time from accept to settle.",
			Buckets: []float64{0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600},
		}, []string{"operation"}),
		Ready: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "uniwork_office_engine_ready",
			Help: "1 when the last Office engine readiness probe answered ready.",
		}),
		QueueDepth: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "uniwork_office_engine_queue_depth",
			Help: "Office engine queue depth at the last readiness probe.",
		}),
		IntentLookups: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_office_intent_lookups_total",
			Help: "File commit intent lookups by outcome (committed, not_committed, in_flight, unknown).",
		}, []string{"outcome"}),
		IdempotentReplays: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_office_idempotent_replays_total",
			Help: "File commits answered from the stored result of the same Idempotency-Key.",
		}),
		IntentsSwept: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_office_commit_intents_swept_total",
			Help: "File commit intents deleted by the retention sweep after their resume window.",
		}),
	}
}

func (o *Office) Collectors() []prometheus.Collector {
	return []prometheus.Collector{o.Jobs, o.Duration, o.Ready, o.QueueDepth, o.IntentLookups, o.IdempotentReplays, o.IntentsSwept}
}

// IncOfficeIntentLookup counts one intent lookup by its outcome.
func (o *Office) IncOfficeIntentLookup(outcome string) {
	o.IntentLookups.WithLabelValues(outcome).Inc()
}

// IncOfficeIdempotentReplay counts one commit answered from its stored result.
func (o *Office) IncOfficeIdempotentReplay() { o.IdempotentReplays.Inc() }

// AddOfficeCommitIntentsSwept counts intents one sweep pass deleted.
func (o *Office) AddOfficeCommitIntentsSwept(n int) {
	if n > 0 {
		o.IntentsSwept.Add(float64(n))
	}
}

// ObserveOfficeJob records one settled job.
func (o *Office) ObserveOfficeJob(operation, outcome string, d time.Duration) {
	o.Jobs.WithLabelValues(operation, outcome).Inc()
	o.Duration.WithLabelValues(operation).Observe(d.Seconds())
}

// SetOfficeEngine records the last engine probe. A negative depth means the
// probe failed: the gauge keeps its last value rather than reading as idle.
func (o *Office) SetOfficeEngine(ready bool, queueDepth int) {
	if ready {
		o.Ready.Set(1)
	} else {
		o.Ready.Set(0)
	}
	if queueDepth >= 0 {
		o.QueueDepth.Set(float64(queueDepth))
	}
}

// OfficeChangeFeed counts the change-feed snapshot sweep (G5-01a): rows the
// TTL worker deleted, by table. It satisfies
// service.DocumentChangeSweepMetrics.
type OfficeChangeFeed struct {
	SnapshotRowsSwept *prometheus.CounterVec
}

func NewOfficeChangeFeed() *OfficeChangeFeed {
	return &OfficeChangeFeed{
		SnapshotRowsSwept: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_office_change_snapshot_rows_swept_total",
			Help: "Expired Office change-feed snapshot rows deleted by the TTL sweep, by table.",
		}, []string{"table"}),
	}
}

func (o *OfficeChangeFeed) Collectors() []prometheus.Collector {
	return []prometheus.Collector{o.SnapshotRowsSwept}
}

// ObserveChangeSnapshotSweep records one committed sweep batch.
func (o *OfficeChangeFeed) ObserveChangeSnapshotSweep(snapshots, items int64) {
	o.SnapshotRowsSwept.WithLabelValues("document_change_snapshots").Add(float64(snapshots))
	o.SnapshotRowsSwept.WithLabelValues("document_change_snapshot_items").Add(float64(items))
}
