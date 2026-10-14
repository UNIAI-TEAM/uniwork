package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

// AIUniwork is the UniWork AI transcript store's surface (G6-03a, G6-D1 A9):
// the conversations the TTL sweep removed, by reason, and how many are live.
// It satisfies ai.ConversationSweepMetrics.
//
// From G6-03b it also carries the run/usage surface (design §7): unknown
// usage calls, reconciled rows, the length and credits of a run, dropped tool
// calls by reason, and the runs the sweep removed. It satisfies
// service.UniworkRunMetrics, ai.RunSweepMetrics and the reconciler's surface.
type AIUniwork struct {
	Swept *prometheus.CounterVec
	Live  prometheus.Gauge
	// UsageUnknown counts model calls whose vendor sent no usage block (A16).
	UsageUnknown prometheus.Counter
	// UsageReconciled counts usage rows the reconciliation pass priced.
	UsageReconciled prometheus.Counter
	// RunSeconds is the age of a run at each answered turn, in seconds.
	RunSeconds prometheus.Histogram
	// RunCredits is the tokens a run has spent after each answered turn.
	RunCredits prometheus.Histogram
	// DroppedToolCalls counts calls dropped from an answer, by A13 reason.
	DroppedToolCalls *prometheus.CounterVec
	// RunsSwept counts runs the TTL sweep removed, by reason.
	RunsSwept *prometheus.CounterVec
}

func NewAIUniwork() *AIUniwork {
	return &AIUniwork{
		Swept: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_ai_uniwork_conversations_swept_total",
			Help: "UniWork AI conversations deleted by the TTL sweep, by reason (expired, kill_switch).",
		}, []string{"reason"}),
		Live: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "uniwork_ai_uniwork_conversations_live",
			Help: "UniWork AI conversations that have not expired.",
		}),
		UsageUnknown: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_ai_uniwork_usage_unknown_total",
			Help: "UniWork AI model calls whose vendor reported no usage block; the row is priced by reconciliation.",
		}),
		UsageReconciled: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_ai_uniwork_usage_reconciled_total",
			Help: "UniWork AI usage rows the reconciliation pass estimated and metered.",
		}),
		RunSeconds: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "uniwork_ai_uniwork_run_seconds",
			Help:    "Age in seconds of the UniWork AI run at each answered turn; the last turn of a run is its length.",
			Buckets: prometheus.ExponentialBuckets(1, 2, 8),
		}),
		RunCredits: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "uniwork_ai_uniwork_run_credits",
			Help:    "Tokens a UniWork AI run has spent after each answered turn; the last turn of a run is its total.",
			Buckets: prometheus.ExponentialBuckets(1000, 4, 6),
		}),
		DroppedToolCalls: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_ai_uniwork_dropped_tool_calls_total",
			Help: "UniWork AI tool calls dropped from an answer, by x_uniwork reason (view_only, not_allowlisted).",
		}, []string{"reason"}),
		RunsSwept: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_ai_uniwork_runs_swept_total",
			Help: "UniWork AI runs deleted by the TTL sweep, by reason (expired, orphan).",
		}, []string{"reason"}),
	}
}

func (a *AIUniwork) Collectors() []prometheus.Collector {
	return []prometheus.Collector{a.Swept, a.Live, a.UsageUnknown, a.UsageReconciled, a.RunSeconds, a.RunCredits, a.DroppedToolCalls, a.RunsSwept}
}

// IncUniworkConversationsSwept records one committed sweep: reason is expired
// (idle or absolute TTL) or kill_switch (office_ai_uniwork off for the
// organization).
func (a *AIUniwork) IncUniworkConversationsSwept(reason string, conversations int64) {
	a.Swept.WithLabelValues(reason).Add(float64(conversations))
}

// SetUniworkConversationsLive records the live conversation count of one pass.
func (a *AIUniwork) SetUniworkConversationsLive(n int64) { a.Live.Set(float64(n)) }

// IncUniworkUsageUnknown records calls whose vendor sent no usage block.
func (a *AIUniwork) IncUniworkUsageUnknown(calls int64) { a.UsageUnknown.Add(float64(calls)) }

// IncUniworkUsageReconciled records rows the reconciliation pass priced.
func (a *AIUniwork) IncUniworkUsageReconciled(rows int64) { a.UsageReconciled.Add(float64(rows)) }

// ObserveUniworkRun records one answered turn of a run: its age and the
// credits it has spent so far (design §7).
func (a *AIUniwork) ObserveUniworkRun(seconds float64, credits int64) {
	a.RunSeconds.Observe(seconds)
	a.RunCredits.Observe(float64(credits))
}

// IncUniworkDroppedToolCalls records calls dropped from an answer, by reason.
func (a *AIUniwork) IncUniworkDroppedToolCalls(reason string, calls int64) {
	a.DroppedToolCalls.WithLabelValues(reason).Add(float64(calls))
}

// IncUniworkRunsSwept records runs the TTL sweep removed, by reason.
func (a *AIUniwork) IncUniworkRunsSwept(reason string, runs int64) {
	a.RunsSwept.WithLabelValues(reason).Add(float64(runs))
}
