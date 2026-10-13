package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

// AIUniwork is the UniWork AI transcript store's surface (G6-03a, G6-D1 A9):
// the conversations the TTL sweep removed, by reason, and how many are live.
// It satisfies ai.ConversationSweepMetrics.
type AIUniwork struct {
	Swept *prometheus.CounterVec
	Live  prometheus.Gauge
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
	}
}

func (a *AIUniwork) Collectors() []prometheus.Collector {
	return []prometheus.Collector{a.Swept, a.Live}
}

// IncUniworkConversationsSwept records one committed sweep: reason is expired
// (idle or absolute TTL) or kill_switch (office_ai_uniwork off for the
// organization).
func (a *AIUniwork) IncUniworkConversationsSwept(reason string, conversations int64) {
	a.Swept.WithLabelValues(reason).Add(float64(conversations))
}

// SetUniworkConversationsLive records the live conversation count of one pass.
func (a *AIUniwork) SetUniworkConversationsLive(n int64) { a.Live.Set(float64(n)) }
