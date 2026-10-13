package metrics

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// Office counts Office engine jobs as Go sees them (G2-02): the terminal
// outcome, the time from accept to settle, and the engine's own readiness and
// queue depth as last probed. The engine exports its per-worker metrics on
// its private /metrics; these are the API-side view. It satisfies
// service.OfficeMetrics.
type Office struct {
	Jobs       *prometheus.CounterVec
	Duration   *prometheus.HistogramVec
	Ready      prometheus.Gauge
	QueueDepth prometheus.Gauge
	// The file commit intents of G5-07 (service.OfficeIntentMetrics): lookups
	// by outcome, replays of a committed key and intents the retention sweep
	// deleted. The 409 at commit is uniwork_document_conflicts_total.
	IntentLookups     *prometheus.CounterVec
	IdempotentReplays prometheus.Counter
	IntentsSwept      prometheus.Counter
}

func NewOffice() *Office {
	return &Office{
		Jobs: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_office_jobs_total",
			Help: "Office engine jobs by operation and terminal outcome.",
		}, []string{"operation", "outcome"}),
		Duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "uniwork_office_job_duration_seconds",
			Help:    "Office engine job time from accept to settle.",
			Buckets: []float64{0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600},
		}, []string{"operation"}),
		Ready: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "uniwork_office_engine_ready",
			Help: "1 when the last Office engine readiness probe answered ready.",
		}),
		QueueDepth: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "uniwork_office_engine_queue_depth",
			Help: "Office engine queue depth at the last readiness probe.",
		}),
		IntentLookups: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_office_intent_lookups_total",
			Help: "File commit intent lookups by outcome (committed, not_committed, in_flight, unknown).",
		}, []string{"outcome"}),
		IdempotentReplays: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_office_idempotent_replays_total",
			Help: "File commits answered from the stored result of the same Idempotency-Key.",
		}),
		IntentsSwept: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_office_commit_intents_swept_total",
			Help: "File commit intents deleted by the retention sweep after their resume window.",
		}),
	}
}

func (o *Office) Collectors() []prometheus.Collector {
	return []prometheus.Collector{o.Jobs, o.Duration, o.Ready, o.QueueDepth, o.IntentLookups, o.IdempotentReplays, o.IntentsSwept}
}

// IncOfficeIntentLookup counts one intent lookup by its outcome.
func (o *Office) IncOfficeIntentLookup(outcome string) {
	o.IntentLookups.WithLabelValues(outcome).Inc()
}

// IncOfficeIdempotentReplay counts one commit answered from its stored result.
func (o *Office) IncOfficeIdempotentReplay() { o.IdempotentReplays.Inc() }

// AddOfficeCommitIntentsSwept counts intents one sweep pass deleted.
func (o *Office) AddOfficeCommitIntentsSwept(n int) {
	if n > 0 {
		o.IntentsSwept.Add(float64(n))
	}
}

// ObserveOfficeJob records one settled job.
func (o *Office) ObserveOfficeJob(operation, outcome string, d time.Duration) {
	o.Jobs.WithLabelValues(operation, outcome).Inc()
	o.Duration.WithLabelValues(operation).Observe(d.Seconds())
}

// SetOfficeEngine records the last engine probe. A negative depth means the
// probe failed: the gauge keeps its last value rather than reading as idle.
func (o *Office) SetOfficeEngine(ready bool, queueDepth int) {
	if ready {
		o.Ready.Set(1)
	} else {
		o.Ready.Set(0)
	}
	if queueDepth >= 0 {
		o.QueueDepth.Set(float64(queueDepth))
	}
}

// OfficeChangeFeed counts the change-feed snapshot sweep (G5-01a) and reports
// the incremental feed's lag (G5-01b): rows the TTL worker deleted, by table,
// and the age of the oldest change the feed had not delivered when it last
// served a page. It satisfies service.DocumentChangeSweepMetrics and
// service.DocumentChangeFeedLagMetrics.
type OfficeChangeFeed struct {
	SnapshotRowsSwept *prometheus.CounterVec
	FeedLag           prometheus.Gauge
}

func NewOfficeChangeFeed() *OfficeChangeFeed {
	return &OfficeChangeFeed{
		SnapshotRowsSwept: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_office_change_snapshot_rows_swept_total",
			Help: "Expired Office change-feed snapshot rows deleted by the TTL sweep, by table.",
		}, []string{"table"}),
		FeedLag: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "uniwork_office_change_feed_lag_seconds",
			Help: "Age in seconds of the oldest committed document change the incremental change feed had not delivered when it last served a page; 0 when that page caught the caller up.",
		}),
	}
}

func (o *OfficeChangeFeed) Collectors() []prometheus.Collector {
	return []prometheus.Collector{o.SnapshotRowsSwept, o.FeedLag}
}

// ObserveChangeSnapshotSweep records one committed sweep batch.
func (o *OfficeChangeFeed) ObserveChangeSnapshotSweep(snapshots, items int64) {
	o.SnapshotRowsSwept.WithLabelValues("document_change_snapshots").Add(float64(snapshots))
	o.SnapshotRowsSwept.WithLabelValues("document_change_snapshot_items").Add(float64(items))
}

// ObserveDocumentChangeFeedLag records the lag of the last served feed page:
// how long the oldest change the feed had not delivered had waited (G5-01b).
// The gauge is the last page across all workspaces, which is what an alert on
// "the feed is falling behind" reads; the per-workspace split is a G5-D2
// decision, not a label set built here.
func (o *OfficeChangeFeed) ObserveDocumentChangeFeedLag(seconds float64) {
	o.FeedLag.Set(seconds)
}

// OfficeLease counts the offline lease paths (G5-08s, decision G5-D1 row 17;
// RevokeFailed is FIX-7). Every label is a closed set; no organization, user
// or document is ever a label. It satisfies service.OfficeLeaseMetrics.
type OfficeLease struct {
	Grants       *prometheus.CounterVec
	Blocked      *prometheus.CounterVec
	Revoked      *prometheus.CounterVec
	RevokeFailed prometheus.Counter
	Swept        prometheus.Counter
}

func NewOfficeLease() *OfficeLease {
	return &OfficeLease{
		Grants: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_office_offline_lease_grants_total",
			Help: "Offline leases granted, renewed or released, by operation (grant, renew, release).",
		}, []string{"op"}),
		Blocked: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_office_offline_lease_blocked_total",
			Help: "Offline lease grants and renewals refused, by reason (device, acl, epoch, revoked, flag_off, limit, archived, signature).",
		}, []string{"reason"}),
		Revoked: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_office_offline_leases_revoked_total",
			Help: "Offline leases revoked, by reason (device_revoked, session_revoked, member_deactivated, member_removed, share_revoked, document_deleted, document_moved, policy_epoch, admin).",
		}, []string{"reason"}),
		RevokeFailed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_office_offline_lease_revoke_failed_total",
			Help: "Fail-closed offline lease revokes that did not land (the post-commit membership re-check errored); the outbox consumer must close the row.",
		}),
		Swept: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_office_offline_lease_sweep_deleted_total",
			Help: "Dead offline lease rows (expired or revoked past retention) deleted by the sweep.",
		}),
	}
}

func (o *OfficeLease) Collectors() []prometheus.Collector {
	return []prometheus.Collector{o.Grants, o.Blocked, o.Revoked, o.RevokeFailed, o.Swept}
}

// ObserveOfficeLease records one committed grant, renew or release.
func (o *OfficeLease) ObserveOfficeLease(op string) { o.Grants.WithLabelValues(op).Inc() }

// ObserveOfficeLeaseBlocked records one refused grant or renewal.
func (o *OfficeLease) ObserveOfficeLeaseBlocked(reason string) {
	o.Blocked.WithLabelValues(reason).Inc()
}

// ObserveOfficeLeasesRevoked records n leases revoked for one reason.
func (o *OfficeLease) ObserveOfficeLeasesRevoked(reason string, n int) {
	o.Revoked.WithLabelValues(reason).Add(float64(n))
}

// ObserveOfficeLeaseRevokeFailed records one fail-closed revoke that failed.
func (o *OfficeLease) ObserveOfficeLeaseRevokeFailed() { o.RevokeFailed.Inc() }

// ObserveOfficeLeaseSweep records one sweep batch.
func (o *OfficeLease) ObserveOfficeLeaseSweep(n int64) { o.Swept.Add(float64(n)) }
