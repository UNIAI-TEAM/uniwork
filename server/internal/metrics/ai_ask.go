package metrics

import "github.com/prometheus/client_golang/prometheus"

// AIAsk measures Ask UNI agent runs. Labels are closed sets: an unexpected
// value is mapped to a fixed fallback so cardinality stays bounded and no
// tenant, user or run id ever becomes a label.
type AIAsk struct {
	Runs        *prometheus.CounterVec
	Rounds      prometheus.Histogram
	RunSeconds  prometheus.Histogram
	ToolCalls   *prometheus.CounterVec
	ToolSeconds *prometheus.HistogramVec
}

var (
	askTools = map[string]bool{
		"search": true, "list_tasks": true, "get_task": true, "list_meetings": true,
		"get_meeting": true, "list_projects": true, "get_project": true, "get_document": true,
		"list_chat_rooms": true, "read_chat_room": true, "list_members": true, "member_workload": true,
	}
	askOutcomes = map[string]bool{"answered": true, "agent_failed": true, "refused": true, "rate_limited": true, "busy": true, "timeout": true, "stopped": true, "interrupted": true, "rejected": true}
	askStatuses = map[string]bool{"ok": true, "error": true, "truncated": true}
)

func NewAIAsk() *AIAsk {
	return &AIAsk{
		Runs: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_ai_ask_runs_total",
			Help: "Ask UNI agent runs by outcome (answered, agent_failed, refused, rate_limited, busy, timeout, stopped, interrupted, rejected); a vendor or quota limit is rate_limited, infrastructure errors count as agent_failed, a run the asker stopped is stopped and one cut by a server shutdown interrupted; a regenerate that lost to a newer answer is rejected.",
		}, []string{"outcome"}),
		Rounds: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "uniwork_ai_ask_run_rounds",
			Help:    "Tool rounds used by one Ask UNI agent run; capped at 4.",
			Buckets: []float64{0, 1, 2, 3, 4},
		}),
		RunSeconds: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "uniwork_ai_ask_run_seconds",
			Help:    "Wall time of one Ask UNI agent run; the run deadline is 120s.",
			Buckets: []float64{0.5, 1, 2.5, 5, 10, 20, 30, 60, 90, 120, 150},
		}),
		ToolCalls: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_ai_ask_tool_calls_total",
			Help: "Ask UNI agent tool calls by tool (registry names, else other) and status (ok, error, truncated).",
		}, []string{"tool", "status"}),
		ToolSeconds: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "uniwork_ai_ask_tool_seconds",
			Help:    "Ask UNI agent tool latency.",
			Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
		}, []string{"tool"}),
	}
}

func (m *AIAsk) Collectors() []prometheus.Collector {
	if m == nil {
		return nil
	}
	return []prometheus.Collector{m.Runs, m.Rounds, m.RunSeconds, m.ToolCalls, m.ToolSeconds}
}

// ObserveAskRun records one finished run; an unknown outcome counts as agent_failed.
func (m *AIAsk) ObserveAskRun(outcome string, rounds int, seconds float64) {
	if m == nil {
		return
	}
	if !askOutcomes[outcome] {
		outcome = "agent_failed"
	}
	m.Runs.WithLabelValues(outcome).Inc()
	m.Rounds.Observe(float64(rounds))
	m.RunSeconds.Observe(seconds)
}

// ObserveAskTool records one tool call; an unknown tool is other, an unknown status error.
func (m *AIAsk) ObserveAskTool(tool, status string, seconds float64) {
	if m == nil {
		return
	}
	if !askTools[tool] {
		tool = "other"
	}
	if !askStatuses[status] {
		status = "error"
	}
	m.ToolCalls.WithLabelValues(tool, status).Inc()
	m.ToolSeconds.WithLabelValues(tool).Observe(seconds)
}
