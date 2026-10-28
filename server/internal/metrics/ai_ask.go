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
	// Actions counts proposal rows by write tool and outcome; TaintDowngrades
	// counts Auto turns whose level-1 rows waited because the turn was tainted.
	Actions         *prometheus.CounterVec
	TaintDowngrades prometheus.Counter
	// Memory counts memory events by outcome; MemoryEntries is how many
	// entries the asker's memory held on each turn that carried it.
	Memory        *prometheus.CounterVec
	MemoryEntries prometheus.Histogram
}

var (
	askTools = map[string]bool{
		"search": true, "list_tasks": true, "get_task": true, "list_meetings": true,
		"get_meeting": true, "list_projects": true, "get_project": true, "get_document": true,
		"list_documents": true, "list_templates": true, "list_chat_rooms": true, "read_chat_room": true, "list_members": true, "member_workload": true,
	}
	askOutcomes   = map[string]bool{"answered": true, "agent_failed": true, "refused": true, "rate_limited": true, "busy": true, "timeout": true, "stopped": true, "interrupted": true, "rejected": true}
	askStatuses   = map[string]bool{"ok": true, "error": true, "truncated": true}
	askWriteTools = map[string]bool{
		"create_task": true, "update_task": true, "add_comment": true, "create_project": true,
		"update_project": true, "schedule_meeting": true, "update_meeting": true, "invite_to_meeting": true,
		"cancel_meeting": true, "restore_meeting": true, "create_document": true, "update_document": true,
		"add_document_comment": true, "create_office_document": true, "save_attachment_template": true, "send_chat_message": true,
	}
	askMemoryOutcomes = map[string]bool{"proposed": true, "applied": true, "rejected": true, "undone": true, "expired": true, "used": true, "import_split": true, "import_saved": true}
	askActionOutcomes = map[string]bool{"proposed": true, "auto_applied": true, "applied": true, "rejected": true, "failed": true, "undone": true}
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
		Actions: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_ai_ask_actions_total",
			Help: "Ask UNI proposal rows by write tool (registry names, else other) and outcome (proposed, auto_applied, applied, rejected, failed, undone).",
		}, []string{"tool", "outcome"}),
		TaintDowngrades: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_ai_ask_taint_downgrades_total",
			Help: "Ask UNI Auto turns whose level-1 rows waited for the asker because the turn read someone else's words.",
		}),
		Memory: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_ai_ask_memory_total",
			Help: "Ask UNI memory events by outcome (proposed, applied, rejected, undone, expired, used, import_split, import_saved).",
		}, []string{"outcome"}),
		MemoryEntries: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "uniwork_ai_ask_memory_entries",
			Help:    "Entries of the asker's memory on each Ask UNI turn that carried it; the cap is 50.",
			Buckets: []float64{0, 1, 2, 5, 10, 20, 30, 40, 50},
		}),
	}
}

func (m *AIAsk) Collectors() []prometheus.Collector {
	if m == nil {
		return nil
	}
	return []prometheus.Collector{m.Runs, m.Rounds, m.RunSeconds, m.ToolCalls, m.ToolSeconds, m.Actions, m.TaintDowngrades, m.Memory, m.MemoryEntries}
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

// ObserveAskAction records one proposal row's outcome; an unknown tool is
// other, an unknown outcome failed.
func (m *AIAsk) ObserveAskAction(tool, outcome string) {
	if m == nil {
		return
	}
	if !askWriteTools[tool] {
		tool = "other"
	}
	if !askActionOutcomes[outcome] {
		outcome = "failed"
	}
	m.Actions.WithLabelValues(tool, outcome).Inc()
}

// ObserveAskTaintDowngrade records an Auto turn that left its level-1 rows
// for the asker because it was tainted.
func (m *AIAsk) ObserveAskTaintDowngrade() {
	if m == nil {
		return
	}
	m.TaintDowngrades.Inc()
}

// ObserveAskMemory records one memory event; an unknown outcome is dropped.
func (m *AIAsk) ObserveAskMemory(outcome string) {
	if m == nil || !askMemoryOutcomes[outcome] {
		return
	}
	m.Memory.WithLabelValues(outcome).Inc()
}

// ObserveAskMemoryEntries records the entries one turn's memory held.
func (m *AIAsk) ObserveAskMemoryEntries(n int) {
	if m == nil {
		return
	}
	m.MemoryEntries.Observe(float64(n))
}
