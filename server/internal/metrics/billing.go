package metrics

import "github.com/prometheus/client_golang/prometheus"

// Billing holds Prometheus counters for billing provider webhooks.
type Billing struct {
	WebhookDead prometheus.Counter
}

func NewBilling() *Billing {
	return &Billing{
		WebhookDead: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_billing_webhook_dead_total",
			Help: "Billing webhook inbox rows moved to dead letter after retries.",
		}),
	}
}

func (b *Billing) Collectors() []prometheus.Collector {
	if b == nil {
		return nil
	}
	return []prometheus.Collector{b.WebhookDead}
}

func (b *Billing) IncWebhookDead() {
	if b != nil {
		b.WebhookDead.Inc()
	}
}
