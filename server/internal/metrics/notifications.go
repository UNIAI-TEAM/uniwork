package metrics

import "github.com/prometheus/client_golang/prometheus"

// Notifications counts what the notification consumer and its two delivery
// jobs do (spec F-07 §10). It satisfies notification.Metrics.
type Notifications struct {
	Created *prometheus.CounterVec
	Merged  prometheus.Counter
	Push    *prometheus.CounterVec
	Digest  prometheus.Counter
	// PushSuppressed counts pushes dropped on purpose: a chat push to an active
	// recipient, a call push with the mobile calls switch off.
	PushSuppressed *prometheus.CounterVec
	// PushReceipts counts Expo push receipts read back after delivery.
	PushReceipts *prometheus.CounterVec
	// APNsVoIP counts what APNs answered to iPhone VoIP pushes (ADR 0038).
	APNsVoIP *prometheus.CounterVec
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
			Help: "Push attempts (Web Push and Expo) by result: sent, gone (subscription revoked), failed, skipped (no sender, e.g. web while VAPID is off).",
		}, []string{"result"}),
		Digest: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_digest_sent_total",
			Help: "Daily notification digests queued to the mail outbox.",
		}),
		PushSuppressed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_push_suppressed_total",
			Help: "Pushes dropped before sending, by kind: a chat push to a recipient reading where it shows (a visible presence beat within 45s that no leave cleared, in its workspace or, for a DM or group, in any workspace of its organization), or an incoming-call push while the unichat_mobile_calls switch is off for them.",
		}, []string{"kind"}),
		PushReceipts: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_push_receipts_total",
			Help: "Expo push receipts by result: ok, device_not_registered (subscription revoked), message_too_big, message_rate_exceeded, mismatch_sender_id, invalid_credentials, error, expired (no receipt within a day), dropped (pending list full).",
		}, []string{"result"}),
		APNsVoIP: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_push_apns_voip_total",
			Help: "iPhone VoIP pushes sent straight to APNs, by result (sent, gone: token revoked, failed: retried) and Apple's reason code (\"\" when sent, transport for a network error, unknown for a body that is not one).",
		}, []string{"result", "reason"}),
	}
}

func (n *Notifications) Collectors() []prometheus.Collector {
	return []prometheus.Collector{n.Created, n.Merged, n.Push, n.Digest, n.PushSuppressed, n.PushReceipts, n.APNsVoIP}
}

func (n *Notifications) IncNotificationCreated(kind string) { n.Created.WithLabelValues(kind).Inc() }

func (n *Notifications) IncNotificationMerged() { n.Merged.Inc() }

func (n *Notifications) IncPushSent(result string) { n.Push.WithLabelValues(result).Inc() }

func (n *Notifications) IncDigestSent() { n.Digest.Inc() }

func (n *Notifications) IncPushSuppressed(kind string) { n.PushSuppressed.WithLabelValues(kind).Inc() }

func (n *Notifications) IncPushReceipt(result string) { n.PushReceipts.WithLabelValues(result).Inc() }

func (n *Notifications) IncAPNsVoIP(result, reason string) {
	n.APNsVoIP.WithLabelValues(result, reason).Inc()
}
