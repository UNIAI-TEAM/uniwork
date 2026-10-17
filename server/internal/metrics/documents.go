package metrics

import "github.com/prometheus/client_golang/prometheus"

// Documents counts what the document service cannot report any other way
// (C-01 §3.6, G1-09 §4): an access-log row it failed to write after the read
// it belongs to already succeeded, a document whose protected versions alone
// overflow the compaction bound (C-01 §6.3), the save outcomes and latency,
// conflicts and quota rejections of the save paths, and the maintenance
// workers' sweep outcomes.
//
// The labels are a closed vocabulary - kind/outcome/code/worker/result - and
// never carry a document, user, organization or workspace id, so the series
// count cannot grow with the data. Orphan backlog and delete failures are the
// FileService GC's numbers (docs/ops/RUNBOOK_FILE_GC.md); they are not
// duplicated here. It satisfies service.DocumentMetrics.
type Documents struct {
	AccessLogFailed           prometheus.Counter
	VersionsProtectedOverflow prometheus.Counter
	Saves                     *prometheus.CounterVec
	SaveDuration              *prometheus.HistogramVec
	Conflicts                 *prometheus.CounterVec
	QuotaRejects              *prometheus.CounterVec
	WorkerSweeps              *prometheus.CounterVec
	WorkerSweepDuration       *prometheus.HistogramVec
	WorkerRowsFailed          *prometheus.CounterVec
	// The edit lock (UNI-1645, addendum §7): lock operations, writes refused
	// because another editor holds the lock, and edit-request outcomes. The
	// label values are closed sets and never carry an id.
	EditLockOps     *prometheus.CounterVec
	EditLockRefused *prometheus.CounterVec
	EditRequests    *prometheus.CounterVec
}

func NewDocuments() *Documents {
	return &Documents{
		AccessLogFailed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_document_access_log_failed_total",
			Help: "Document access-log rows that could not be written; the read itself succeeded.",
		}),
		VersionsProtectedOverflow: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_document_versions_protected_overflow_total",
			Help: "Documents whose manual/restore/upload versions alone pass the compaction bound; every version is kept.",
		}),
		Saves: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_document_saves_total",
			Help: "Document save commands by kind (page PATCH, file version commit) and outcome.",
		}, []string{"kind", "outcome"}),
		SaveDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "uniwork_document_save_duration_seconds",
			Help:    "Time a document save command took, by kind; the autosave SLO is measured here (C-01 §9.4).",
			Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2.5, 5, 10},
		}, []string{"kind"}),
		Conflicts: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_document_conflicts_total",
			Help: "Save conflicts by kind and stable error code; exactly one writer wins a base.",
		}, []string{"kind", "code"}),
		QuotaRejects: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_document_quota_rejects_total",
			Help: "Saves refused because storage.bytes would pass the organization's limit, by kind.",
		}, []string{"kind"}),
		WorkerSweeps: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_document_worker_sweeps_total",
			Help: "Document maintenance sweeps by worker and result (ok, partial = some rows failed, error = the pass stopped).",
		}, []string{"worker", "result"}),
		WorkerSweepDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "uniwork_document_worker_sweep_duration_seconds",
			Help:    "Time one document maintenance sweep took, by worker.",
			Buckets: []float64{0.01, 0.05, 0.1, 0.5, 1, 5, 30, 120, 600},
		}, []string{"worker"}),
		WorkerRowsFailed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_document_worker_rows_failed_total",
			Help: "Rows a document maintenance sweep failed on and skipped (auto-version, purge, compaction); the next tick retries them.",
		}, []string{"worker"}),
		EditLockOps: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_document_edit_lock_ops_total",
			Help: "Document edit-lock operations by op (acquire, take_over, handover, move_here, release, expire, access_lost, session_revoked).",
		}, []string{"op"}),
		EditLockRefused: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_document_edit_lock_refused_total",
			Help: "Content writes refused with 423 document_locked, by route (patch, commit, frame_commit, restore).",
		}, []string{"route"}),
		EditRequests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_document_edit_requests_total",
			Help: "Document edit-request outcomes by op (create, accept, decline, cancel, expire, rate_limited).",
		}, []string{"op"}),
	}
}

func (d *Documents) Collectors() []prometheus.Collector {
	return []prometheus.Collector{
		d.AccessLogFailed, d.VersionsProtectedOverflow,
		d.Saves, d.SaveDuration, d.Conflicts, d.QuotaRejects,
		d.WorkerSweeps, d.WorkerSweepDuration, d.WorkerRowsFailed,
		d.EditLockOps, d.EditLockRefused, d.EditRequests,
	}
}

func (d *Documents) IncDocumentAccessLogFailed()           { d.AccessLogFailed.Inc() }
func (d *Documents) IncDocumentVersionsProtectedOverflow() { d.VersionsProtectedOverflow.Inc() }

// ObserveDocumentSave records one save command. outcome is a fixed label from
// the service's classifier; seconds is the wall time from entry to answer.
func (d *Documents) ObserveDocumentSave(kind, outcome string, seconds float64) {
	d.Saves.WithLabelValues(kind, outcome).Inc()
	d.SaveDuration.WithLabelValues(kind).Observe(seconds)
}

// IncDocumentConflict records one save refused because its base moved (or the
// payload changed under an idempotency key).
func (d *Documents) IncDocumentConflict(kind, code string) {
	d.Conflicts.WithLabelValues(kind, code).Inc()
}

// IncDocumentQuotaRejected records one save refused by the storage.bytes
// limit, before any row was written.
func (d *Documents) IncDocumentQuotaRejected(kind string) {
	d.QuotaRejects.WithLabelValues(kind).Inc()
}

// IncDocumentEditLockOp records one edit-lock state change (op is one of the
// closed set in the counter's help).
func (d *Documents) IncDocumentEditLockOp(op string) {
	d.EditLockOps.WithLabelValues(op).Inc()
}

// IncDocumentEditLockRefused records one content write answered 423
// document_locked; the save outcome label for it is "locked", not "conflict".
func (d *Documents) IncDocumentEditLockRefused(route string) {
	d.EditLockRefused.WithLabelValues(route).Inc()
}

// IncDocumentEditRequest records one edit-request outcome.
func (d *Documents) IncDocumentEditRequest(op string) {
	d.EditRequests.WithLabelValues(op).Inc()
}

// ObserveDocumentWorkerSweep records one finished maintenance sweep.
func (d *Documents) ObserveDocumentWorkerSweep(worker, result string, seconds float64) {
	d.WorkerSweeps.WithLabelValues(worker, result).Inc()
	d.WorkerSweepDuration.WithLabelValues(worker).Observe(seconds)
}

// AddDocumentWorkerRowsFailed records the rows one sweep failed on.
func (d *Documents) AddDocumentWorkerRowsFailed(worker string, n int) {
	d.WorkerRowsFailed.WithLabelValues(worker).Add(float64(n))
}
