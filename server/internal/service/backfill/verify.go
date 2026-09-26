package backfill

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Verify verdicts, one per scanned source row.
const (
	verdictConsistent           = "consistent"       // reference + files row + session + object all agree
	verdictPendingApply         = "pending_apply"    // verified in plan, file_id not yet written
	verdictUnreferenced         = "unreferenced"     // held/foreign/unresolved and still file_id NULL — correct state
	verdictFileRowMissing       = "file_row_missing" // business file_id points at nothing
	verdictLocatorMismatch      = "locator_mismatch" // files row names different bytes than the source locator
	verdictSessionMissing       = "session_missing"  // no claimed session for the file
	verdictSessionScopeMismatch = "session_scope_mismatch"
	verdictObjectMissing        = "object_missing"       // Stat: locator names no object
	verdictSizeMismatch         = "size_mismatch"        // object size != files.size_bytes (not byte identity)
	verdictUnexpectedReference  = "unexpected_reference" // a held/foreign/unresolved row somehow carries file_id
	verdictDrift                = "drift"                // ledger file_id differs from the business row's current value
)

// Verify reconciles what apply wrote against the live rows and the object
// stores. It is read-only: every check is a SELECT or a Stat. When RunID is
// set the run's ledger rows are cross-checked for drift as well.
//
// Size equality is a metadata check, not byte identity — a mismatch means the
// row's recorded size disagrees with the object, which is reported, not
// silently tolerated.
func (e *Engine) Verify(ctx context.Context, opts VerifyOptions) (*Report, error) {
	if e.stat == nil {
		return nil, errors.New("verify needs an object prober (WithWriteDeps)")
	}
	opts.normalize()
	names, err := ResolveCohorts(opts.Cohorts)
	if err != nil {
		return nil, err
	}
	rep, err := e.Plan(ctx, Options{Cohorts: names, BatchSize: opts.BatchSize, IncludeItems: true})
	if err != nil {
		return nil, err
	}
	rep.Command = "verify"
	rep.RunID = opts.RunID

	var ledger map[string]db.FileBackfillItem
	if opts.RunID != "" {
		ledger, err = e.runItems(ctx, opts.RunID)
		if err != nil {
			return nil, err
		}
	}

	statCache := map[string]storage.ObjectInfo{}
	statErr := map[string]error{}
	statOnce := func(it *Item) (storage.ObjectInfo, error) {
		id := it.locatorID()
		if _, seen := statErr[id]; !seen {
			info, err := e.stat.Stat(ctx, e.itemLocator(*it))
			statCache[id], statErr[id] = info, err
		}
		return statCache[id], statErr[id]
	}

	for ci := range rep.Cohorts {
		cr := &rep.Cohorts[ci]
		cr.Checks = map[string]int{}
		for i := range cr.Items {
			it := &cr.Items[i]
			v := e.verifyItem(ctx, it, statOnce)
			if opts.RunID != "" {
				if led, ok := ledger[itemKey(*it)]; ok && led.FileID.Valid && led.FileID.String != it.FileID {
					v = verdictDrift
				}
			}
			it.Verdict = v
			cr.Checks[v]++
			if v == verdictPendingApply || v == verdictUnreferenced || v == verdictConsistent {
				cr.VerifiedOK++
			} else {
				cr.Failed++
			}
		}
		sort.Slice(cr.Items, func(i, j int) bool {
			// Failures first, then source id — an operator reads the top.
			fi, fj := isFailure(cr.Items[i].Verdict), isFailure(cr.Items[j].Verdict)
			if fi != fj {
				return fi
			}
			return itemKey(cr.Items[i]) < itemKey(cr.Items[j])
		})
		retally(cr)
	}
	tally(rep)
	for _, cr := range rep.Cohorts {
		rep.Totals.VerifiedOK += cr.VerifiedOK
		rep.Totals.Failed += cr.Failed
	}
	if !opts.IncludeItems {
		for i := range rep.Cohorts {
			rep.Cohorts[i].Items = nil
		}
	}
	return rep, nil
}

// VerifyOptions adds the run handle to the shared Options.
type VerifyOptions struct {
	Options
	// RunID cross-checks the ledger rows of one apply run; empty verifies the
	// business truth alone.
	RunID string
}

// verifyItem produces the verdict for one freshly-scanned item. The scanner
// already read the current file_id, so already_applied means "the business
// reference exists" — verify confirms what it points at.
func (e *Engine) verifyItem(ctx context.Context, it *Item, statOnce func(*Item) (storage.ObjectInfo, error)) string {
	if it.FileID == "" {
		switch it.Class {
		case ClassVerified:
			return verdictPendingApply
		default:
			// held/foreign/unresolved correctly carry no reference.
			return verdictUnreferenced
		}
	}
	if it.Class == ClassHeld || it.Class == ClassForeign || it.Class == ClassUnresolved {
		return verdictUnexpectedReference
	}

	// Content refs are evidence rows: they never claim a file or hold a
	// session, so the meaningful check is only that the referenced file_id
	// resolves to a live files row.
	if it.Cohort == CohortContentRefs {
		_, err := e.q.FileBackfillGetFileByID(ctx, it.FileID)
		switch {
		case err == nil:
			return verdictConsistent
		case errors.Is(err, pgx.ErrNoRows):
			return verdictFileRowMissing
		default:
			return verdictFileRowMissing + ":error"
		}
	}

	f, err := e.q.FileBackfillGetFileByID(ctx, it.FileID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return verdictFileRowMissing
		}
		return verdictFileRowMissing + ":error"
	}
	if it.ObjectKey != "" && it.Storage != "" {
		// The files row must name the same physical locator the source row did.
		// (Items with an assumed backend skip the backend check — the locator
		// defaults are an operator claim, not row evidence.)
		if f.Storage != it.Storage || f.ObjectKey != it.ObjectKey || f.Bucket.String != it.Bucket {
			return verdictLocatorMismatch
		}
	}
	sessions, err := e.q.FileBackfillListSessionsForFile(ctx, it.FileID)
	if err != nil {
		return verdictSessionMissing + ":error"
	}
	if !sessionCovers(sessions, it) {
		return verdictSessionMissing
	}
	if f.Status == "ready" {
		info, serr := statOnce(&Item{Storage: f.Storage, Bucket: f.Bucket.String, ObjectKey: f.ObjectKey})
		switch {
		case errors.Is(serr, storage.ErrNotFound):
			return verdictObjectMissing
		case serr != nil:
			return serr.Error()
		case f.SizeBytes.Valid && info.SizeBytes != f.SizeBytes.Int64:
			return verdictSizeMismatch
		}
	}
	return verdictConsistent
}

// sessionCovers reports whether the file has a claimed session whose scope
// and purpose match what the source row resolves to.
func sessionCovers(sessions []db.FileUploadSession, it *Item) bool {
	for _, s := range sessions {
		if s.Status != "claimed" || s.Purpose != it.Purpose {
			continue
		}
		if s.OrganizationID.String == it.OrganizationID &&
			s.WorkspaceID.String == it.WorkspaceID &&
			s.UserID.String == it.UserID {
			return true
		}
	}
	return false
}

func isFailure(v string) bool {
	switch v {
	case verdictConsistent, verdictPendingApply, verdictUnreferenced:
		return false
	}
	return true
}

// runItems indexes a run's ledger rows by source key.
func (e *Engine) runItems(ctx context.Context, runID string) (map[string]db.FileBackfillItem, error) {
	rows, err := e.q.FileBackfillListRunItems(ctx, runID)
	if err != nil {
		return nil, fmt.Errorf("verify run %s: %w", runID, err)
	}
	out := make(map[string]db.FileBackfillItem, len(rows))
	for _, r := range rows {
		out[r.SourceTable+"\x00"+r.SourceID] = r
	}
	return out, nil
}

// Rollback unwinds one apply run: every item it applied loses the business
// reference (guarded by the recorded file_id — a row that moved on is never
// rewritten), the session rows this run minted are removed, and files rows it
// created are physically deleted only when nothing else references them.
// Objects are never touched: legacy locators still name the bytes.
func (e *Engine) Rollback(ctx context.Context, runID string) (*Report, error) {
	if e.pool == nil {
		return nil, errors.New("rollback needs a database pool (WithWriteDeps)")
	}
	run, err := e.q.FileBackfillGetRun(ctx, runID)
	if err != nil {
		return nil, fmt.Errorf("rollback run %s: %w", runID, err)
	}
	if run.Command != "apply" {
		return nil, fmt.Errorf("run %s is a %s run, not apply", runID, run.Command)
	}
	items, err := e.q.FileBackfillListRunItems(ctx, runID)
	if err != nil {
		return nil, err
	}
	rep := &Report{Command: "rollback", RunID: runID}
	cr := CohortReport{Name: "rollback"}
	for _, it := range items {
		if it.Status != itemApplied || !it.FileID.Valid {
			continue
		}
		if err := e.rollbackItem(ctx, runID, it); err != nil {
			return nil, fmt.Errorf("rollback %s/%s: %w", it.SourceTable, it.SourceID, err)
		}
		cr.RowsSeen++
	}
	rep.Cohorts = append(rep.Cohorts, cr)
	if err := e.q.FileBackfillFinishRun(ctx, db.FileBackfillFinishRunParams{
		ID: runID, Status: "rolled_back",
	}); err != nil {
		return nil, err
	}
	return rep, nil
}

func (e *Engine) rollbackItem(ctx context.Context, runID string, it db.FileBackfillItem) error {
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := e.q.WithTx(tx)

	fid := it.FileID.String
	switch it.SourceTable {
	case "attachments":
		_, err = q.FileBackfillClearAttachmentFile(ctx, db.FileBackfillClearAttachmentFileParams{ID: it.SourceID, FileID: pgText(fid)})
	case "users":
		_, err = q.FileBackfillClearUserAvatarFile(ctx, db.FileBackfillClearUserAvatarFileParams{ID: it.SourceID, FileID: pgText(fid)})
	case "chat_messages":
		_, err = q.FileBackfillClearChatMessageFile(ctx, db.FileBackfillClearChatMessageFileParams{ID: it.SourceID, FileID: pgText(fid)})
	case "meeting_recordings":
		_, err = q.FileBackfillClearMeetingRecordingFile(ctx, db.FileBackfillClearMeetingRecordingFileParams{ID: it.SourceID, FileID: pgText(fid)})
	case "chat_voice_recordings":
		_, err = q.FileBackfillClearCallRecordingFile(ctx, db.FileBackfillClearCallRecordingFileParams{ID: it.SourceID, FileID: pgText(fid)})
	case "audit_exports":
		_, err = q.FileBackfillClearAuditExportFile(ctx, db.FileBackfillClearAuditExportFileParams{ID: it.SourceID, FileID: pgText(fid)})
	default:
		return fmt.Errorf("no rollback writer for %q", it.SourceTable)
	}
	if err != nil {
		return err
	}

	// Delete this run's session for the row; the deterministic id means the
	// session exists iff this run created it.
	if err := q.FileBackfillDeleteSession(ctx, db.FileBackfillDeleteSessionParams{
		ID: sessionIDFor(Item{SourceTable: it.SourceTable, SourceID: it.SourceID}), FileID: fid,
	}); err != nil {
		return err
	}

	// Delete the files row only when this run created it and no other session
	// still claims it — a second run reusing the locator keeps the row alive.
	created := false
	var det map[string]any
	if json.Unmarshal(it.Details, &det) == nil {
		created, _ = det["file_created"].(bool)
	}
	if created {
		rest, err := q.FileBackfillListSessionsForFile(ctx, fid)
		if err != nil {
			return err
		}
		if len(rest) == 0 {
			if _, err := q.FileBackfillDeleteFile(ctx, fid); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

func pgText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }
