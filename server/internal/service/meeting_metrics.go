package service

// MeetingMetrics records meeting control-plane counters without importing Prometheus.
type MeetingMetrics interface {
	IncJoinDecision(decision string)
	IncWebhookReceived()
	IncWebhookDuplicate()
	IncWebhookProcessed()
	IncWebhookErrors()
	IncOutboxDone()
	IncOutboxRetry()
	IncOutboxDeadLetter()
	IncProviderDesync()
	Inc(event string)
}
