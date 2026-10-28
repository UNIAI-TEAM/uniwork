package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

// Drive counts Google Drive connector token refresh failures and abandoned
// grant revocations (UNI-2172 / UNI-2178, spec §5.3b, §10). Labels never
// carry a tenant, user, connection or Google sub id.
type Drive struct {
	TokenRefreshFailures prometheus.Counter
	RevocationAbandoned  prometheus.Counter
	TaskProposals        *prometheus.CounterVec
	TaskProposalsPurged  prometheus.Counter
}

func NewDrive() *Drive {
	return &Drive{
		TokenRefreshFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "drive_token_refresh_failures_total",
			Help: "Google Drive OAuth refresh-token exchange failures.",
		}),
		RevocationAbandoned: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "drive_revocation_abandoned_total",
			Help: "Google Drive OAuth grant revocations abandoned after 24 hours of retries.",
		}),
		TaskProposals: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "drive_task_proposals_total",
			Help: "Google Drive task proposal requests by outcome.",
		}, []string{"result"}),
		TaskProposalsPurged: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "drive_task_proposals_purged_total",
			Help: "Google Drive task proposal batches purged by retention sweep.",
		}),
	}
}

func (m *Drive) Collectors() []prometheus.Collector {
	if m == nil {
		return nil
	}
	return []prometheus.Collector{m.TokenRefreshFailures, m.RevocationAbandoned, m.TaskProposals, m.TaskProposalsPurged}
}

func (m *Drive) ObserveTokenRefreshFailure() {
	if m != nil {
		m.TokenRefreshFailures.Inc()
	}
}

func (m *Drive) ObserveRevocationAbandoned() {
	if m != nil {
		m.RevocationAbandoned.Inc()
	}
}

func (m *Drive) ObserveTaskProposal(result string) {
	if m != nil && m.TaskProposals != nil {
		m.TaskProposals.WithLabelValues(result).Inc()
	}
}

func (m *Drive) ObserveTaskProposalsPurged(n int64) {
	if m != nil && m.TaskProposalsPurged != nil && n > 0 {
		m.TaskProposalsPurged.Add(float64(n))
	}
}
