package metrics

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// AI counts and times gateway calls (spec F-09 §8). It satisfies ai.Metrics.
type AI struct {
	Calls   *prometheus.CounterVec
	Latency *prometheus.HistogramVec
}

func NewAI() *AI {
	return &AI{
		Calls: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_ai_calls_total",
			Help: "AI gateway calls by capability and final status (succeeded, failed, rejected).",
		}, []string{"capability", "status"}),
		Latency: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "uniwork_ai_latency_ms",
			Help:    "Provider round-trip per gateway call, in milliseconds.",
			Buckets: []float64{100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000},
		}, []string{"capability"}),
	}
}

func (a *AI) Collectors() []prometheus.Collector { return []prometheus.Collector{a.Calls, a.Latency} }

func (a *AI) ObserveAICall(capability, status string, latency time.Duration) {
	a.Calls.WithLabelValues(capability, status).Inc()
	if latency > 0 {
		a.Latency.WithLabelValues(capability).Observe(float64(latency.Milliseconds()))
	}
}
