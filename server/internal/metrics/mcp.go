package metrics

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// Mcp counts the MCP connector. Labels are tool names, tool kinds, outcomes
// and OAuth events; never a tenant, user, client or grant id.
type Mcp struct {
	ToolCalls    *prometheus.CounterVec
	ToolDuration *prometheus.HistogramVec
	OAuth        *prometheus.CounterVec
}

func NewMcp() *Mcp {
	return &Mcp{
		ToolCalls: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_mcp_tool_calls_total",
			Help: "MCP tool calls by tool, kind (read, write) and outcome (ok, invalid, refused, not_found, cancelled, error).",
		}, []string{"tool", "kind", "outcome"}),
		ToolDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "uniwork_mcp_tool_duration_seconds",
			Help:    "MCP tool latency.",
			Buckets: []float64{0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
		}, []string{"tool"}),
		OAuth: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_mcp_oauth_events_total",
			Help: "MCP OAuth events: client_registered, authorize_started, consent_approved, consent_cancelled, token_issued, token_refreshed, token_revoked, family_revoked.",
		}, []string{"event"}),
	}
}

func (m *Mcp) Collectors() []prometheus.Collector {
	if m == nil {
		return nil
	}
	return []prometheus.Collector{m.ToolCalls, m.ToolDuration, m.OAuth}
}

func (m *Mcp) IncOAuth(event string) {
	if m != nil {
		m.OAuth.WithLabelValues(event).Inc()
	}
}

// ObserveTool counts one tool call. The duration keeps only the tool label:
// the kind follows from the tool, so it would add no information.
func (m *Mcp) ObserveTool(tool, kind, outcome string, d time.Duration) {
	if m != nil {
		m.ToolCalls.WithLabelValues(tool, kind, outcome).Inc()
		m.ToolDuration.WithLabelValues(tool).Observe(d.Seconds())
	}
}
