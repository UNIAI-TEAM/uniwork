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
	}
}

func (m *Drive) Collectors() []prometheus.Collector {
	if m == nil {
		return nil
	}
	return []prometheus.Collector{m.TokenRefreshFailures, m.RevocationAbandoned}
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
