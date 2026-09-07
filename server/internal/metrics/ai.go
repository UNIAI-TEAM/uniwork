package metrics

import (
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// AI counts and times gateway calls (spec F-09 §8). It satisfies ai.Metrics.
type AI struct {
	Calls   *prometheus.CounterVec
	Latency *prometheus.HistogramVec
	// Per-organization usage (F-11 §6.3). organization_id is a label only
	// while the deployment has at most maxOrgLabels distinct organizations;
	// past that the label collapses to "other" and the usage table is the
	// source of truth.
	Requests *prometheus.CounterVec
	Tokens   *prometheus.CounterVec
	CostUSD  *prometheus.CounterVec

	mu   sync.Mutex
	orgs map[string]struct{}
}

const maxOrgLabels = 1000

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
		Requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_ai_requests_total",
			Help: "Priced AI calls by provider, model and organization.",
		}, []string{"provider", "model", "organization_id"}),
		Tokens: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_ai_tokens_total",
			Help: "Tokens by direction (input, output), provider, model and organization.",
		}, []string{"provider", "model", "organization_id", "direction"}),
		CostUSD: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_ai_cost_usd_total",
			Help: "Metered cost in USD by provider, model and organization.",
		}, []string{"provider", "model", "organization_id"}),
		orgs: map[string]struct{}{},
	}
}

// ObserveAIUsage satisfies ai.Metrics.
func (a *AI) ObserveAIUsage(provider, model, organizationID string, inputTokens, outputTokens int, costUSD float64) {
	org := a.orgLabel(organizationID)
	a.Requests.WithLabelValues(provider, model, org).Inc()
	a.Tokens.WithLabelValues(provider, model, org, "input").Add(float64(inputTokens))
	a.Tokens.WithLabelValues(provider, model, org, "output").Add(float64(outputTokens))
	a.CostUSD.WithLabelValues(provider, model, org).Add(costUSD)
}

func (a *AI) orgLabel(id string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.orgs[id]; ok {
		return id
	}
	if len(a.orgs) >= maxOrgLabels {
		return "other"
	}
	a.orgs[id] = struct{}{}
	return id
}

func (a *AI) Collectors() []prometheus.Collector {
	return []prometheus.Collector{a.Calls, a.Latency, a.Requests, a.Tokens, a.CostUSD}
}

func (a *AI) ObserveAICall(capability, status string, latency time.Duration) {
	a.Calls.WithLabelValues(capability, status).Inc()
	if latency > 0 {
		a.Latency.WithLabelValues(capability).Observe(float64(latency.Milliseconds()))
	}
}
