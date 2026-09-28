package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document lifecycle (C-01 §5.1/§6.3, G1-04b, UNI-678): archive, restore and
// the retention sweeps.
//
// Archive stamps the whole subtree in one transaction after a manage check
// on EVERY affected node - a restricted child the caller cannot manage makes
// the whole command fail rather than leaving a live orphan behind an
// archived parent. One archive_batch_id groups the operation's rows; restore
// brings back exactly that batch and re-roots a node whose own parent stayed
// in the trash.
//
// Retention: a document purges after purge_after (30 days from archive), an
// orphaned asset after 7 days. The delete and the FileService release share
// one transaction (ADR 0022): FileService GC, not this code, removes bytes,
// so an object another holder still references is never touched.
//
// Owned documents never enter these paths through the public commands -
// they refuse with document_owned_by_work_product. The owning work-product
// service calls the *InTx seams inside its own transaction (§13.6).

const (
	documentRetentionDays      = 30
	documentAssetRetentionDays = 7
	// documentSweepBatch bounds one worker pass; the rest waits for the next tick.
	documentSweepBatch = 200
	// documentVersionKeep is the per-document version bound (C-01 §6.3):
	// compaction drops automatic snapshots above it; manual, restore and
	// upload versions are always kept.
	documentVersionKeep = 500
)

// DocumentOwnerPurger is the §13.6 seam the purge sweep delegates to first:
// the owning service purges its own expired rows inside whatever
// transactions it needs; the public sweep then handles the rest.
type DocumentOwnerPurger interface {
	PurgeExpired(ctx context.Context, now time.Time) error
}

// SetOwnerPurger installs the owner service's purge delegate. nil leaves the
// sweep covering public documents only.
func (s *DocumentService) SetOwnerPurger(p DocumentOwnerPurger) { s.ownerPurger = p }

// ArchiveDocumentInput is POST /documents/{id}/archive. Idempotent through
// the ledger like the other tree commands.
type ArchiveDocumentInput struct {
	IdempotencyKey string
}

// DocumentArchiveResult is what archive and restore answer: the document
// after the command, the batch it moved with and the ids actually touched
// (a retry replays the stored batch).
type DocumentArchiveResult struct {
	View     DocumentView
	BatchID  string
	Affected []string
}

// archiveReplay is what the ledger keeps for archive and restore.
type archiveReplay struct {
	DocumentID string `json:"document_id"`
	BatchID    string `json:"batch_id"`
}

// ArchiveDocument moves a document and its subtree into the trash. Every
// live node of the subtree must be manageable by the caller; the command
// refuses a subtree that contains one it cannot manage.
func (s *DocumentService) ArchiveDocument(ctx context.Context, actor Actor, documentID string, in ArchiveDocumentInput) (DocumentArchiveResult, error) {
	return s.documentBatchLifecycle(ctx, actor, documentID, in.IdempotencyKey, idempotencyScopeDocumentArchive, func(q *db.Queries, doc db.Document, access DocumentAccess) (DocumentArchiveResult, error) {
		if doc.ArchivedAt.Valid {
			// Already in the trash: the command is a no-op the caller can
			// read back, same answer as a fresh archive.
			view, err := s.documentView(ctx, q, actor, doc)
			if err != nil {
				return DocumentArchiveResult{}, err
			}
			return DocumentArchiveResult{View: view, BatchID: doc.ArchiveBatchID.String}, nil
		}
		subtree, err := q.ListDocumentSubtree(ctx, db.ListDocumentSubtreeParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, RootID: doc.ID,
		})
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		var live []string
		for _, n := range subtree {
			if n.ArchivedAt.Valid {
				continue
			}
			node, err := q.GetDocument(ctx, db.GetDocumentParams{
				ID: n.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			})
			if err != nil {
				return DocumentArchiveResult{}, err
			}
			lvl, err := s.effectiveLevel(ctx, q, actor, node)
			if err != nil {
				return DocumentArchiveResult{}, err
			}
			// Never archive a restricted child the caller cannot manage:
			// refuse the whole command, never leave the child orphaned live.
			if err := decideDocumentAccess(node, lvl, DocumentLevelManage); err != nil {
				if errors.Is(err, ErrNotFound) {
					return DocumentArchiveResult{}, ErrForbidden
				}
				return DocumentArchiveResult{}, err
			}
			live = append(live, node.ID)
		}
		batch := util.NewID()
		stamped, err := q.ArchiveDocumentBatch(ctx, db.ArchiveDocumentBatchParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			ArchivedBy: nullText(actor.ID), PurgeAfter: pgtype.Timestamptz{Time: s.now().Add(documentRetentionDays * 24 * time.Hour), Valid: true},
			ArchiveBatchID: pgtype.Text{String: batch, Valid: true}, Ids: live,
		})
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		for _, id := range stamped {
			if err := auditRecorder.Record(ctx, q, audit.Entry{
				OrganizationID: doc.OrganizationID,
				WorkspaceID:    doc.WorkspaceID,
				Actor:          actor,
				Action:         audit.ActionDocumentArchived,
				ResourceType:   "document",
				ResourceID:     id,
				Metadata:       map[string]any{"archive_batch_id": batch},
			}, audit.Event{Topic: "document.archived", Payload: map[string]string{
				"document_id": id, "workspace_id": doc.WorkspaceID, "archive_batch_id": batch,
			}}); err != nil {
				return DocumentArchiveResult{}, err
			}
		}
		doc.ArchiveBatchID = pgtype.Text{String: batch, Valid: true}
		doc.ArchivedAt = pgtype.Timestamptz{Time: s.now(), Valid: true}
		doc.ArchivedBy = nullText(actor.ID)
		view, err := s.documentView(ctx, q, actor, doc)
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		return DocumentArchiveResult{View: view, BatchID: batch, Affected: stamped}, nil
	})
}

// RestoreDocument brings back exactly the batch the archive stamped. A node
// whose parent stayed in the trash (or was purged) re-roots itself so it is
// reachable again.
func (s *DocumentService) RestoreDocument(ctx context.Context, actor Actor, documentID string, in ArchiveDocumentInput) (DocumentArchiveResult, error) {
	return s.documentBatchLifecycle(ctx, actor, documentID, in.IdempotencyKey, idempotencyScopeDocumentRestore, func(q *db.Queries, doc db.Document, access DocumentAccess) (DocumentArchiveResult, error) {
		if !doc.ArchivedAt.Valid {
			return DocumentArchiveResult{}, Invalid("tài liệu không nằm trong thùng rác")
		}
		batch := doc.ArchiveBatchID.String
		var members []db.Document
		if batch == "" {
			members = []db.Document{doc}
		} else {
			rows, err := q.ListDocumentArchiveBatch(ctx, db.ListDocumentArchiveBatchParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, ArchiveBatchID: pgtype.Text{String: batch, Valid: true},
			})
			if err != nil {
				return DocumentArchiveResult{}, err
			}
			members = rows
		}
		// Manage on every member still archived: a batch comes back whole or
		// not at all.
		for _, m := range members {
			if !m.ArchivedAt.Valid {
				continue
			}
			lvl, err := s.effectiveLevel(ctx, q, actor, m)
			if err != nil {
				return DocumentArchiveResult{}, err
			}
			if !lvl.Level.AtLeast(DocumentLevelManage) {
				return DocumentArchiveResult{}, ErrForbidden
			}
		}
		var restored []string
		if batch != "" {
			rows, err := q.ClearDocumentArchiveBatch(ctx, db.ClearDocumentArchiveBatchParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
				ArchiveBatchID: pgtype.Text{String: batch, Valid: true},
			})
			if err != nil {
				return DocumentArchiveResult{}, err
			}
			for _, r := range rows {
				restored = append(restored, r.ID)
			}
		} else {
			if _, err := q.RestoreSingleDocument(ctx, db.RestoreSingleDocumentParams{
				ID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			}); err != nil {
				return DocumentArchiveResult{}, err
			}
			restored = []string{doc.ID}
		}
		inBatch := make(map[string]bool, len(restored))
		for _, id := range restored {
			inBatch[id] = true
		}
		// A member whose parent is not in the batch comes back orphaned:
		// detach it to the root so it is reachable again.
		for _, m := range members {
			if !inBatch[m.ID] || !m.ParentID.Valid {
				continue
			}
			parent, err := q.GetDocument(ctx, db.GetDocumentParams{
				ID: m.ParentID.String, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			})
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				// Purged while the batch sat in the trash.
			case err != nil:
				return DocumentArchiveResult{}, err
			case !parent.ArchivedAt.Valid:
				continue // the parent came back earlier in this batch, or was never archived
			}
			pos, err := q.NextDocumentPosition(ctx, db.NextDocumentPositionParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, ParentID: pgtype.Text{},
			})
			if err != nil {
				return DocumentArchiveResult{}, err
			}
			if _, err := q.DetachDocumentToRoot(ctx, db.DetachDocumentToRootParams{
				ID: m.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
				Position: pos, UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
			}); err != nil {
				return DocumentArchiveResult{}, err
			}
		}
		for _, id := range restored {
			if err := auditRecorder.Record(ctx, q, audit.Entry{
				OrganizationID: doc.OrganizationID,
				WorkspaceID:    doc.WorkspaceID,
				Actor:          actor,
				Action:         audit.ActionDocumentRestored,
				ResourceType:   "document",
				ResourceID:     id,
				Metadata:       map[string]any{"archive_batch_id": batch},
			}, audit.Event{Topic: "document.restored", Payload: map[string]string{
				"document_id": id, "workspace_id": doc.WorkspaceID, "archive_batch_id": batch,
			}}); err != nil {
				return DocumentArchiveResult{}, err
			}
		}
		fresh, err := q.GetDocument(ctx, db.GetDocumentParams{
			ID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		})
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		view, err := s.documentView(ctx, q, actor, fresh)
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		return DocumentArchiveResult{View: view, BatchID: batch, Affected: restored}, nil
	})
}

// documentBatchLifecycle is the shared envelope of archive and restore: one
// transaction holding the ledger claim, the workspace tree lock and the
// document row lock, with the ACL evaluated under the row lock like every
// document command.
func (s *DocumentService) documentBatchLifecycle(
	ctx context.Context, actor Actor, documentID, idemKey, scope string,
	fn func(q *db.Queries, doc db.Document, access DocumentAccess) (DocumentArchiveResult, error),
) (DocumentArchiveResult, error) {
	if !validActor(actor) || documentID == "" {
		return DocumentArchiveResult{}, ErrNotFound
	}
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentArchiveResult{}, ErrNotFound
	}
	if err != nil {
		return DocumentArchiveResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DocumentArchiveResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	opts := IdempotencyOptions{
		Fingerprint:        IdempotencyFingerprint(scope, doc.ID),
		RequireFingerprint: true,
	}
	replay, commit, err := BeginIdempotent(ctx, q, doc.OrganizationID, doc.WorkspaceID, scope, idemKey, actor.ID, opts)
	if err != nil {
		return DocumentArchiveResult{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		var r archiveReplay
		if err := json.Unmarshal(replay.Body, &r); err != nil {
			return DocumentArchiveResult{}, err
		}
		cur, err := q.GetDocument(ctx, db.GetDocumentParams{
			ID: r.DocumentID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return DocumentArchiveResult{}, ErrNotFound
		}
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		view, err := s.documentView(ctx, q, actor, cur)
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return DocumentArchiveResult{}, err
		}
		return DocumentArchiveResult{View: view, BatchID: r.BatchID}, nil
	}
	if err := q.LockDocumentTree(ctx, doc.WorkspaceID); err != nil {
		return DocumentArchiveResult{}, err
	}
	doc, err = q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentArchiveResult{}, ErrNotFound
	}
	if err != nil {
		return DocumentArchiveResult{}, err
	}
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return DocumentArchiveResult{}, err
	}
	if doc.OwnerKind.Valid {
		return DocumentArchiveResult{}, errDocumentOwned()
	}
	if err := decideDocumentAccess(doc, access, DocumentLevelManage); err != nil {
		return DocumentArchiveResult{}, err
	}
	out, err := fn(q, doc, access)
	if err != nil {
		return DocumentArchiveResult{}, err
	}
	body, err := json.Marshal(archiveReplay{DocumentID: doc.ID, BatchID: out.BatchID})
	if err != nil {
		return DocumentArchiveResult{}, err
	}
	if err := commit(http.StatusOK, body); err != nil {
		return DocumentArchiveResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DocumentArchiveResult{}, err
	}
	return out, nil
}

// --- Owner seams (C-01 §13.6) -------------------------------------------

// ArchiveOwnedDocumentsInTx archives every live document ownerID owns,
// inside the caller's transaction, under the caller's archive batch or a
// fresh one when empty. Returns the stamped ids.
func (s *DocumentService) ArchiveOwnedDocumentsInTx(ctx context.Context, q *db.Queries, actor Actor, organizationID, workspaceID, ownerID, archiveBatchID string) ([]string, error) {
	if ownerID == "" {
		return nil, Invalid("owner_id bắt buộc")
	}
	if archiveBatchID == "" {
		archiveBatchID = util.NewID()
	}
	stamped, err := q.ArchiveDocumentsByOwner(ctx, db.ArchiveDocumentsByOwnerParams{
		OrganizationID: organizationID, WorkspaceID: workspaceID, OwnerID: pgtype.Text{String: ownerID, Valid: true},
		ArchivedBy:     nullText(actor.ID),
		PurgeAfter:     pgtype.Timestamptz{Time: s.now().Add(documentRetentionDays * 24 * time.Hour), Valid: true},
		ArchiveBatchID: pgtype.Text{String: archiveBatchID, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	for _, id := range stamped {
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: organizationID, WorkspaceID: workspaceID,
			Actor: actor, Action: audit.ActionDocumentArchived,
			ResourceType: "document", ResourceID: id,
			Metadata: map[string]any{"archive_batch_id": archiveBatchID, "owner_id": ownerID},
		}, audit.Event{Topic: "document.archived", Payload: map[string]string{
			"document_id": id, "workspace_id": workspaceID, "archive_batch_id": archiveBatchID,
		}}); err != nil {
			return nil, err
		}
	}
	return stamped, nil
}

// RestoreOwnedDocumentsInTx restores the documents an owner archived, inside
// the caller's transaction. Returns the restored ids.
func (s *DocumentService) RestoreOwnedDocumentsInTx(ctx context.Context, q *db.Queries, actor Actor, organizationID, workspaceID, ownerID string) ([]string, error) {
	if ownerID == "" {
		return nil, Invalid("owner_id bắt buộc")
	}
	stamped, err := q.RestoreDocumentsByOwner(ctx, db.RestoreDocumentsByOwnerParams{
		OrganizationID: organizationID, WorkspaceID: workspaceID, OwnerID: pgtype.Text{String: ownerID, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	for _, id := range stamped {
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: organizationID, WorkspaceID: workspaceID,
			Actor: actor, Action: audit.ActionDocumentRestored,
			ResourceType: "document", ResourceID: id,
			Metadata: map[string]any{"owner_id": ownerID},
		}, audit.Event{Topic: "document.restored", Payload: map[string]string{
			"document_id": id, "workspace_id": workspaceID,
		}}); err != nil {
			return nil, err
		}
	}
	return stamped, nil
}

// ArchiveOwnedDocumentInTx is the single-document half of the owner seam:
// the owner removes one representation it owns. Returns false when the
// document is not owned or already archived.
func (s *DocumentService) ArchiveOwnedDocumentInTx(ctx context.Context, q *db.Queries, actor Actor, organizationID, workspaceID, documentID string) (bool, error) {
	stamped, err := q.ArchiveOwnedDocument(ctx, db.ArchiveOwnedDocumentParams{
		ID: documentID, OrganizationID: organizationID, WorkspaceID: workspaceID,
		ArchivedBy:     nullText(actor.ID),
		PurgeAfter:     pgtype.Timestamptz{Time: s.now().Add(documentRetentionDays * 24 * time.Hour), Valid: true},
		ArchiveBatchID: pgtype.Text{String: util.NewID(), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: organizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionDocumentArchived,
		ResourceType: "document", ResourceID: stamped,
		Metadata: map[string]any{"seam": "owner"},
	}, audit.Event{Topic: "document.archived", Payload: map[string]string{
		"document_id": stamped, "workspace_id": workspaceID,
	}}); err != nil {
		return false, err
	}
	return true, nil
}

// RestoreOwnedDocumentInTx restores one owned document inside the caller's
// transaction; false when it is not owned or not archived.
func (s *DocumentService) RestoreOwnedDocumentInTx(ctx context.Context, q *db.Queries, actor Actor, organizationID, workspaceID, documentID string) (bool, error) {
	stamped, err := q.RestoreOwnedDocument(ctx, db.RestoreOwnedDocumentParams{
		ID: documentID, OrganizationID: organizationID, WorkspaceID: workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: organizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionDocumentRestored,
		ResourceType: "document", ResourceID: stamped,
		Metadata: map[string]any{"seam": "owner"},
	}, audit.Event{Topic: "document.restored", Payload: map[string]string{
		"document_id": stamped, "workspace_id": workspaceID,
	}}); err != nil {
		return false, err
	}
	return true, nil
}

// --- Retention sweeps -----------------------------------------------------

// DocumentPurgeReport is what one purge pass did.
type DocumentPurgeReport struct {
	// Purged is document rows deleted (with their dependent rows).
	Purged int
	// Released is file references handed back to FileService.
	Released int
	// AssetsPurged is orphaned asset rows removed.
	AssetsPurged int
	// Failed is rows that errored; the sweep continues past them and they
	// are picked up again by the next tick.
	Failed int
}

// PurgeExpired deletes archived documents whose purge_after passed, then
// orphaned assets past their grace. now is injected (tests run the sweep
// over rows stamped in the past without waiting a month).
func (s *DocumentService) PurgeExpired(ctx context.Context, now time.Time) (DocumentPurgeReport, error) {
	var rep DocumentPurgeReport
	if s.files == nil {
		return rep, errors.New("documents: purge requires FileService")
	}
	if s.ownerPurger != nil {
		// The owner service purges its own expired rows first (C-01 §13.6).
		if err := s.ownerPurger.PurgeExpired(ctx, now); err != nil {
			return rep, fmt.Errorf("documents: owner purge: %w", err)
		}
	}
	for {
		batch, err := s.q.ListDocumentsForPurge(ctx, db.ListDocumentsForPurgeParams{
			Before: pgtype.Timestamptz{Time: now, Valid: true}, MaxRows: int32(documentSweepBatch),
		})
		if err != nil {
			return rep, err
		}
		if len(batch) == 0 {
			break
		}
		for _, d := range batch {
			released, err := s.purgeOneDocument(ctx, d, now)
			if err != nil {
				rep.Failed++
				slog.Warn("documents purge: row failed, next sweep retries", "document", d.ID, "err", err)
				continue
			}
			rep.Purged++
			rep.Released += released
		}
		if len(batch) < documentSweepBatch {
			break
		}
	}
	cutoff := now.Add(-documentAssetRetentionDays * 24 * time.Hour)
	for {
		batch, err := s.q.ListOrphanedDocumentAssets(ctx, db.ListOrphanedDocumentAssetsParams{
			Before: pgtype.Timestamptz{Time: cutoff, Valid: true}, MaxRows: int32(documentSweepBatch),
		})
		if err != nil {
			return rep, err
		}
		if len(batch) == 0 {
			break
		}
		for _, a := range batch {
			if err := s.purgeOneAsset(ctx, a); err != nil {
				rep.Failed++
				slog.Warn("documents purge: asset row failed, next sweep retries", "asset", a.ID, "err", err)
				continue
			}
			rep.AssetsPurged++
		}
		if len(batch) < documentSweepBatch {
			break
		}
	}
	return rep, nil
}

// purgeOneDocument deletes one archived document and every row of its orbit
// (versions, assets, shares, links, access log, comments, favorites) and
// releases its file references - all inside one transaction, so FileService
// either sees the references gone or the document still holds them.
func (s *DocumentService) purgeOneDocument(ctx context.Context, d db.ListDocumentsForPurgeRow, now time.Time) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	doc, err := q.LockDocumentByID(ctx, d.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !doc.ArchivedAt.Valid || !doc.PurgeAfter.Valid || !doc.PurgeAfter.Time.Before(now) {
		return 0, nil // restored or re-archived later while the scan was in flight
	}
	fileIDs, err := q.ListDocumentFileIDs(ctx, db.ListDocumentFileIDsParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil {
		return 0, err
	}
	// Everything the document gathered goes in the same transaction.
	for _, del := range []func(context.Context) error{
		func(ctx context.Context) error {
			return q.DeleteDocumentVersions(ctx, db.DeleteDocumentVersionsParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID})
		},
		func(ctx context.Context) error {
			return q.DeleteDocumentAssets(ctx, db.DeleteDocumentAssetsParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID})
		},
		func(ctx context.Context) error {
			return q.DeleteDocumentShares(ctx, db.DeleteDocumentSharesParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID})
		},
		func(ctx context.Context) error {
			return q.DeleteDocumentShareLinks(ctx, db.DeleteDocumentShareLinksParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID})
		},
		func(ctx context.Context) error {
			return q.DeleteDocumentAccessLogs(ctx, db.DeleteDocumentAccessLogsParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID})
		},
		func(ctx context.Context) error {
			return q.DeleteDocumentComments(ctx, db.DeleteDocumentCommentsParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID})
		},
		func(ctx context.Context) error {
			return q.DeleteDocumentFavorites(ctx, db.DeleteDocumentFavoritesParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID})
		},
	} {
		if err := del(ctx); err != nil {
			return 0, err
		}
	}
	n, err := q.DeleteArchivedDocument(ctx, db.DeleteArchivedDocumentParams{
		ID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	})
	if err != nil {
		return 0, err
	}
	if n == 0 {
		return 0, nil // restored between lock and delete
	}
	released := []files.FileID{}
	for _, id := range fileIDs {
		if id.Valid {
			released = append(released, files.FileID(id.String))
		}
	}
	if err := s.files.ReleaseInTx(ctx, q, released); err != nil {
		return 0, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          audit.System("documents.purge"),
		Action:         audit.ActionDocumentDeleted,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Metadata:       map[string]any{"archived_by": textOrNil(doc.ArchivedBy), "file_ids": len(released)},
	}, audit.Event{Topic: "document.deleted", Payload: map[string]string{
		"document_id": doc.ID, "workspace_id": doc.WorkspaceID,
	}}); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(released), nil
}

// purgeOneAsset removes one orphaned asset row past its grace and releases
// the file it names. A version that still references it (a restore can bring
// the reference back) keeps it.
func (s *DocumentService) purgeOneAsset(ctx context.Context, a db.ListOrphanedDocumentAssetsRow) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	doc, err := q.LockDocumentByID(ctx, a.DocumentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if doc.ArchivedAt.Valid {
		return nil // the document's own purge takes the row with it
	}
	held, err := q.DocumentAssetHeldByVersion(ctx, db.DocumentAssetHeldByVersionParams{
		OrganizationID: a.OrganizationID, WorkspaceID: a.WorkspaceID, DocumentID: a.DocumentID, AssetID: pgtype.Text{String: a.ID, Valid: true},
	})
	if err != nil {
		return err
	}
	if held {
		return nil
	}
	asset, err := q.GetDocumentAsset(ctx, db.GetDocumentAssetParams(a))
	if err != nil {
		return err
	}
	if !asset.OrphanedAt.Valid {
		return nil // referenced again since the scan
	}
	n, err := q.DeleteDocumentAsset(ctx, db.DeleteDocumentAssetParams(a))
	if err != nil || n == 0 {
		return err
	}
	if asset.FileID != "" {
		if err := s.files.ReleaseInTx(ctx, q, []files.FileID{files.FileID(asset.FileID)}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// --- Version compaction -----------------------------------------------------

// DocumentCompactionReport is what one compaction pass did.
type DocumentCompactionReport struct {
	// Compacted is documents that lost old automatic versions.
	Compacted int
	// VersionsDeleted is automatic version rows dropped.
	VersionsDeleted int
	// ProtectedOverflow is documents whose protected versions alone pass the
	// keep bound: they keep everything and the metric counts them.
	ProtectedOverflow int
	Failed            int
}

// CompactVersions drops old automatic versions of documents past the keep
// bound. Manual, restore and upload versions are never touched; a document
// whose protected rows alone exceed the bound keeps them all and counts
// once into the protected-overflow metric.
func (s *DocumentService) CompactVersions(ctx context.Context) (DocumentCompactionReport, error) {
	var rep DocumentCompactionReport
	if s.files == nil {
		return rep, errors.New("documents: compaction requires FileService")
	}
	for {
		batch, err := s.q.ListDocumentsOverVersionLimit(ctx, db.ListDocumentsOverVersionLimitParams{
			Keep: int32(documentVersionKeep), MaxRows: int32(documentSweepBatch),
		})
		if err != nil {
			return rep, err
		}
		if len(batch) == 0 {
			break
		}
		for _, d := range batch {
			deleted, overflow, err := s.compactOneDocument(ctx, d.OrganizationID, d.WorkspaceID, d.DocumentID)
			if err != nil {
				rep.Failed++
				slog.Warn("documents compact: document failed, next sweep retries", "document", d.DocumentID, "err", err)
				continue
			}
			if overflow {
				rep.ProtectedOverflow++
			}
			if deleted > 0 {
				rep.Compacted++
				rep.VersionsDeleted += deleted
			}
		}
		if len(batch) < documentSweepBatch {
			break
		}
	}
	return rep, nil
}

// compactOneDocument compacts one document under its row lock: it re-reads
// the counts inside the transaction, keeps the (keep - protected) newest
// automatic versions and releases the file references of the rows it drops.
func (s *DocumentService) compactOneDocument(ctx context.Context, orgID, wsID, documentID string) (deleted int, overflow bool, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if _, err := q.LockDocumentByID(ctx, documentID); errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	} else if err != nil {
		return 0, false, err
	}
	total, err := q.CountDocumentVersions(ctx, db.CountDocumentVersionsParams{
		OrganizationID: orgID, WorkspaceID: wsID, DocumentID: documentID})
	if err != nil {
		return 0, false, err
	}
	if total <= int64(documentVersionKeep) {
		return 0, false, nil
	}
	protected, err := q.CountDocumentVersionsProtected(ctx, db.CountDocumentVersionsProtectedParams{
		OrganizationID: orgID, WorkspaceID: wsID, DocumentID: documentID})
	if err != nil {
		return 0, false, err
	}
	keepAutos := int64(documentVersionKeep) - protected
	if keepAutos < 0 {
		keepAutos = 0
	}
	// Protected rows alone at or above the bound: keep everything, count it.
	if protected > int64(documentVersionKeep) {
		s.accessMetrics.IncDocumentVersionsProtectedOverflow()
		return 0, true, nil
	}
	var boundary int64
	if keepAutos == 0 {
		boundary = math.MaxInt32 // every automatic version goes
	} else {
		b, err := q.DocumentAutoVersionKeepBoundary(ctx, db.DocumentAutoVersionKeepBoundaryParams{
			OrganizationID: orgID, WorkspaceID: wsID, DocumentID: documentID, BoundaryOffset: int32(keepAutos),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, false, nil // fewer autos than keepAutos; the over-count sits elsewhere
		}
		if err != nil {
			return 0, false, err
		}
		boundary = int64(b)
	}
	dropped, err := q.DeleteDocumentAutoVersionsBelow(ctx, db.DeleteDocumentAutoVersionsBelowParams{
		OrganizationID: orgID, WorkspaceID: wsID, DocumentID: documentID, BoundaryVersion: int32(boundary),
	})
	if err != nil {
		return 0, false, err
	}
	var released []files.FileID
	for _, f := range dropped {
		if f.Valid {
			released = append(released, files.FileID(f.String))
		}
	}
	if err := s.files.ReleaseInTx(ctx, q, released); err != nil {
		return 0, false, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		Actor:          audit.System("documents.compact"),
		Action:         audit.ActionDocumentVersionsCompacted,
		ResourceType:   "document",
		ResourceID:     documentID,
		Metadata:       map[string]any{"versions_deleted": len(dropped), "boundary_version": boundary},
	}); err != nil {
		return 0, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, false, err
	}
	return len(dropped), false, nil
}
