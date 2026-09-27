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
	}
}

func (o *Office) Collectors() []prometheus.Collector {
	return []prometheus.Collector{o.Jobs, o.Duration, o.Ready, o.QueueDepth}
}

// ObserveOfficeJob records one settled job.
func (o *Office) ObserveOfficeJob(operation, outcome string, d time.Duration) {
	o.Jobs.WithLabelValues(operation, outcome).Inc()
	o.Duration.WithLabelValues(operation).Observe(d.Seconds())
}

// SetOfficeEngine records the last engine probe.
func (o *Office) SetOfficeEngine(ready bool, queueDepth int) {
	if ready {
		o.Ready.Set(1)
	} else {
		o.Ready.Set(0)
	}
	o.QueueDepth.Set(float64(queueDepth))
}
