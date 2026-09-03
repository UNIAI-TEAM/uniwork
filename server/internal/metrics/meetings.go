package metrics

import "github.com/prometheus/client_golang/prometheus"

// Meetings holds Prometheus counters for the meeting control plane.
type Meetings struct {
	JoinDecision     *prometheus.CounterVec
	WebhookReceived  prometheus.Counter
	WebhookDuplicate prometheus.Counter
	WebhookProcessed prometheus.Counter
	WebhookErrors    prometheus.Counter
	OutboxDone       prometheus.Counter
	OutboxRetry      prometheus.Counter
	OutboxDeadLetter prometheus.Counter
	ProviderDesync   prometheus.Counter
}

func NewMeetings() *Meetings {
	return &Meetings{
		JoinDecision: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_meeting_join_decisions_total",
			Help: "Join admission outcomes.",
		}, []string{"decision"}),
		WebhookReceived: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_meeting_webhook_received_total",
			Help: "LiveKit webhooks accepted into the inbox.",
		}),
		WebhookDuplicate: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_meeting_webhook_duplicate_total",
			Help: "Duplicate provider webhook events ignored.",
		}),
		WebhookProcessed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_meeting_webhook_processed_total",
			Help: "Webhook inbox rows processed successfully.",
		}),
		WebhookErrors: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_meeting_webhook_errors_total",
			Help: "Webhook inbox processing failures.",
		}),
		OutboxDone: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_meeting_outbox_done_total",
			Help: "Meeting provider outbox jobs completed.",
		}),
		OutboxRetry: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_meeting_outbox_retry_total",
			Help: "Meeting provider outbox retries.",
		}),
		OutboxDeadLetter: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_meeting_outbox_dead_letter_total",
			Help: "Meeting provider outbox jobs moved to dead letter.",
		}),
		ProviderDesync: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_meeting_provider_desync_total",
			Help: "IN_PROGRESS meetings whose LiveKit room is IDLE (control-plane mismatch).",
		}),
	}
}

func (m *Meetings) IncJoinDecision(decision string) {
	if m != nil && decision != "" {
		m.JoinDecision.WithLabelValues(decision).Inc()
	}
}

func (m *Meetings) IncWebhookReceived() {
	if m != nil {
		m.WebhookReceived.Inc()
	}
}

func (m *Meetings) IncWebhookDuplicate() {
	if m != nil {
		m.WebhookDuplicate.Inc()
	}
}

func (m *Meetings) IncWebhookProcessed() {
	if m != nil {
		m.WebhookProcessed.Inc()
	}
}

func (m *Meetings) IncWebhookErrors() {
	if m != nil {
		m.WebhookErrors.Inc()
	}
}

func (m *Meetings) IncOutboxDone() {
	if m != nil {
		m.OutboxDone.Inc()
	}
}

func (m *Meetings) IncOutboxRetry() {
	if m != nil {
		m.OutboxRetry.Inc()
	}
}

func (m *Meetings) IncOutboxDeadLetter() {
	if m != nil {
		m.OutboxDeadLetter.Inc()
	}
}

func (m *Meetings) IncProviderDesync() {
	if m != nil {
		m.ProviderDesync.Inc()
	}
}

func (m *Meetings) Collectors() []prometheus.Collector {
	if m == nil {
		return nil
	}
	return []prometheus.Collector{
		m.JoinDecision,
		m.WebhookReceived,
		m.WebhookDuplicate,
		m.WebhookProcessed,
		m.WebhookErrors,
		m.OutboxDone,
		m.OutboxRetry,
		m.OutboxDeadLetter,
		m.ProviderDesync,
	}
}
