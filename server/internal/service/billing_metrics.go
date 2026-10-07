package service

// BillingMetrics records billing webhook counters without importing Prometheus.
type BillingMetrics interface {
	IncWebhookDead()
}
