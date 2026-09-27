package backfill

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Statter probes one object through the T2 ObjectStore of the backend the
// locator names. plan never calls it; dry-run and verify call it read-only;
// apply calls it before writing a files row so a missing object is held
// instead of minting a dangling reference.
type Statter interface {
	Stat(ctx context.Context, loc storage.ObjectLocator) (storage.ObjectInfo, error)
}

// Defaults supplies the backend coordinates a source row cannot record: the
// legacy writers stored only the key, not which STORAGE_BACKEND served at
// write time. The command passes the configured backend (+ bucket) as the
// assumption; --assume-* flags override it per deployment.
type Defaults struct {
	Storage string
	Bucket  string
}

// WriteDeps wires the mutating path. Plan needs none of it.
type WriteDeps struct {
	Pool     *pgxpool.Pool
	Stat     Statter
	Defaults Defaults
}

// WithWriteDeps attaches the write path; returns the engine for chaining.
func (e *Engine) WithWriteDeps(d WriteDeps) *Engine {
	e.pool = d.Pool
	e.stat = d.Stat
	e.defaults = d.Defaults
	return e
}

// ApplyOptions extends Options with the resume token.
type ApplyOptions struct {
	Options
	// RunID resumes an interrupted run; empty starts a new one. The run id is
	// the resume token printed by apply and accepted by --run.
	RunID string
}

// runDoneCursor marks a cohort as finished: a resume sees it and skips the
// cohort without rescanning. (No NUL bytes — Postgres TEXT rejects them.)
const runDoneCursor = "~done"

// itemStatus is what the ledger records for one source row.
const (
	itemApplied       = "applied"
	itemSkipped       = "skipped" // raced: the business row took another file_id between classify and write
	itemLocatorPrefix = "files-backfill/"
	sessionIDPrefix   = "bfs_" // deterministic: source row -> session id, so replays and re-runs idempotent
)

// Apply runs the checkpointed write path. The classification is the same code
// plan runs — including the global shared-locator pass — computed once up
// front, then written cohort by cohort in BatchSize transactions. Crash
// safety comes from the ledger: an item is processed iff it has no row in
// file_backfill_items for this run, and the ledger row commits in the same
// transaction as the files/session/file_id writes it describes.
func (e *Engine) Apply(ctx context.Context, opts ApplyOptions) (*Report, error) {
	if e.pool == nil {
		return nil, errors.New("apply needs a database pool (WithWriteDeps)")
	}
	if e.stat == nil {
		return nil, errors.New("apply needs an object prober (WithWriteDeps)")
	}
	opts.normalize()
	names, err := ResolveCohorts(opts.Cohorts)
	if err != nil {
		return nil, err
	}

	run, err := e.openRun(ctx, opts, names)
	if err != nil {
		return nil, err
	}
	done, err := e.doneSet(ctx, run.ID)
	if err != nil {
		return nil, err
	}
	cpByCohort, err := e.cohortCounters(ctx, run.ID)
	if err != nil {
		return nil, err
	}

	// One up-front classification: the shared-locator pass needs the whole
	// cohort, and the item list is the deterministic apply order.
	plan, err := e.Plan(ctx, Options{Cohorts: names, BatchSize: opts.BatchSize, IncludeItems: true})
	if err != nil {
		return nil, err
	}

	rep := &Report{Command: "apply", RunID: run.ID}
	for ci := range plan.Cohorts {
		cr := plan.Cohorts[ci]
		cp := cpByCohort[cr.Name]
		if cp == nil {
			cp = &counters{}
			cpByCohort[cr.Name] = cp
		}
		if cp.lastCursor == runDoneCursor {
			continue // cohort committed in full by an earlier pass of this run
		}
		batch := make([]Item, 0, opts.BatchSize)
		flush := func() error {
			if len(batch) == 0 {
				return nil
			}
			if err := e.applyBatch(ctx, run.ID, cr.Name, batch, cp); err != nil {
				return err
			}
			batch = batch[:0]
			return nil
		}
		for _, it := range cr.Items {
			if done[itemKey(it)] {
				// Committed by an earlier (crashed or completed) pass of this
				// run; the ledger row is the source of truth for its outcome.
				continue
			}
			it.runID = run.ID
			batch = append(batch, it)
			if int32(len(batch)) >= opts.BatchSize {
				if err := flush(); err != nil {
					return nil, fmt.Errorf("apply %s: %w", cr.Name, err)
				}
			}
		}
		if err := flush(); err != nil {
			return nil, fmt.Errorf("apply %s: %w", cr.Name, err)
		}
		// Mark the cohort done in its own tiny transaction so a crash between
		// the last batch and this write replays only the idempotent tail.
		if err := e.finishCohort(ctx, run.ID, cr.Name, cp); err != nil {
			return nil, fmt.Errorf("apply %s: %w", cr.Name, err)
		}
		if !opts.IncludeItems {
			cr.Items = nil
		}
		rep.Cohorts = append(rep.Cohorts, cr)
	}
	tally(rep)
	if err := e.q.FileBackfillFinishRun(ctx, db.FileBackfillFinishRunParams{
		ID: run.ID, Status: "completed",
	}); err != nil {
		return nil, err
	}
	return rep, nil
}

// applyBatch commits one bounded unit of work: every item outcome, the
// business writes, and the checkpoint move, in one transaction.
func (e *Engine) applyBatch(ctx context.Context, runID, cohort string, batch []Item, cp *counters) error {
	// Stat outside the transaction: a missing object is an item outcome, but
	// an unreachable store must abort the batch BEFORE the tx opens so resume
	// retries the page instead of recording a false verdict.
	stats := map[string]storage.ObjectInfo{}
	missing := map[string]bool{}
	invalid := map[string]bool{}
	for i := range batch {
		it := &batch[i]
		if it.Class != ClassVerified || it.Cohort == CohortContentRefs {
			continue
		}
		e.fillDefaults(it)
		loc := e.itemLocator(*it)
		id := it.locatorID()
		if _, ok := stats[id]; ok || missing[id] || invalid[id] {
			continue
		}
		info, err := e.stat.Stat(ctx, loc)
		switch {
		case errors.Is(err, storage.ErrNotFound):
			missing[id] = true
		case errors.Is(err, storage.ErrLocatorInvalid):
			// Deterministic refusal (bad key shape, wrong bucket) — the item
			// is held in the ledger, not retried-fatal for the whole run.
			invalid[id] = true
		case err != nil:
			return fmt.Errorf("stat %s: %w", loc.Key, err)
		default:
			stats[id] = info
		}
	}

	tx, err := e.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := e.q.WithTx(tx)

	for i := range batch {
		it := &batch[i]
		status, reason := string(it.Class), it.Reason
		var fileID, objectVersion string
		var details map[string]any

		switch {
		case it.Cohort == CohortContentRefs:
			// Evidence only — record the verdict, write nothing.
		case it.Class == ClassVerified && missing[it.locatorID()]:
			status, reason = string(ClassHeld), "object_missing"
		case it.Class == ClassVerified && invalid[it.locatorID()]:
			status, reason = string(ClassHeld), "unsafe_locator"
		case it.Class == ClassPromote:
			res, err := e.applyPromote(ctx, q, it)
			if err != nil {
				return fmt.Errorf("%s/%s: %w", it.SourceTable, it.SourceID, err)
			}
			status, reason, fileID, details = res.status, res.reason, res.fileID, res.details
		case it.Class == ClassVerified:
			res, err := e.applyVerified(ctx, q, runID, it, stats[it.locatorID()])
			if err != nil {
				return fmt.Errorf("%s/%s: %w", it.SourceTable, it.SourceID, err)
			}
			status, reason, fileID, objectVersion, details = res.status, res.reason, res.fileID, res.version, res.details
		case it.Class == ClassAlreadyApplied:
			fileID = it.FileID
		}

		if err := q.FileBackfillPutItem(ctx, itemParams(runID, *it, status, reason, fileID, objectVersion, details)); err != nil {
			return err
		}
		cp.seen++
		switch status {
		case itemApplied:
			cp.applied++
		case string(ClassHeld):
			cp.held++
		default:
			cp.skipped++
		}
		cp.lastCursor = it.SourceID
	}

	if err := q.FileBackfillPutCheckpoint(ctx, db.FileBackfillPutCheckpointParams{
		RunID: runID, Cohort: cohort, Cursor: cp.lastCursor,
		Seen: cp.seen, Applied: cp.applied, Skipped: cp.skipped, Held: cp.held,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type applyResult struct {
	status  string
	reason  string
	fileID  string
	version string
	details map[string]any
}

// applyVerified mints or reuses the files row, inserts the claimed session,
// and claims the business reference — all inside the batch transaction.
func (e *Engine) applyVerified(ctx context.Context, q *db.Queries, runID string, it *Item, info storage.ObjectInfo) (*applyResult, error) {
	fileID, created, err := e.getOrCreateFile(ctx, q, it, info)
	if err != nil {
		return nil, err
	}
	if fileID == "" {
		return &applyResult{status: string(ClassHeld), reason: it.Reason}, nil
	}
	if err := e.claimBusinessRef(ctx, q, it, fileID); err != nil {
		return nil, err
	}
	if it.replaced {
		return &applyResult{status: itemSkipped, reason: "reference_taken", fileID: fileID}, nil
	}
	details := map[string]any{
		"file_created":  created,
		"object_size":   info.SizeBytes,
		"size_mismatch": it.SizeBytes > 0 && info.SizeBytes != it.SizeBytes,
		"session_id":    sessionIDFor(*it),
	}
	if it.adoptedFrom != nil {
		details["adopted_from"] = it.adoptedFrom
	}
	return &applyResult{
		status: itemApplied, fileID: fileID, version: info.VersionID,
		details: details,
	}, nil
}

// applyPromote copies a metadata-only file_id into the chat_messages column
// — the only carrier the GC reference providers read — so the file the row
// already claims is actually held. The files row and its session belong to
// the FS write that created them; apply touches neither. The guarded update
// keeps replays no-ops and a concurrent different value reports
// file_id_conflict instead of being overwritten.
func (e *Engine) applyPromote(ctx context.Context, q *db.Queries, it *Item) (*applyResult, error) {
	n, err := q.FileBackfillSetChatMessageFile(ctx, db.FileBackfillSetChatMessageFileParams{
		ID: it.SourceID, FileID: pgText(it.PromoteFileID),
	})
	if err != nil {
		return nil, err
	}
	details := map[string]any{"promoted": true}
	if n > 0 {
		return &applyResult{status: itemApplied, fileID: it.PromoteFileID, details: details}, nil
	}
	cur, gerr := q.FileBackfillGetChatMessageFileID(ctx, it.SourceID)
	if gerr != nil {
		return nil, gerr
	}
	if cur.Valid && cur.String == it.PromoteFileID {
		// A concurrent fix landed the same value — the desired state holds,
		// so the item is applied and rollback's guarded clear stays honest.
		return &applyResult{status: itemApplied, fileID: it.PromoteFileID, details: details}, nil
	}
	return &applyResult{status: itemSkipped, reason: "file_id_conflict", fileID: it.PromoteFileID}, nil
}

// getOrCreateFile resolves the files row for the item's locator. It returns
// the id, whether this call created the row, or ("", false) when the locator
// is occupied by a tombstone or a foreign-tenant row — held, never stolen.
func (e *Engine) getOrCreateFile(ctx context.Context, q *db.Queries, it *Item, info storage.ObjectInfo) (string, bool, error) {
	bucket := pgtype.Text{String: it.Bucket, Valid: it.Bucket != ""}
	existing, err := q.FileBackfillGetFileByLocator(ctx, db.FileBackfillGetFileByLocatorParams{
		Storage: it.Storage, ObjectKey: it.ObjectKey, Bucket: bucket,
	})
	if err == nil {
		id, _, err := e.adoptExistingFile(ctx, q, existing, it, info)
		return id, false, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}

	meta, _ := json.Marshal(map[string]any{
		"backfill":     true,
		"cohort":       it.Cohort,
		"source_table": it.SourceTable,
		"source_id":    it.SourceID,
		"run_id":       it.runID,
	})
	filename := it.Filename
	if strings.TrimSpace(filename) == "" {
		// A blank or whitespace-only name fails files_original_filename_nonempty;
		// the key's last segment is the honest name — unsafe_locator already
		// held keys with an empty or dot trailing segment.
		filename = it.ObjectKey
		if i := strings.LastIndexByte(filename, '/'); i >= 0 {
			filename = filename[i+1:]
		}
		if filename == "" {
			filename = "unnamed"
		}
	}
	id := util.NewID()
	row, err := q.FileBackfillInsertFile(ctx, db.FileBackfillInsertFileParams{
		ID:               id,
		OrganizationID:   pgtype.Text{String: it.OrganizationID, Valid: it.OrganizationID != ""},
		Storage:          it.Storage,
		Bucket:           bucket,
		ObjectKey:        it.ObjectKey,
		OriginalFilename: filename,
		Metadata:         meta,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// ON CONFLICT DO NOTHING returns no row when the locator is already
		// claimed — a second inserter (or a committed file this plan snapshot
		// predates) re-reads the winner instead of minting a duplicate.
		row, err = q.FileBackfillGetFileByLocator(ctx, db.FileBackfillGetFileByLocatorParams{
			Storage: it.Storage, ObjectKey: it.ObjectKey, Bucket: bucket,
		})
		if err != nil {
			return "", false, err
		}
		id, _, err := e.adoptExistingFile(ctx, q, row, it, info)
		return id, false, err
	}
	if err != nil {
		return "", false, err
	}
	if err := e.markFileReady(ctx, q, row.ID, it, info); err != nil {
		return "", false, err
	}
	return row.ID, row.ID == id, nil
}

// adoptExistingFile decides whether the item may claim the file row already
// on its locator. Tombstones and failed rows keep the locator claimed forever
// (hold, report); a ready row under a different tenant is the cross-scope
// case in DB form (hold, never rebind); a pending/processing row is readied
// with the object-verified fields before reuse.
func (e *Engine) adoptExistingFile(ctx context.Context, q *db.Queries, existing db.File, it *Item, info storage.ObjectInfo) (string, bool, error) {
	switch existing.Status {
	case "deleted", "deleting":
		it.Class, it.Reason = ClassHeld, "locator_tombstoned"
		return "", false, nil
	case "failed":
		it.Class, it.Reason = ClassHeld, "file_failed"
		return "", false, nil
	}
	if existing.OrganizationID.Valid && it.OrganizationID != "" &&
		existing.OrganizationID.String != it.OrganizationID {
		it.Class, it.Reason = ClassHeld, "file_scope_conflict"
		return "", false, nil
	}
	if existing.Status == "pending" || existing.Status == "processing" {
		// Snapshot the as-was row into the ledger details: rollback restores
		// it rather than leaving a file this run did not create marked ready.
		it.adoptedFrom = &fileSnapshot{
			Status:         existing.Status,
			ContentType:    textPtr(existing.ContentType),
			SizeBytes:      int8Ptr(existing.SizeBytes),
			ChecksumSha256: textPtr(existing.ChecksumSha256),
			ObjectVersion:  textPtr(existing.ObjectVersion),
		}
		if err := e.markFileReady(ctx, q, existing.ID, it, info); err != nil {
			return "", false, err
		}
	}
	return existing.ID, true, nil
}

// fileSnapshot is the as-was files-row state recorded when apply adopts a
// pending/processing row, so rollback can restore it exactly instead of
// leaving the row readied. ready_at is not part of it: the schema forbids
// ready_at on pending/processing rows, so it is always restored NULL.
type fileSnapshot struct {
	Status         string  `json:"status"`
	ContentType    *string `json:"content_type"`
	SizeBytes      *int64  `json:"size_bytes"`
	ChecksumSha256 *string `json:"checksum_sha256"`
	ObjectVersion  *string `json:"object_version"`
}

func textPtr(v pgtype.Text) *string {
	if !v.Valid {
		return nil
	}
	return &v.String
}

func int8Ptr(v pgtype.Int8) *int64 {
	if !v.Valid {
		return nil
	}
	return &v.Int64
}

// markFileReady turns the freshly-created (or inherited pending) row ready
// with the object-verified fields: size and version from Stat, content type
// from the source row when the store does not report one.
func (e *Engine) markFileReady(ctx context.Context, q *db.Queries, fileID string, it *Item, info storage.ObjectInfo) error {
	ctype := info.ContentType
	if ctype == "" {
		ctype = it.ContentType
	}
	if ctype == "" {
		// files_ready_has_metadata requires a type for ready; opaque bytes get
		// the honest fallback rather than a guessed type.
		ctype = "application/octet-stream"
	}
	_, err := q.FileBackfillMarkFileReady(ctx, db.FileBackfillMarkFileReadyParams{
		ID:             fileID,
		ContentType:    pgtype.Text{String: ctype, Valid: true},
		SizeBytes:      pgtype.Int8{Int64: info.SizeBytes, Valid: true},
		ChecksumSha256: pgtype.Text{},
		ObjectVersion:  pgtype.Text{String: info.VersionID, Valid: info.VersionID != ""},
		ReadyAt:        pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	return err
}

// claimBusinessRef inserts the claimed session for this source row and then
// claims the business reference with a file_id-IS-NULL guard. A zero-row
// update means the row raced to another value — flagged on the item so the
// ledger records skipped/reference_taken instead of pretending the write.
func (e *Engine) claimBusinessRef(ctx context.Context, q *db.Queries, it *Item, fileID string) error {
	if err := e.insertSession(ctx, q, it, fileID); err != nil {
		return err
	}
	var n int64
	var err error
	fid := pgtype.Text{String: fileID, Valid: true}
	switch it.SourceTable {
	case "attachments":
		n, err = q.FileBackfillSetAttachmentFile(ctx, db.FileBackfillSetAttachmentFileParams{
			ID: it.SourceID, FileID: fid, Purpose: pgtype.Text{String: it.Purpose, Valid: true},
		})
	case "users":
		n, err = q.FileBackfillSetUserAvatarFile(ctx, db.FileBackfillSetUserAvatarFileParams{
			ID: it.SourceID, FileID: fid,
		})
	case "chat_messages":
		n, err = q.FileBackfillSetChatMessageFile(ctx, db.FileBackfillSetChatMessageFileParams{
			ID: it.SourceID, FileID: fid,
		})
	case "meeting_recordings":
		n, err = q.FileBackfillSetMeetingRecordingFile(ctx, db.FileBackfillSetMeetingRecordingFileParams{
			ID: it.SourceID, FileID: fid,
		})
	case "chat_voice_recordings":
		n, err = q.FileBackfillSetCallRecordingFile(ctx, db.FileBackfillSetCallRecordingFileParams{
			ID: it.SourceID, FileID: fid,
		})
	case "audit_exports":
		n, err = q.FileBackfillSetAuditExportFile(ctx, db.FileBackfillSetAuditExportFileParams{
			ID: it.SourceID, FileID: fid,
		})
	default:
		return fmt.Errorf("no reference writer for source table %q", it.SourceTable)
	}
	if err != nil {
		return err
	}
	it.replaced = n == 0
	return nil
}

// insertSession writes the already-claimed upload session — the receipt the
// historical upload never got. Scope nullability mirrors the session CHECK
// exactly: avatar is user-only, audit_export org-only, chat purposes need the
// org (workspace optional), the workspace purposes need both.
// uidx_file_upload_sessions_file caps a file at one session, so a second
// reference to a shared object (M2/M6/M7) finds the existing receipt and
// inserts nothing — the conflict is the idempotent answer, not an error.
func (e *Engine) insertSession(ctx context.Context, q *db.Queries, it *Item, fileID string) error {
	actor := it.ActorID
	kind := normalizeActorKind(it.ActorKind)
	if actor == "" {
		actor, kind = "files-backfill", "system"
	}
	now := time.Now()
	fingerprint := sha256.Sum256([]byte(
		it.Purpose + "\x00" + it.OrganizationID + "\x00" + it.WorkspaceID + "\x00" +
			it.UserID + "\x00" + it.locatorID() + "\x00" + it.Filename))
	_, err := q.FileBackfillInsertSession(ctx, db.FileBackfillInsertSessionParams{
		ID:                 sessionIDFor(*it),
		FileID:             fileID,
		CreatedBy:          actor,
		CreatedByKind:      kind,
		Purpose:            it.Purpose,
		OrganizationID:     pgtype.Text{String: it.OrganizationID, Valid: it.OrganizationID != ""},
		WorkspaceID:        pgtype.Text{String: it.WorkspaceID, Valid: it.WorkspaceID != ""},
		UserID:             pgtype.Text{String: it.UserID, Valid: it.UserID != ""},
		IdempotencyKey:     itemLocatorPrefix + it.Cohort + "/" + it.SourceTable + "/" + it.SourceID,
		CommandFingerprint: hex.EncodeToString(fingerprint[:]),
		Status:             "claimed",
		ClaimExpiresAt:     pgtype.Timestamptz{Time: now.Add(24 * time.Hour), Valid: true},
		ClosedAt:           pgtype.Timestamptz{Time: now, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // the file already carries its session receipt
	}
	return err
}

// sessionIDFor is deterministic per source row: a replay inside one run and a
// second apply run both find the same session instead of minting a duplicate.
func sessionIDFor(it Item) string {
	return sessionIDPrefix + it.SourceTable + "_" + it.SourceID
}

// normalizeActorKind maps the legacy uploader/sender kinds onto the session
// actor enum. Unknown or missing kinds become system: the session row never
// claims a human actor it cannot prove.
func normalizeActorKind(raw string) string {
	switch raw {
	case "member", "user", "human":
		return "human"
	case "agent":
		return "agent"
	default:
		return "system"
	}
}

// itemLocator resolves the item to a physical locator, filling the backend
// coordinates from Defaults when the source row did not record one.
func (e *Engine) itemLocator(it Item) storage.ObjectLocator {
	storageName, bucket := it.Storage, it.Bucket
	if storageName == "" {
		storageName, bucket = e.defaults.Storage, e.defaults.Bucket
	}
	return storage.ObjectLocator{Storage: storage.Backend(storageName), Bucket: bucket, Key: it.ObjectKey}
}

// itemParams shapes one ledger row. previous_locator keeps the as-was locator
// so rollback and the mapping report never need the source row again.
func itemParams(runID string, it Item, status, reason, fileID, objectVersion string, details map[string]any) db.FileBackfillPutItemParams {
	var det []byte
	if details != nil {
		det, _ = json.Marshal(details)
	} else {
		det = []byte("{}")
	}
	return db.FileBackfillPutItemParams{
		RunID:           runID,
		Cohort:          it.Cohort,
		SourceTable:     it.SourceTable,
		SourceID:        it.SourceID,
		FileID:          pgtype.Text{String: fileID, Valid: fileID != ""},
		Storage:         pgtype.Text{String: it.Storage, Valid: it.Storage != ""},
		Bucket:          pgtype.Text{String: it.Bucket, Valid: it.Bucket != ""},
		ObjectKey:       pgtype.Text{String: it.ObjectKey, Valid: it.ObjectKey != ""},
		ObjectVersion:   pgtype.Text{String: objectVersion, Valid: objectVersion != ""},
		OrganizationID:  pgtype.Text{String: it.OrganizationID, Valid: it.OrganizationID != ""},
		Status:          status,
		Reason:          reason,
		PreviousLocator: pgtype.Text{String: it.RawLocator, Valid: it.RawLocator != ""},
		Details:         det,
	}
}

// openRun creates or resumes the run ledger row.
func (e *Engine) openRun(ctx context.Context, opts ApplyOptions, cohorts []string) (db.FileBackfillRun, error) {
	if opts.RunID == "" {
		cfg, _ := json.Marshal(map[string]any{
			"cohorts":    cohorts,
			"batch_size": opts.BatchSize,
			"defaults":   e.defaults,
		})
		return e.q.FileBackfillCreateRun(ctx, db.FileBackfillCreateRunParams{
			ID: util.NewID(), Command: "apply", Config: cfg,
		})
	}
	run, err := e.q.FileBackfillGetRun(ctx, opts.RunID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return run, fmt.Errorf("run %q not found", opts.RunID)
		}
		return run, err
	}
	if run.Command != "apply" {
		return run, fmt.Errorf("run %q is a %s run, not apply", opts.RunID, run.Command)
	}
	if run.Status != "running" {
		return run, fmt.Errorf("run %q already %s", opts.RunID, run.Status)
	}
	return run, nil
}

// doneSet is the resume index: source rows this run already committed a
// ledger row for are skipped wholesale, which is what makes a mid-batch crash
// replay-safe — the rolled-back batch left no rows, so it replays in full.
func (e *Engine) doneSet(ctx context.Context, runID string) (map[string]bool, error) {
	rows, err := e.q.FileBackfillListDoneItemKeys(ctx, runID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(rows))
	for _, r := range rows {
		out[r.SourceTable+"\x00"+r.SourceID] = true
	}
	return out, nil
}

func itemKey(it Item) string { return it.SourceTable + "\x00" + it.SourceID }

// counters carries the running checkpoint totals for one cohort.
type counters struct {
	seen, applied, skipped, held int64
	lastCursor                   string
}

func (e *Engine) cohortCounters(ctx context.Context, runID string) (map[string]*counters, error) {
	rows, err := e.q.FileBackfillListCheckpoints(ctx, runID)
	if err != nil {
		return nil, err
	}
	out := map[string]*counters{}
	for _, r := range rows {
		out[r.Cohort] = &counters{
			seen: r.Seen, applied: r.Applied, skipped: r.Skipped, held: r.Held, lastCursor: r.Cursor,
		}
	}
	return out, nil
}

// finishCohort marks the cohort checkpoint done. Kept separate from the last
// batch so the cursor only ever points at committed work.
func (e *Engine) finishCohort(ctx context.Context, runID, cohort string, cp *counters) error {
	return e.q.FileBackfillPutCheckpoint(ctx, db.FileBackfillPutCheckpointParams{
		RunID: runID, Cohort: cohort, Cursor: runDoneCursor,
		Seen: cp.seen, Applied: cp.applied, Skipped: cp.skipped, Held: cp.held,
	})
}

// DryRun is plan plus storage reachability: verified items are Stat-ed through
// the same adapter path apply will use, so the report shows exactly which
// rows would write and which would hold on a missing object. It opens no
// transaction and writes no ledger rows.
func (e *Engine) DryRun(ctx context.Context, opts Options) (*Report, error) {
	if e.stat == nil {
		return nil, errors.New("dry-run needs an object prober (WithWriteDeps)")
	}
	rep, err := e.Plan(ctx, Options{Cohorts: opts.Cohorts, BatchSize: opts.BatchSize, IncludeItems: true})
	if err != nil {
		return nil, err
	}
	rep.Command = "dry-run"
	for ci := range rep.Cohorts {
		cr := &rep.Cohorts[ci]
		seen := map[string]bool{}
		for i := range cr.Items {
			it := &cr.Items[i]
			if it.Class != ClassVerified || it.Cohort == CohortContentRefs {
				continue
			}
			id := it.locatorID()
			if seen[id] {
				continue // one Stat per physical object, duplicates included
			}
			seen[id] = true
			if _, err := e.stat.Stat(ctx, e.itemLocator(*it)); errors.Is(err, storage.ErrNotFound) {
				it.Class, it.Reason = ClassHeld, "object_missing"
			} else if err != nil {
				return nil, fmt.Errorf("dry-run stat %s: %w", it.ObjectKey, err)
			}
		}
		retally(cr)
	}
	tally(rep)
	if !opts.IncludeItems {
		for i := range rep.Cohorts {
			rep.Cohorts[i].Items = nil
		}
	}
	return rep, nil
}

// fillDefaults stamps the assumed backend coordinates onto an item whose
// source row did not record one, so the files row, the ledger and the Stat
// all agree on the same locator.
func (e *Engine) fillDefaults(it *Item) {
	if it.Storage == "" {
		it.Storage, it.Bucket = e.defaults.Storage, e.defaults.Bucket
	}
}
