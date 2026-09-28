package service

import (
	"errors"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
)

// Operational metrics of the document service (G1-09, UNI-683). Every label
// is a closed vocabulary - kind, outcome, code, worker, result - and never a
// document, user, organization or workspace id, so the series count cannot
// grow with the data (plan §4 G1-09 "Không label theo doc/user ID").
//
// Orphan backlog and delete failures are the FileService GC's numbers
// (docs/ops/RUNBOOK_FILE_GC.md); Documents does not duplicate them.

// Save kinds: the page PATCH (autosave) and the file version commit, the two
// commands the C-01 §9.4 latency targets measure. Quota rejections also use
// "asset", for a page image refused at upload.
const (
	documentMetricKindPage  = "page"
	documentMetricKindFile  = "file"
	documentMetricKindAsset = "asset"
)

// Outcome vocabulary. A conflict is a lost base race; the quota, invalid,
// gone and unavailable buckets each name one client-visible answer.
const (
	documentOutcomeOK          = "ok"
	documentOutcomeConflict    = "conflict"
	documentOutcomeQuota       = "quota"
	documentOutcomeForbidden   = "forbidden"
	documentOutcomeNotFound    = "not_found"
	documentOutcomeGone        = "gone"
	documentOutcomeInvalid     = "invalid"
	documentOutcomeUnavailable = "unavailable"
	documentOutcomeError       = "error"
)

// documentConflictCodes are the two answers that mean "another save moved the
// base first" (C-01 §7 matrix "hai save cùng base"). Other conflict-class
// refusals (upload_already_committed, engine_incompatible, ...) are still
// counted as conflicts in the outcome label, but named here only when the
// lost race is the cause.
var documentConflictCodes = map[string]bool{
	"revision_conflict":         true,
	"document_version_conflict": true,
}

// DocumentMetrics is every operational signal the document service can emit:
// the access-log and protected-overflow counters of G1-03/04, the save
// outcomes/latency/conflicts/quota rejections of G1-09, and the maintenance
// worker sweeps. metrics.Documents implements it; the zero value is safe
// (nopDocumentMetrics).
type DocumentMetrics interface {
	IncDocumentAccessLogFailed()
	IncDocumentVersionsProtectedOverflow()
	ObserveDocumentSave(kind, outcome string, seconds float64)
	IncDocumentConflict(kind, code string)
	IncDocumentQuotaRejected(kind string)
	ObserveDocumentWorkerSweep(worker, result string, seconds float64)
	AddDocumentWorkerRowsFailed(worker string, n int)
}

type nopDocumentMetrics struct{}

func (nopDocumentMetrics) IncDocumentAccessLogFailed()                        {}
func (nopDocumentMetrics) IncDocumentVersionsProtectedOverflow()              {}
func (nopDocumentMetrics) ObserveDocumentSave(string, string, float64)        {}
func (nopDocumentMetrics) IncDocumentConflict(string, string)                 {}
func (nopDocumentMetrics) IncDocumentQuotaRejected(string)                    {}
func (nopDocumentMetrics) ObserveDocumentWorkerSweep(string, string, float64) {}
func (nopDocumentMetrics) AddDocumentWorkerRowsFailed(string, int)            {}

// SetMetrics wires the operational counters. Unwired, every call is a nop.
func (s *DocumentService) SetMetrics(m DocumentMetrics) {
	if m == nil {
		m = nopDocumentMetrics{}
	}
	s.metrics = m
}

// documentSaveResult maps one save command's error onto the fixed outcome
// label and, for a lost base race, the stable conflict code.
func documentSaveResult(err error) (outcome, conflictCode string) {
	if err == nil {
		return documentOutcomeOK, ""
	}
	var ce CodedError
	if errors.As(err, &ce) {
		if documentConflictCodes[ce.Code] {
			return documentOutcomeConflict, ce.Code
		}
		switch ce.Code {
		case "quota_exceeded":
			return documentOutcomeQuota, ""
		case "document_deleted":
			return documentOutcomeGone, ""
		case "storage_unavailable":
			return documentOutcomeUnavailable, ""
		}
	}
	var ve ValidationError
	if errors.As(err, &ve) {
		return documentOutcomeInvalid, ""
	}
	switch {
	case errors.Is(err, ErrQuotaExceeded):
		return documentOutcomeQuota, ""
	case errors.Is(err, ErrMemberDeactivated), errors.Is(err, ErrOrganizationSuspended), errors.Is(err, ErrForbidden):
		return documentOutcomeForbidden, ""
	case errors.Is(err, ErrNotFound):
		return documentOutcomeNotFound, ""
	case errors.Is(err, ErrConflict):
		return documentOutcomeConflict, ""
	default:
		return documentOutcomeError, ""
	}
}

// recordDocumentSave times one save command and records its outcome; the
// conflict counter gets the stable code for a lost base race.
func (s *DocumentService) recordDocumentSave(kind string, err error, took time.Duration) {
	outcome, code := documentSaveResult(err)
	s.metrics.ObserveDocumentSave(kind, outcome, took.Seconds())
	if code != "" {
		s.metrics.IncDocumentConflict(kind, code)
	}
	if outcome == documentOutcomeQuota && kind == documentMetricKindFile {
		// Page rejections are counted where the page meter is consumed
		// (consumePageBytes covers create, save and auto-version); the file
		// commit charges through FileService.ClaimInTx, so it is counted here.
		s.metrics.IncDocumentQuotaRejected(kind)
	}
}

// recordDocumentUploadQuota counts an upload refused by the storage.bytes
// reservation (the FileService quota hook runs inside Upload, before a byte
// is stored). A refused upload has no upload id, so no later commit can count
// the same bytes again; a commit refused after a reservation passed is
// counted by recordDocumentSave instead.
func (s *DocumentService) recordDocumentUploadQuota(purpose files.UploadPurpose, err error) {
	if outcome, _ := documentSaveResult(err); outcome != documentOutcomeQuota {
		return
	}
	kind := documentMetricKindFile
	if purpose == files.DocumentAsset {
		kind = documentMetricKindAsset
	}
	s.metrics.IncDocumentQuotaRejected(kind)
}

// Sweep results: ok = every row done, partial = the pass finished but some
// rows failed (the worker logs and skips them, the next tick retries), error =
// the pass itself stopped.
const (
	documentSweepOK      = "ok"
	documentSweepPartial = "partial"
	documentSweepError   = "error"
)

// recordDocumentSweep records one maintenance sweep's outcome and duration,
// and the rows it failed on. A sweep is retried by the worker's next tick;
// the counters are what an alert watches while the lag gauge shows the
// backlog. failed rows never turn a pass into "ok".
func (s *DocumentService) recordDocumentSweep(worker string, failed int, err error, started time.Time) {
	result := documentSweepOK
	switch {
	case err != nil:
		result = documentSweepError
	case failed > 0:
		result = documentSweepPartial
	}
	s.metrics.ObserveDocumentWorkerSweep(worker, result, time.Since(started).Seconds())
	if failed > 0 {
		s.metrics.AddDocumentWorkerRowsFailed(worker, failed)
	}
}
