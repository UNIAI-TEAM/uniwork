package metrics

import "github.com/prometheus/client_golang/prometheus"

// Readiness exports the advisory /readyz checks (Redis, storage). They no
// longer gate readiness (H14), so without this gauge a dead Redis - which
// makes every rate limiter fail open - raises nothing. It satisfies
// service.ReadinessMetrics.
type Readiness struct {
	DependencyUp *prometheus.GaugeVec
}

func NewReadiness() *Readiness {
	return &Readiness{DependencyUp: prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "uniwork_readiness_dependency_up",
		Help: "1 when the last /readyz probe reached the dependency, 0 when it did not; absent when it is not configured.",
	}, []string{"dependency"})}
}

func (m *Readiness) Collectors() []prometheus.Collector {
	return []prometheus.Collector{m.DependencyUp}
}

// SetDependencyUp records one advisory check's outcome.
func (m *Readiness) SetDependencyUp(dependency string, up bool) {
	v := 0.0
	if up {
		v = 1
	}
	m.DependencyUp.WithLabelValues(dependency).Set(v)
}
