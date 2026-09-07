package metrics

import "github.com/prometheus/client_golang/prometheus"

// Notifications counts what the notification consumer and its two delivery
// jobs do (spec F-07 §10). It satisfies notification.Metrics.
type Notifications struct {
	Created *prometheus.CounterVec
	Merged  prometheus.Counter
	Push    *prometheus.CounterVec
	Digest  prometheus.Counter
}

func NewNotifications() *Notifications {
	return &Notifications{
		Created: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_notifications_created_total",
			Help: "Notifications created, by kind.",
		}, []string{"kind"}),
		Merged: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_notifications_merged_total",
			Help: "Events folded into an existing unread notification instead of creating one.",
		}),
		Push: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_push_sent_total",
			Help: "Web push attempts by result: sent, gone (subscription revoked), failed.",
		}, []string{"result"}),
		Digest: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_digest_sent_total",
			Help: "Daily notification digests queued to the mail outbox.",
		}),
	}
}

func (n *Notifications) Collectors() []prometheus.Collector {
	return []prometheus.Collector{n.Created, n.Merged, n.Push, n.Digest}
}

func (n *Notifications) IncNotificationCreated(kind string) { n.Created.WithLabelValues(kind).Inc() }

func (n *Notifications) IncNotificationMerged() { n.Merged.Inc() }

func (n *Notifications) IncPushSent(result string) { n.Push.WithLabelValues(result).Inc() }

func (n *Notifications) IncDigestSent() { n.Digest.Inc() }
