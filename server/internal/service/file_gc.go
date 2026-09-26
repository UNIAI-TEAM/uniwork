package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The collector (T5, spec 9.1-9.5). Once a day it drains the durable jobs the
// upload pipeline and the modules enqueue - cleanup after a release, a cancel
// or an expired claim window, reconcile after a write lease - and finds files
// whose last reference went away without a release. A file is only deleted
// after the lock protocol proves nothing holds it:
//
//  1. lease the job; in one transaction lock the batch's files in id order,
//     then their sessions, then the jobs, and re-check age, session, locator,
//     tenant and every ReferenceProvider after the locks (READ COMMITTED sees
//     what just committed);
//  2. mark the free files deleting and commit - the barrier that makes every
//     later claim and resolve refuse them;
//  3. delete the object outside any transaction and verify it is gone;
//  4. mark the file deleted and close the job, fenced by the job generation.
//
// A failure anywhere keeps the file and returns the job to pending for a
// later daily sweep; nothing ever gives up on a job. Destructive mode is off
// by default: the zero configuration is a dry run that reports what it would
// do (Gate C).

// FileGCMode says whether the collector runs and whether it may delete.
type FileGCMode string

const (
	// FileGCOff: no sweep at all.
	FileGCOff FileGCMode = "off"
	// FileGCDryRun reads, checks and reports; it writes nothing. Default.
	FileGCDryRun FileGCMode = "dry_run"
	// FileGCDestructive transitions jobs and files and deletes objects.
	// Gate C forbids it in a real environment until the rollout decision.
	FileGCDestructive FileGCMode = "destructive"
)

// FileGCConfig configures the daily collector. Zero values take the defaults
// below; Mode "" is dry-run.
type FileGCConfig struct {
	Mode FileGCMode
	// DailyAt is the time of day of the sweep in Location (T1-Q5: once a day
	// on a system schedule). Default 03:00.
	DailyAt time.Duration
	// Location is the schedule's zone. Default UTC+7, the team's zone.
	Location *time.Location
	// BatchSize is how many jobs one locked batch covers. Default 100.
	BatchSize int
	// Concurrency bounds the object deletes and reconcile checks in flight.
	// Default 4.
	Concurrency int
	// MaxJobsPerRun bounds one sweep; the rest waits for the next day.
	// Default 10000.
	MaxJobsPerRun int
	// MaxScanPerRun bounds the scan for released-but-unjobbed files.
	// Default 50000.
	MaxScanPerRun int
	// JobLease is how long a leased job belongs to this sweep before a crash
	// recovery may retake it. Default 30 minutes.
	JobLease time.Duration
}

// fileGCZone is the default schedule zone (UTC+7, no DST).
var fileGCZone = time.FixedZone("UTC+7", 7*60*60)

func (c FileGCConfig) normalized() (FileGCConfig, error) {
	switch c.Mode {
	case "":
		c.Mode = FileGCDryRun
	case FileGCOff, FileGCDryRun, FileGCDestructive:
	default:
		return c, fmt.Errorf("files: unknown GC mode %q", string(c.Mode))
	}
	if c.DailyAt < 0 || c.DailyAt >= 24*time.Hour {
		return c, fmt.Errorf("files: GC time of day %s is outside one day", c.DailyAt)
	}
	if c.DailyAt == 0 {
		c.DailyAt = 3 * time.Hour
	}
	if c.Location == nil {
		c.Location = fileGCZone
	}
	if c.BatchSize <= 0 {
		c.BatchSize = 100
	}
	if c.BatchSize > 1000 {
		c.BatchSize = 1000
	}
	if c.Concurrency <= 0 {
		c.Concurrency = 4
	}
	if c.MaxJobsPerRun <= 0 {
		c.MaxJobsPerRun = 10000
	}
	if c.MaxScanPerRun <= 0 {
		c.MaxScanPerRun = 50000
	}
	if c.JobLease <= 0 {
		c.JobLease = 30 * time.Minute
	}
	return c, nil
}

// nextRun is the first schedule slot strictly after now.
func (c FileGCConfig) nextRun(now time.Time) time.Time {
	local := now.In(c.Location)
	slot := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, c.Location).Add(c.DailyAt)
	for !slot.After(now) {
		slot = slot.AddDate(0, 0, 1)
	}
	return slot.UTC()
}

// fileGCRunLockKey is the advisory lock of the run lease ("unifgc").
const fileGCRunLockKey int64 = 0x756e69666763

// fileGCAge is the garbage age: a file is considered once it is more than
// 24 hours past ready (T1-Q5/T1-Q6), whatever happened to it since.
const fileGCAge = files.ClaimTTL

// fileGCHooks are test seams for the collector's barriers. Nil in production.
type fileGCHooks struct {
	// beforeBatchLock runs once a batch's jobs are leased, before any lock.
	beforeBatchLock func()
	// batchLocked runs inside the batch transaction once every row is locked.
	batchLocked func(ids []files.FileID)
	// deletingCommitted runs after the deleting barrier commits; returning
	// false stops the sweep there, like a crash before the object delete.
	deletingCommitted func(id files.FileID) bool
}

// FileGCAction is what the collector did (or, in dry-run, would do) with one
// job or file.
type FileGCAction string

const (
	FileGCDeleted      FileGCAction = "deleted"
	FileGCWouldDelete  FileGCAction = "would_delete"
	FileGCEnqueued     FileGCAction = "enqueued"
	FileGCWouldEnqueue FileGCAction = "would_enqueue"
	// FileGCHeld: a reference, a hold or an open claim window keeps the file.
	FileGCHeld FileGCAction = "held"
	// FileGCRetry: the job waits for a later sweep (not yet due, or failed).
	FileGCRetry FileGCAction = "retry"
	// FileGCQuarantined: the data is inconsistent (cross-tenant reference,
	// unmanaged or shared locator, unconfirmed writer); kept and alerted.
	FileGCQuarantined FileGCAction = "quarantined"
	// FileGCAborted: a provider error or missing provider stopped the batch.
	FileGCAborted FileGCAction = "aborted"
	// FileGCDone: the job had nothing left to do.
	FileGCDone FileGCAction = "done"
	// FileGCConfirmed: reconcile found a late provider output and finished it.
	FileGCConfirmed FileGCAction = "confirmed"
)

// FileGCEntry is one line of the report.
type FileGCEntry struct {
	FileID    files.FileID
	JobID     string
	Operation string
	Action    FileGCAction
	Reason    string
}

// FileGCReport is one sweep: in dry-run the list of what would happen, in
// destructive mode what did. It carries ids and reasons only - never keys,
// URLs or file names.
type FileGCReport struct {
	Mode       FileGCMode
	StartedAt  time.Time
	FinishedAt time.Time
	// Skipped is why nothing ran: "disabled" or "run_lease_held".
	Skipped string
	// Coverage is the reference registry gap that kept every cleanup job
	// untouched, or empty when every column has its provider.
	Coverage          string
	LeasesReleased    int64
	SessionsExpired   int
	SpoolFilesRemoved int
	Entries           []FileGCEntry

	mu sync.Mutex
}

// Count returns how many entries took action a.
func (r *FileGCReport) Count(a FileGCAction) int {
	n := 0
	for _, e := range r.Entries {
		if e.Action == a {
			n++
		}
	}
	return n
}

func (r *FileGCReport) add(e FileGCEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Entries = append(r.Entries, e)
}

// SweepFiles runs one collector pass now. The daily worker calls it on the
// schedule; an operator tool or a test may call it directly. Only one replica
// runs at a time: the others answer Skipped "run_lease_held".
func (s *FileService) SweepFiles(ctx context.Context) (*FileGCReport, error) {
	rep := &FileGCReport{Mode: s.gc.Mode, StartedAt: s.now()}
	defer func() { rep.FinishedAt = s.now() }()
	if s.gc.Mode == FileGCOff {
		rep.Skipped = "disabled"
		return rep, nil
	}
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return rep, fmt.Errorf("files: gc connection: %w", err)
	}
	defer conn.Release()
	lockQ := db.New(conn)
	locked, err := lockQ.FileGCTryRunLock(ctx, fileGCRunLockKey)
	if err != nil {
		return rep, fmt.Errorf("files: gc run lease: %w", err)
	}
	if !locked {
		rep.Skipped = "run_lease_held"
		return rep, nil
	}
	defer func() {
		if _, err := lockQ.FileGCRunUnlock(context.WithoutCancel(ctx), fileGCRunLockKey); err != nil {
			slog.Warn("files gc: release run lease", "err", err)
		}
	}()

	run := &fileGCRun{svc: s, rep: rep, owner: "gc:" + s.newID(), destructive: s.gc.Mode == FileGCDestructive}
	if err := s.refs.coverage(s.registry); err != nil {
		rep.Coverage = err.Error()
		slog.Warn("files gc: reference coverage gap, cleanup jobs left untouched", "err", err)
	}
	if rep.Coverage == "" {
		// Legacy consumers mint their own keys and never start naming a
		// managed one, so one snapshot per sweep is as good as a check per
		// batch - and scans those tables once a day instead of per batch.
		legacy, err := s.q.FileGCLegacyManagedLocators(ctx)
		if err != nil {
			rep.Coverage = "legacy locator snapshot failed: " + err.Error()
			slog.Warn("files gc: legacy locator snapshot failed, cleanup jobs left untouched", "err", err)
		}
		run.legacy = legacy
	}
	if err := run.prepare(ctx); err != nil {
		return rep, err
	}
	if err := run.discover(ctx); err != nil {
		return rep, err
	}
	if err := run.drain(ctx); err != nil {
		return rep, err
	}
	run.sweepSpool()
	slog.Info("files gc: sweep finished", "mode", string(rep.Mode),
		"deleted", rep.Count(FileGCDeleted), "would_delete", rep.Count(FileGCWouldDelete),
		"held", rep.Count(FileGCHeld), "retry", rep.Count(FileGCRetry),
		"quarantined", rep.Count(FileGCQuarantined), "aborted", rep.Count(FileGCAborted))
	return rep, nil
}

// fileGCRun is the state of one sweep.
type fileGCRun struct {
	svc         *FileService
	rep         *FileGCReport
	owner       string
	destructive bool
	jobs        int
	stopped     bool
	// legacy is this sweep's snapshot of pre-FileService locators that look
	// like managed keys (normally empty).
	legacy []string
}

// prepare recovers crashed leases and closes claim windows that have passed,
// queueing their files. Dry-run skips both writes.
func (r *fileGCRun) prepare(ctx context.Context) error {
	if !r.destructive {
		return nil
	}
	s := r.svc
	now := s.now()
	n, err := s.q.ReleaseExpiredFileJobLeases(ctx, fileTime(now))
	if err != nil {
		return fmt.Errorf("files: gc release leases: %w", err)
	}
	r.rep.LeasesReleased = n
	return s.inTx(ctx, func(q *db.Queries) error {
		expired, err := q.ExpireUploadSessions(ctx, fileTime(now))
		if err != nil {
			return fmt.Errorf("files: gc expire sessions: %w", err)
		}
		r.rep.SessionsExpired = len(expired)
		for _, sess := range expired {
			file, err := q.GetFileByID(ctx, sess.FileID)
			if err != nil {
				return fmt.Errorf("files: gc expired file: %w", err)
			}
			if err := s.enqueueJob(ctx, q, file, fileJobCleanup, now); err != nil {
				return err
			}
		}
		return nil
	})
}

// discover finds ready files past the age cutoff that no provider holds and
// no live cleanup job covers - a reference that went away without a release -
// and queues them. The queued job re-checks everything under lock.
func (r *fileGCRun) discover(ctx context.Context) error {
	s := r.svc
	now := s.now()
	after, scanned := "", 0
	for scanned < s.gc.MaxScanPerRun {
		page, err := s.q.FileGCListUnjobbedCandidates(ctx, db.FileGCListUnjobbedCandidatesParams{
			ReadyBefore: fileTime(now.Add(-fileGCAge)), AfterID: after, LimitN: int32(s.gc.BatchSize),
		})
		if err != nil {
			return fmt.Errorf("files: gc scan: %w", err)
		}
		if len(page) == 0 {
			return nil
		}
		scanned += len(page)
		after = page[len(page)-1].ID
		ids := make([]files.FileID, 0, len(page))
		for _, f := range page {
			ids = append(ids, files.FileID(f.ID))
		}
		held, err := s.refs.heldBy(ctx, s.q, ids)
		if err != nil {
			// Fail closed: nothing from this page is queued.
			slog.Warn("files gc: scan provider error", "err", err)
			for _, f := range page {
				r.rep.add(FileGCEntry{FileID: files.FileID(f.ID), Operation: fileJobCleanup, Action: FileGCAborted, Reason: "provider_error"})
			}
			continue
		}
		for _, f := range page {
			if _, ok := held[files.FileID(f.ID)]; ok {
				continue
			}
			if !r.destructive {
				r.rep.add(FileGCEntry{FileID: files.FileID(f.ID), Operation: fileJobCleanup, Action: FileGCWouldEnqueue, Reason: "unreferenced"})
				continue
			}
			if err := s.enqueueJob(ctx, s.q, f, fileJobCleanup, now); err != nil {
				return err
			}
			r.rep.add(FileGCEntry{FileID: files.FileID(f.ID), Operation: fileJobCleanup, Action: FileGCEnqueued, Reason: "unreferenced"})
		}
	}
	return nil
}

// drain processes due jobs in bounded batches until none is due or the run
// budget is spent. Cleanup jobs are left untouched while the registry has a
// coverage gap.
func (r *fileGCRun) drain(ctx context.Context) error {
	ops := []string{fileJobReconcile, "abort_multipart"}
	if r.rep.Coverage == "" {
		ops = append(ops, fileJobCleanup)
	}
	if !r.destructive {
		return r.drainDry(ctx, ops)
	}
	s := r.svc
	for r.jobs < s.gc.MaxJobsPerRun && !r.stopped {
		now := s.now()
		limit := min(s.gc.BatchSize, s.gc.MaxJobsPerRun-r.jobs)
		jobs, err := s.q.FileGCClaimJobs(ctx, db.FileGCClaimJobsParams{
			LeaseOwner: fileText(r.owner), LeaseExpiresAt: fileTime(now.Add(s.gc.JobLease)),
			Operations: ops, Now: fileTime(now), LimitN: int32(limit),
		})
		if err != nil {
			return fmt.Errorf("files: gc claim jobs: %w", err)
		}
		if len(jobs) == 0 {
			return nil
		}
		r.jobs += len(jobs)
		var cleanup, other []db.FileJob
		for _, j := range jobs {
			if j.Operation == fileJobCleanup {
				cleanup = append(cleanup, j)
			} else {
				other = append(other, j)
			}
		}
		if len(cleanup) > 0 {
			if err := r.cleanupBatch(ctx, cleanup); err != nil {
				return err
			}
		}
		r.parallel(other, func(j db.FileJob) { r.reconcileJob(ctx, j) })
	}
	return nil
}

// drainDry pages through due jobs without leasing them and reports what a
// destructive sweep would decide.
func (r *fileGCRun) drainDry(ctx context.Context, ops []string) error {
	s := r.svc
	after := ""
	for r.jobs < s.gc.MaxJobsPerRun {
		jobs, err := s.q.FileGCListDueJobs(ctx, db.FileGCListDueJobsParams{
			Operations: ops, Now: fileTime(s.now()), AfterID: after, LimitN: int32(s.gc.BatchSize),
		})
		if err != nil {
			return fmt.Errorf("files: gc list jobs: %w", err)
		}
		if len(jobs) == 0 {
			return nil
		}
		r.jobs += len(jobs)
		after = jobs[len(jobs)-1].ID
		var cleanup, other []db.FileJob
		for _, j := range jobs {
			if j.Operation == fileJobCleanup {
				cleanup = append(cleanup, j)
			} else {
				other = append(other, j)
			}
		}
		if len(cleanup) > 0 {
			cands, err := loadGCCandidates(ctx, s.q, cleanup, false)
			if err != nil {
				return err
			}
			verdicts, err := s.judgeCleanup(ctx, s.q, cands, r.legacy)
			if err != nil {
				slog.Warn("files gc: dry-run batch aborted", "err", err)
				for _, c := range cands {
					r.rep.add(FileGCEntry{FileID: files.FileID(c.job.FileID), JobID: c.job.ID, Operation: fileJobCleanup, Action: FileGCAborted, Reason: abortReason(err)})
				}
			} else {
				for i, v := range verdicts {
					a := v.action
					if a == FileGCDeleted {
						a = FileGCWouldDelete
					}
					r.rep.add(FileGCEntry{FileID: files.FileID(cands[i].job.FileID), JobID: cands[i].job.ID, Operation: fileJobCleanup, Action: a, Reason: v.reason})
				}
			}
		}
		r.parallel(other, func(j db.FileJob) { r.reconcileJob(ctx, j) })
	}
	return nil
}

// parallel runs fn over jobs with at most Concurrency in flight.
func (r *fileGCRun) parallel(jobs []db.FileJob, fn func(db.FileJob)) {
	sem := make(chan struct{}, r.svc.gc.Concurrency)
	var wg sync.WaitGroup
	for _, j := range jobs {
		wg.Add(1)
		sem <- struct{}{}
		go func(j db.FileJob) {
			defer wg.Done()
			defer func() { <-sem }()
			fn(j)
		}(j)
	}
	wg.Wait()
}

// gcCandidate is a cleanup job with the rows it points at.
type gcCandidate struct {
	job    db.FileJob
	file   db.File
	fileOK bool
	sess   db.FileUploadSession
	sessOK bool
}

// loadGCCandidates reads (lock=false) or locks (lock=true, lock-contract
// order: files by id, then sessions, then jobs) the rows behind jobs.
func loadGCCandidates(ctx context.Context, q *db.Queries, jobs []db.FileJob, lock bool) ([]gcCandidate, error) {
	ids := make([]string, 0, len(jobs))
	jobIDs := make([]string, 0, len(jobs))
	for _, j := range jobs {
		ids = append(ids, j.FileID)
		jobIDs = append(jobIDs, j.ID)
	}
	sort.Strings(ids)
	sort.Strings(jobIDs)
	var (
		fileRows []db.File
		sessRows []db.FileUploadSession
		err      error
	)
	if lock {
		if fileRows, err = q.LockFilesInIDOrder(ctx, ids); err != nil {
			return nil, fmt.Errorf("files: gc lock files: %w", err)
		}
		if sessRows, err = q.LockUploadSessionsByFileIDs(ctx, ids); err != nil {
			return nil, fmt.Errorf("files: gc lock sessions: %w", err)
		}
		locked, err := q.LockFileJobsInIDOrder(ctx, jobIDs)
		if err != nil {
			return nil, fmt.Errorf("files: gc lock jobs: %w", err)
		}
		// The locked rows are the truth: a job whose lease moved on since
		// the claim is dropped below by the fence check.
		byID := make(map[string]db.FileJob, len(locked))
		for _, j := range locked {
			byID[j.ID] = j
		}
		fenced := jobs[:0:0]
		for _, j := range jobs {
			cur, ok := byID[j.ID]
			if ok && cur.Status == "leased" && cur.Generation == j.Generation && cur.LeaseOwner == j.LeaseOwner {
				fenced = append(fenced, cur)
			}
		}
		jobs = fenced
	} else {
		if fileRows, err = q.FileGCListFilesByIDs(ctx, ids); err != nil {
			return nil, fmt.Errorf("files: gc read files: %w", err)
		}
		if sessRows, err = q.FileGCListSessionsByFileIDs(ctx, ids); err != nil {
			return nil, fmt.Errorf("files: gc read sessions: %w", err)
		}
	}
	fileByID := make(map[string]db.File, len(fileRows))
	for _, f := range fileRows {
		fileByID[f.ID] = f
	}
	sessByFile := make(map[string]db.FileUploadSession, len(sessRows))
	for _, sess := range sessRows {
		sessByFile[sess.FileID] = sess
	}
	out := make([]gcCandidate, 0, len(jobs))
	for _, j := range jobs {
		c := gcCandidate{job: j}
		c.file, c.fileOK = fileByID[j.FileID]
		c.sess, c.sessOK = sessByFile[j.FileID]
		out = append(out, c)
	}
	return out, nil
}

// gcVerdict is the decision for one cleanup candidate. FileGCDeleted means
// "free: take it"; resume marks a file already past the barrier.
type gcVerdict struct {
	action  FileGCAction
	reason  string
	retryAt time.Time
	resume  bool
}

// errGCBatchAborted wraps what stopped a batch: a provider error or a
// purpose with no provider. The caller keeps every file of the batch.
var errGCBatchAborted = errors.New("files: gc batch aborted")

func abortReason(err error) string {
	if errors.Is(err, errFileReferenceCoverage) {
		return "missing_provider"
	}
	return "provider_error"
}

// judgeCleanup decides every candidate of one batch. It is the same function
// for the dry run (unlocked reads) and the destructive batch (after the
// locks). Any provider or query error aborts the whole batch. legacy is the
// sweep's snapshot of legacy locators naming managed keys.
func (s *FileService) judgeCleanup(ctx context.Context, q *db.Queries, cands []gcCandidate, legacy []string) ([]gcVerdict, error) {
	now := s.now()
	out := make([]gcVerdict, len(cands))
	var check []files.FileID
	for i, c := range cands {
		v, needsRefs := s.gateCleanup(c, now)
		out[i] = v
		if needsRefs {
			if c.sessOK && !s.refs.covers(files.UploadPurpose(c.sess.Purpose)) {
				return nil, fmt.Errorf("%w: %w: purpose %s", errGCBatchAborted, errFileReferenceCoverage, c.sess.Purpose)
			}
			check = append(check, files.FileID(c.file.ID))
		}
	}
	if len(check) == 0 {
		return out, nil
	}
	tenants, err := s.refs.referenceTenants(ctx, q, check)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errGCBatchAborted, err)
	}
	held, err := s.refs.heldBy(ctx, q, check)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errGCBatchAborted, err)
	}
	for i, c := range cands {
		if out[i].action != FileGCDeleted || out[i].resume {
			continue
		}
		id := files.FileID(c.file.ID)
		if namedByLegacyLocator(c.file.ObjectKey, legacy) {
			out[i] = s.quarantine(c, "legacy_locator_shared", now)
			continue
		}
		if ref, bad := crossTenant(c.file, tenants[id]); bad {
			slog.Warn("files gc: cross-tenant reference, file quarantined",
				"file", c.file.ID, "source", ref.Source.Table+"."+ref.Source.Column)
			out[i] = s.quarantine(c, "cross_tenant_reference", now)
			continue
		}
		if h, ok := held[id]; ok {
			out[i] = gcVerdict{action: FileGCHeld, reason: "held:" + h.Provider + ":" + string(h.Reason)}
		}
	}
	return out, nil
}

// namedByLegacyLocator reports whether a legacy locator is the key itself or
// a URL ending in it.
func namedByLegacyLocator(key string, legacy []string) bool {
	for _, loc := range legacy {
		if strings.HasSuffix(loc, key) {
			return true
		}
	}
	return false
}

// gateCleanup applies the checks that need no provider: file state, locator,
// tenant of file/session/job, the session grant and the age. needsRefs is
// true when only the reference checks stand between the file and deletion.
func (s *FileService) gateCleanup(c gcCandidate, now time.Time) (gcVerdict, bool) {
	if !c.fileOK {
		return gcVerdict{action: FileGCDone, reason: "file_missing"}, false
	}
	switch files.Status(c.file.Status) {
	case files.StatusDeleted:
		// A cleanup job on a tombstone is a late-write check: the upload
		// pipeline queues one when a stale writer gives up after the file
		// was collected, and cancels the reconcile job that would otherwise
		// have looked. Only a managed key is checked.
		if ok, _ := s.managedLocator(c.file, c.sess, c.sessOK); ok {
			return gcVerdict{action: FileGCDeleted, reason: "tombstone_recheck", resume: true}, false
		}
		return gcVerdict{action: FileGCDone, reason: "already_deleted"}, false
	case files.StatusPending, files.StatusProcessing:
		// A writer may still be writing; reconcile owns the intent. An
		// expired lease is not proof the writer stopped (spec 9.4).
		return gcVerdict{action: FileGCRetry, reason: "writer_active", retryAt: s.writerRetry(c, now)}, false
	}
	if ok, why := s.managedLocator(c.file, c.sess, c.sessOK); !ok {
		return s.quarantine(c, why, now), false
	}
	if c.sessOK && c.sess.OrganizationID != c.file.OrganizationID {
		return s.quarantine(c, "tenant_mismatch_session", now), false
	}
	if c.job.OrganizationID != c.file.OrganizationID {
		return s.quarantine(c, "tenant_mismatch_job", now), false
	}
	if files.Status(c.file.Status) == files.StatusDeleting {
		// Past the barrier already (a crash between the barrier and the
		// object delete): finish the delete, no reference can be added.
		return gcVerdict{action: FileGCDeleted, reason: "resume_deleting", resume: true}, false
	}
	// A failed attempt never became ready: no claim can reach it, and its
	// finalize cannot resurrect it (MarkFileReady only moves an open file),
	// so only a ready file answers to its session and its age.
	if files.Status(c.file.Status) == files.StatusReady {
		if c.sessOK {
			switch files.SessionStatus(c.sess.Status) {
			case files.SessionReceiving:
				return s.quarantine(c, "session_state_mismatch", now), false
			case files.SessionStaged:
				if c.sess.ClaimExpiresAt.Valid && now.Before(c.sess.ClaimExpiresAt.Time) {
					return gcVerdict{action: FileGCRetry, reason: "claim_window_open", retryAt: c.sess.ClaimExpiresAt.Time}, false
				}
			}
		}
		// T1-Q5/T1-Q6: the age runs from ready_at only; cancel, claim and
		// release never move it.
		if !c.file.ReadyAt.Valid {
			return s.quarantine(c, "ready_without_ready_at", now), false
		}
		if due := c.file.ReadyAt.Time.Add(fileGCAge); now.Before(due) {
			return gcVerdict{action: FileGCRetry, reason: "too_young", retryAt: due}, false
		}
	}
	return gcVerdict{action: FileGCDeleted, reason: "unreferenced"}, true
}

// writerRetry is when a job blocked by a writer is looked at again: when the
// write lease ends, or the next day.
func (s *FileService) writerRetry(c gcCandidate, now time.Time) time.Time {
	if c.sessOK && c.sess.LeaseExpiresAt.Valid && c.sess.LeaseExpiresAt.Time.After(now) {
		return c.sess.LeaseExpiresAt.Time
	}
	return s.retryBackoff(c.job, now)
}

// quarantine keeps the file and its job: the job goes back to pending with a
// backoff and a code an operator (and the alert on job age) can see.
func (s *FileService) quarantine(c gcCandidate, reason string, now time.Time) gcVerdict {
	return gcVerdict{action: FileGCQuarantined, reason: reason, retryAt: s.retryBackoff(c.job, now)}
}

// retryBackoff is the next attempt of a failed or quarantined job: the next
// schedule slot, then 2, 4 and at most 8 days - always on a daily sweep, never
// a tighter loop, and never dropped (spec 9.4).
func (s *FileService) retryBackoff(job db.FileJob, now time.Time) time.Time {
	days := 1 << min(int(job.Attempt), 3)
	return s.gc.nextRun(now).AddDate(0, 0, days-1)
}

// managedLocator is the allowlist (plan T5): only an object FileService
// minted for this very row may be deleted - the configured storage and
// bucket, a v1 key under the row's tenant (and the session's purpose prefix
// when the session is known) that ends in the row's own id. Legacy, G0,
// shared or unknown objects never match and are held.
func (s *FileService) managedLocator(file db.File, sess db.FileUploadSession, sessOK bool) (bool, string) {
	if storage.Backend(file.Storage) != s.backend || file.Bucket.String != s.bucket {
		return false, "foreign_storage"
	}
	key := file.ObjectKey
	base := "v1/users/"
	if file.OrganizationID.Valid {
		base = "v1/orgs/" + file.OrganizationID.String + "/"
	}
	if !strings.HasPrefix(key, base) || !strings.Contains(key, "/"+file.ID+"/original") {
		return false, "unmanaged_locator"
	}
	if !sessOK {
		return true, ""
	}
	var spec files.PurposeSpec
	found := false
	for _, sp := range s.registry.Specs() {
		if string(sp.Purpose) == sess.Purpose {
			spec, found = sp, true
			break
		}
	}
	if !found {
		return false, "unmanaged_locator"
	}
	scope := sessionScope(sess)
	prefix := "v1/users/" + scope.UserID + "/"
	switch {
	case scope.OrganizationID != "" && scope.WorkspaceID != "":
		prefix = "v1/orgs/" + scope.OrganizationID + "/workspaces/" + scope.WorkspaceID + "/"
	case scope.OrganizationID != "":
		prefix = "v1/orgs/" + scope.OrganizationID + "/"
	}
	prefix += spec.Prefix + "/"
	if !strings.HasPrefix(key, prefix) || !strings.HasSuffix(key, "/"+file.ID+"/original"+spec.Policy.ObjectKeySuffix) {
		return false, "unmanaged_locator"
	}
	return true, ""
}

// cleanupBatch is the destructive batch: phase 1 in one transaction, then
// the object deletes, then the tombstones.
func (r *fileGCRun) cleanupBatch(ctx context.Context, jobs []db.FileJob) error {
	s := r.svc
	var (
		cands    []gcCandidate
		verdicts []gcVerdict
		aborted  error
	)
	if s.gcHooks.beforeBatchLock != nil {
		s.gcHooks.beforeBatchLock()
	}
	err := s.inTx(ctx, func(q *db.Queries) error {
		var err error
		if cands, err = loadGCCandidates(ctx, q, jobs, true); err != nil {
			return err
		}
		if s.gcHooks.batchLocked != nil {
			ids := make([]files.FileID, 0, len(cands))
			for _, c := range cands {
				ids = append(ids, files.FileID(c.job.FileID))
			}
			s.gcHooks.batchLocked(ids)
		}
		if verdicts, err = s.judgeCleanup(ctx, q, cands, r.legacy); err != nil {
			if errors.Is(err, errGCBatchAborted) {
				aborted = err
			}
			return err
		}
		now := s.now()
		for i, c := range cands {
			v := &verdicts[i]
			switch v.action {
			case FileGCDeleted:
				if v.resume {
					continue
				}
				n, err := q.MarkFileDeleting(ctx, c.file.ID)
				if err != nil {
					return fmt.Errorf("files: gc mark deleting: %w", err)
				}
				if n == 0 {
					*v = gcVerdict{action: FileGCRetry, reason: "state_changed", retryAt: s.retryBackoff(c.job, now)}
					if err := retryJob(ctx, q, c.job, v.retryAt, v.reason); err != nil {
						return err
					}
				}
			case FileGCHeld, FileGCDone:
				if err := completeJob(ctx, q, c.job, now); err != nil {
					return err
				}
			default:
				if err := retryJob(ctx, q, c.job, v.retryAt, v.reason); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if aborted != nil {
		slog.Warn("files gc: batch aborted, every file kept", "jobs", len(jobs), "err", aborted)
		now := s.now()
		reason := abortReason(aborted)
		for _, j := range jobs {
			if err := s.inTx(ctx, func(q *db.Queries) error {
				return retryJob(ctx, q, j, s.retryBackoff(j, now), reason)
			}); err != nil {
				return err
			}
			r.rep.add(FileGCEntry{FileID: files.FileID(j.FileID), JobID: j.ID, Operation: fileJobCleanup, Action: FileGCAborted, Reason: reason})
		}
		return nil
	}
	if err != nil {
		return err
	}
	var deleting []gcCandidate
	reasons := map[string]string{}
	for i, c := range cands {
		v := verdicts[i]
		if v.action == FileGCDeleted {
			deleting = append(deleting, c)
			reasons[c.job.ID] = v.reason
			continue
		}
		r.rep.add(FileGCEntry{FileID: files.FileID(c.job.FileID), JobID: c.job.ID, Operation: fileJobCleanup, Action: v.action, Reason: v.reason})
	}
	for _, c := range deleting {
		if s.gcHooks.deletingCommitted != nil && !s.gcHooks.deletingCommitted(files.FileID(c.file.ID)) {
			r.stopped = true
			return nil
		}
	}
	byJob := make(map[string]gcCandidate, len(deleting))
	pending := make([]db.FileJob, 0, len(deleting))
	for _, c := range deleting {
		byJob[c.job.ID] = c
		pending = append(pending, c.job)
	}
	r.parallel(pending, func(j db.FileJob) { r.finishDelete(ctx, byJob[j.ID], reasons[j.ID]) })
	return nil
}

// finishDelete removes the object of a file past the barrier and writes the
// tombstone. Any failure keeps the file deleting and the job pending.
func (r *fileGCRun) finishDelete(ctx context.Context, c gcCandidate, reason string) {
	s := r.svc
	id := files.FileID(c.file.ID)
	if err := s.removeObject(ctx, c.file); err != nil {
		code := gcStorageCode(err)
		slog.Warn("files gc: object delete failed, file kept deleting", "file", c.file.ID, "code", code, "err", err)
		now := s.now()
		if txErr := s.inTx(ctx, func(q *db.Queries) error {
			return retryJob(ctx, q, c.job, s.retryBackoff(c.job, now), code)
		}); txErr != nil {
			slog.Warn("files gc: record delete failure", "file", c.file.ID, "err", txErr)
		}
		r.rep.add(FileGCEntry{FileID: id, JobID: c.job.ID, Operation: fileJobCleanup, Action: FileGCRetry, Reason: code})
		return
	}
	err := s.inTx(ctx, func(q *db.Queries) error {
		now := s.now()
		if _, err := q.LockFilesInIDOrder(ctx, []string{c.file.ID}); err != nil {
			return fmt.Errorf("files: gc lock file: %w", err)
		}
		if _, err := q.MarkFileDeleted(ctx, db.MarkFileDeletedParams{ID: c.file.ID, DeletedAt: fileTime(now)}); err != nil {
			return fmt.Errorf("files: gc tombstone: %w", err)
		}
		n, err := q.CompleteFileJob(ctx, db.CompleteFileJobParams{
			ID: c.job.ID, FinishedAt: fileTime(now), Generation: c.job.Generation, LeaseOwner: c.job.LeaseOwner,
		})
		if err != nil {
			return fmt.Errorf("files: gc complete job: %w", err)
		}
		if n == 0 {
			// Another sweep retook the lease; it owns the outcome, and the
			// tombstone above is the same one it would write.
			return nil
		}
		if !c.file.ReadyAt.Valid && files.Status(c.file.Status) != files.StatusDeleted {
			// An attempt that never became ready may still have a writer
			// in flight: look at the tombstone's key again tomorrow.
			return s.enqueueJob(ctx, q, c.file, fileJobReconcile, s.gc.nextRun(now))
		}
		return nil
	})
	if err != nil {
		slog.Warn("files gc: tombstone not written, retried next sweep", "file", c.file.ID, "err", err)
		r.rep.add(FileGCEntry{FileID: id, JobID: c.job.ID, Operation: fileJobCleanup, Action: FileGCRetry, Reason: "tombstone_failed"})
		return
	}
	r.rep.add(FileGCEntry{FileID: id, JobID: c.job.ID, Operation: fileJobCleanup, Action: FileGCDeleted, Reason: reason})
}

var (
	errGCNoAdapter       = errors.New("files: gc has no adapter for this locator")
	errGCUnversioned     = errors.New("files: gc refuses an unversioned delete on a versioned bucket")
	errGCObjectRemaining = errors.New("files: object still present after delete")
)

// removeObject deletes exactly the recorded object and proves it is gone. A
// nil Delete is not the proof (a versioned bucket may only plant a delete
// marker, a hold may refuse silently): the Stat afterwards must answer not
// found for the same locator and version.
func (s *FileService) removeObject(ctx context.Context, file db.File) error {
	loc := locator(file)
	if loc.Storage != s.backend || loc.Bucket != s.bucket {
		// Never dispatch a delete to the default adapter for another
		// backend's object (spec 9.4).
		return errGCNoAdapter
	}
	if s.store.Capabilities().VersionedObjects && loc.Version == "" {
		return errGCUnversioned
	}
	if err := s.store.Delete(ctx, loc); err != nil {
		return err
	}
	_, err := s.store.Stat(ctx, loc)
	switch {
	case errors.Is(err, storage.ErrNotFound):
		return nil
	case err == nil:
		return errGCObjectRemaining
	default:
		return err
	}
}

// gcStorageCode is the error_code a failed delete leaves on its job.
func gcStorageCode(err error) string {
	switch {
	case errors.Is(err, errGCNoAdapter):
		return "storage_adapter_missing"
	case errors.Is(err, errGCUnversioned), errors.Is(err, storage.ErrCapabilityUnsupported):
		return "storage_version_required"
	case errors.Is(err, errGCObjectRemaining):
		return "object_still_present"
	case errors.Is(err, storage.ErrLocatorInvalid):
		return "storage_locator_invalid"
	default:
		return files.CodeStorageUnavailable
	}
}

func retryJob(ctx context.Context, q *db.Queries, job db.FileJob, at time.Time, code string) error {
	if _, err := q.RetryFileJob(ctx, db.RetryFileJobParams{
		ID: job.ID, NextAttemptAt: fileTime(at), ErrorCode: fileText(code),
		Generation: job.Generation, LeaseOwner: job.LeaseOwner,
	}); err != nil {
		return fmt.Errorf("files: gc retry job: %w", err)
	}
	return nil
}

func completeJob(ctx context.Context, q *db.Queries, job db.FileJob, at time.Time) error {
	if _, err := q.CompleteFileJob(ctx, db.CompleteFileJobParams{
		ID: job.ID, FinishedAt: fileTime(at), Generation: job.Generation, LeaseOwner: job.LeaseOwner,
	}); err != nil {
		return fmt.Errorf("files: gc complete job: %w", err)
	}
	return nil
}

// sweepSpool removes upload spool files a crashed process left behind. A
// live upload never keeps its spool for a day. Dry-run only counts them.
func (r *fileGCRun) sweepSpool() {
	dir := r.svc.spoolDir
	if dir == "" {
		dir = os.TempDir()
	}
	matches, err := filepath.Glob(filepath.Join(dir, "uniwork-upload-*"))
	if err != nil {
		return
	}
	cutoff := r.svc.now().Add(-fileGCAge)
	for _, path := range matches {
		info, err := os.Stat(path)
		if err != nil || info.IsDir() || !info.ModTime().Before(cutoff) {
			continue
		}
		if r.destructive {
			if err := os.Remove(path); err != nil {
				continue
			}
		}
		r.rep.SpoolFilesRemoved++
	}
}

// FileGCWorker runs SweepFiles once a day on the configured schedule until
// its context ends. It belongs in the server's shutdown sequence
// (cmd/server/main.go), not a bare goroutine.
type FileGCWorker struct {
	svc *FileService
	// after replaces the timer (tests); nil uses a real timer that is
	// stopped at shutdown.
	after func(time.Duration) <-chan time.Time
	// swept observes every finished sweep (tests).
	swept func(*FileGCReport, error)
}

// NewFileGCWorker builds the daily worker for this service.
func (s *FileService) NewFileGCWorker() *FileGCWorker {
	return &FileGCWorker{svc: s}
}

// Run blocks until ctx ends, sweeping once per schedule slot. With the
// collector off it returns at once.
func (w *FileGCWorker) Run(ctx context.Context) {
	if w.svc.gc.Mode == FileGCOff {
		return
	}
	for {
		now := w.svc.now()
		if !w.wait(ctx, w.svc.gc.nextRun(now).Sub(now)) {
			return
		}
		if ctx.Err() != nil {
			// Shutdown raced the timer: never start a sweep on a closing
			// server.
			return
		}
		rep, err := w.svc.SweepFiles(ctx)
		if err != nil && ctx.Err() == nil {
			slog.Warn("files gc: sweep failed, next slot retries", "err", err)
		}
		if w.swept != nil {
			w.swept(rep, err)
		}
	}
}

// wait sleeps d or until ctx ends; false means ctx ended.
func (w *FileGCWorker) wait(ctx context.Context, d time.Duration) bool {
	if w.after != nil {
		select {
		case <-ctx.Done():
			return false
		case <-w.after(d):
			return true
		}
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
