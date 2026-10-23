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
	// IncSummaryError counts one failed AI summary run by reason.
	IncSummaryError(reason string)
	Inc(event string)
}
