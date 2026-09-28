package service

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document maintenance workers (C-01 §6.3, G1-04b, UNI-678). Three sweeps
// share one worker so cmd/server joins one channel in the shutdown
// sequence:
//
//   - auto-version: every 60 s, snapshot pages whose last save has been
//     quiet for 10 minutes. Idempotent by construction: the scan predicate
//     (content_saved_at > last_version_at) becomes false the moment a
//     snapshot covers the save, so a retry never writes the same version
//     twice. now is injected in tests.
//   - purge: hourly, PurgeExpired - archived documents past 30 days and
//     orphaned assets past 7.
//   - compaction: daily, CompactVersions.
//
// No bare goroutines: Run fans out to three loops and blocks until all
// three return after ctx ends; every sweep's own per-row transaction bounds
// what a shutdown interrupts (an in-flight row rolls back, the sweep picks
// it up next time).

const (
	documentAutoVersionQuiet = 10 * time.Minute
	documentAutoVersionTick  = time.Minute
	documentPurgeTick        = time.Hour
	documentCompactTick      = 24 * time.Hour
)

// DocumentWorkers is the one worker cmd/server starts for documents.
// Intervals are fields so tests can shrink them; after replaces the timers
// the loops wait on.
type DocumentWorkers struct {
	svc *DocumentService
	// AutoVersionTick, PurgeTick, CompactTick override the sweep cadences;
	// zero keeps the defaults above.
	AutoVersionTick time.Duration
	PurgeTick       time.Duration
	CompactTick     time.Duration

	// after replaces the timer (tests); nil uses a real timer.
	after func(time.Duration) <-chan time.Time
	// swept observes every finished pass (tests): "auto_version" | "purge" |
	// "compact" and its error.
	swept func(kind string, err error)
	// now is the sweep clock (tests); nil uses the service clock.
	now func() time.Time
}

// NewDocumentWorkers builds the maintenance worker for this service.
func (s *DocumentService) NewDocumentWorkers() *DocumentWorkers {
	return &DocumentWorkers{svc: s}
}

// Run blocks until ctx ends, running each sweep on its own cadence. A first
// pass of each sweep runs immediately so a fresh deploy does not sit a full
// tick behind.
func (w *DocumentWorkers) Run(ctx context.Context) {
	autoTick, purgeTick, compactTick := w.AutoVersionTick, w.PurgeTick, w.CompactTick
	if autoTick <= 0 {
		autoTick = documentAutoVersionTick
	}
	if purgeTick <= 0 {
		purgeTick = documentPurgeTick
	}
	if compactTick <= 0 {
		compactTick = documentCompactTick
	}
	var wg sync.WaitGroup
	for _, loop := range []struct {
		tick time.Duration
		run  func(context.Context)
	}{
		{autoTick, func(ctx context.Context) {
			err := w.autoVersionPass(ctx)
			if w.swept != nil {
				w.swept("auto_version", err)
			}
		}},
		{purgeTick, func(ctx context.Context) {
			_, err := w.svc.PurgeExpired(ctx, w.clock()())
			if w.swept != nil {
				w.swept("purge", err)
			}
		}},
		{compactTick, func(ctx context.Context) {
			_, err := w.svc.CompactVersions(ctx)
			if w.swept != nil {
				w.swept("compact", err)
			}
		}},
	} {
		wg.Add(1)
		go func(tick time.Duration, run func(context.Context)) {
			defer wg.Done()
			for {
				if ctx.Err() != nil {
					return
				}
				run(ctx)
				if !w.wait(ctx, tick) {
					return
				}
			}
		}(loop.tick, loop.run)
	}
	wg.Wait()
}

func (w *DocumentWorkers) clock() func() time.Time {
	if w.now != nil {
		return w.now
	}
	return w.svc.clock
}

// wait sleeps d or until ctx ends; false means ctx ended.
func (w *DocumentWorkers) wait(ctx context.Context, d time.Duration) bool {
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

// autoVersionPass snapshots every live page that has been quiet for the
// window. now comes from the injected clock in tests, the wall clock
// otherwise.
func (w *DocumentWorkers) autoVersionPass(ctx context.Context) error {
	now := w.clock()()
	quiet := now.Add(-documentAutoVersionQuiet)
	var failed int
	made := 0
	// Keyset scan: the batch remembers the ordering key of its last row, so
	// a page that fails every attempt moves the pass forward instead of
	// pinning it on the first page forever.
	var afterAt pgtype.Timestamptz
	afterID := pgtype.Text{}
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		batch, err := w.svc.q.ListDocumentsForAutoVersion(ctx, db.ListDocumentsForAutoVersionParams{
			QuietBefore: pgtype.Timestamptz{Time: quiet, Valid: true},
			AfterAt:     afterAt, AfterID: afterID,
			MaxRows: int32(documentSweepBatch),
		})
		if err != nil {
			return err
		}
		if len(batch) == 0 {
			break
		}
		for _, row := range batch {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			m, err := w.svc.autoVersionOne(ctx, row.ID, row.OrganizationID, row.WorkspaceID, now)
			if err != nil {
				failed++
				slog.Warn("documents auto-version: page failed, next tick retries", "document", row.ID, "err", err)
			} else if m {
				made++
			}
			afterAt = row.ContentSavedAt
			afterID = pgtype.Text{String: row.ID, Valid: true}
		}
		if len(batch) < documentSweepBatch {
			break
		}
	}
	if failed > 0 {
		slog.Warn("documents auto-version: pass finished with failures", "made", made, "failed", failed)
	}
	return nil
}

// autoVersionOne snapshots one page under its row lock: every predicate of
// the scan is re-evaluated there, so a save racing the tick moves the page
// to the next pass instead of producing a stale snapshot. Returns made=false
// when the re-check left nothing to do - skipped rows are not "made".
func (s *DocumentService) autoVersionOne(ctx context.Context, documentID, orgID, wsID string, now time.Time) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	doc, err := q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if doc.OrganizationID != orgID || doc.WorkspaceID != wsID {
		return false, nil
	}
	quiet := now.Add(-documentAutoVersionQuiet)
	if doc.Kind != DocumentKindPage || doc.ArchivedAt.Valid || !doc.ContentSavedAt.Valid ||
		!doc.ContentSavedAt.Time.Before(quiet) ||
		(doc.LastVersionAt.Valid && !doc.ContentSavedAt.Time.After(doc.LastVersionAt.Time)) {
		return false, nil
	}
	raw := doc.Content
	if len(raw) == 0 {
		raw = emptyPageContent
	}
	content, _, err := document.Sanitize(raw)
	if err != nil {
		return false, documentServiceError(err)
	}
	sys := audit.System("documents.autoversion")
	if err := s.consumePageBytes(ctx, q, sys, doc, int64(len(content))); err != nil {
		return false, err
	}
	v, err := q.InsertDocumentVersion(ctx, db.InsertDocumentVersionParams{
		ID:             util.NewID(),
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
		Version:        doc.CurrentVersion + 1,
		Kind:           DocumentKindPage,
		Reason:         "auto",
		Content:        content,
		SizeBytes:      int64(len(content)),
		CreatedBy:      sys.ID,
		CreatedByKind:  string(sys.Kind),
	})
	if err != nil {
		return false, err
	}
	marked, err := q.MarkDocumentAutoVersioned(ctx, db.MarkDocumentAutoVersionedParams{
		CurrentVersion:  v.Version,
		ID:              doc.ID,
		OrganizationID:  doc.OrganizationID,
		WorkspaceID:     doc.WorkspaceID,
		ExpectedVersion: doc.CurrentVersion,
		QuietBefore:     pgtype.Timestamptz{Time: quiet, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// The row moved under us after all (should not happen under the row
		// lock; guarded anyway): nothing was written.
		return false, errors.New("documents: auto-version raced a save")
	}
	if err != nil {
		return false, err
	}
	doc = marked
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          sys,
		Action:         audit.ActionDocumentVersionCreated,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes: audit.Diff(nil, map[string]any{
			"version": v.Version, "version_id": v.ID, "reason": v.Reason, "size_bytes": v.SizeBytes,
		}),
		Metadata: map[string]any{"content_saved_at": doc.ContentSavedAt.Time.Format(time.RFC3339Nano)},
	}, versionCreatedEvent(doc, v)); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
