package service

import (
	"context"
	"errors"
	"net/http"
	"sort"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document shelving (ARCHIVE-01, UNI-1845; addendum §1/§2). "Archive" in this
// codebase already means the trash; shelved is the real-archive state: an item
// done with its work stays forever, read-only (ar w2 wires the write gates),
// out of the regular lists (ar w3 wires list/search), never swept - there is
// no purge_after. Shelved and trashed are orthogonal: a shelved item may be
// trashed (and later comes back from the trash still shelved, or is purged
// like any trashed row), and a shelved item may sit under a live parent after
// a partial unshelve.
//
// Shelve stamps the whole live, not-yet-shelved subtree in one transaction
// after the same manage gate the trash command holds (decideArchiveRootAccess
// plus requireManageOnSubtree); one shelve_batch_id groups the rows, audit and
// outbox rows land per node in that transaction, under LockDocumentTree.
// Unshelve clears the item and the same-batch, still-shelved descendants the
// caller manages - the symmetric twin of restore's per-batch rule.

const (
	idempotencyScopeDocumentShelve   = "documents.shelve"
	idempotencyScopeDocumentUnshelve = "documents.unshelve"
)

// ErrDocumentShelved is the sentinel ar w2's write-path checks return for a
// write on a shelved item; the wire answer is 409 document_shelved (class
// read_only).
var ErrDocumentShelved = errors.New("document_shelved")

func errDocumentShelved() error {
	return CodedError{
		Code: "document_shelved", Status: http.StatusConflict,
		Msg: "tài liệu đã được lưu trữ: chỉ đọc, không bình luận",
		Err: ErrDocumentShelved,
	}
}

// requireNotShelved is the one check every write path calls once ar w2 wires
// them: shelved items are read-only for everyone, manage included.
func requireNotShelved(doc db.Document) error {
	if doc.ShelvedAt.Valid {
		return errDocumentShelved()
	}
	return nil
}

// shelveGate is the §3 read-only stance a mutation takes on a shelved
// document, carried through withDocumentGateLocked.
type shelveGate int8

const (
	// shelveWriteRefused is the default: every write on a shelved document
	// answers ErrDocumentShelved (409 document_shelved) after the access
	// gate, whoever the caller is.
	shelveWriteRefused shelveGate = iota
	// shelveWriteAllowed is for the commands §3 names allowed on a shelved
	// document: favourites, the copy's source lock, and the share/link/
	// break-glass revokes (Q-AR2 = a).
	shelveWriteAllowed
)

func errShelveFolderTooLarge() error {
	return coded(http.StatusBadRequest, "folder_too_large",
		"thư mục có quá nhiều mục để lưu trữ một lần (tối đa 1000): hãy lưu trữ từng phần")
}

// ShelveDocument moves a document and its whole live, not-yet-shelved subtree
// into the shelved state under one shelve_batch_id (addendum §2 S-1). The
// root gate and the subtree gate are the trash command's own
// (decideArchiveRootAccess, requireManageOnSubtree): below manage the answer
// is 404/403 the same way, and the My Folder root is my_folder_locked. A node
// the caller cannot manage refuses the whole command; the bound is the
// archive bound (folder_too_large). Idempotent: a call on an already-shelved
// item is a no-op answer, and Idempotency-Key replays the stored result.
func (s *DocumentService) ShelveDocument(ctx context.Context, actor Actor, documentID string, in ArchiveDocumentInput) (DocumentArchiveResult, error) {
	return s.documentBatchLifecycle(ctx, actor, documentID, in.IdempotencyKey, idempotencyScopeDocumentShelve, decideArchiveRootAccess, func(q *db.Queries, doc db.Document, access DocumentAccess) (DocumentArchiveResult, error) {
		if doc.ShelvedAt.Valid {
			// Already shelved: a no-op the caller can read back, same answer
			// as a fresh shelve (S-3).
			view, err := s.documentView(ctx, q, actor, doc)
			if err != nil {
				return DocumentArchiveResult{}, err
			}
			return DocumentArchiveResult{View: view, BatchID: doc.ShelveBatchID.String}, nil
		}
		// One bounded read of the live, unshelved subtree - same shape and
		// bound as the archive walk. Shelved nodes are walked through (a live
		// child of a shelved parent exists after a partial unshelve) but never
		// stamped; a trashed subtree stamps nothing but the root itself.
		target, err := q.ListUnshelvedLiveDocumentSubtreeIDs(ctx, db.ListUnshelvedLiveDocumentSubtreeIDsParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, RootID: doc.ID,
			MaxRows: int32(s.archiveBound()) + 1, MaxLevel: subtreeMaxLevel(),
		})
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		if len(target) > s.archiveBound() {
			return DocumentArchiveResult{}, errShelveFolderTooLarge()
		}
		sort.Strings(target)
		if err := s.requireManageOnSubtree(ctx, q, actor, doc, target); err != nil {
			return DocumentArchiveResult{}, err
		}
		// The walk drops the root when the root itself is already trashed;
		// shelving that item (allowed: shelved and trashed are orthogonal)
		// stamps the root alone.
		target = append(target, doc.ID)
		sort.Strings(target)
		batch := util.NewID()
		stamped, err := q.ShelveDocumentBatch(ctx, db.ShelveDocumentBatchParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			ShelvedBy:     nullText(actor.ID),
			ShelvedByKind: nullText(string(actor.Kind)),
			ShelveBatchID: pgtype.Text{String: batch, Valid: true}, Ids: target,
		})
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		// One audit row and one outbox row per node, in one statement per
		// table, inside this transaction - the archive command's own shape.
		recs := make([]audit.Recorded, 0, len(stamped))
		for _, id := range stamped {
			recs = append(recs, audit.Recorded{
				Entry: audit.Entry{
					OrganizationID: doc.OrganizationID,
					WorkspaceID:    doc.WorkspaceID,
					Actor:          actor,
					Action:         audit.ActionDocumentShelved,
					ResourceType:   "document",
					ResourceID:     id,
					Metadata:       map[string]any{"shelve_batch_id": batch},
				},
				Events: []audit.Event{{Topic: "document.shelved", Payload: map[string]string{
					"document_id": id, "workspace_id": doc.WorkspaceID, "shelve_batch_id": batch,
				}}},
			})
		}
		if err := auditRecorder.RecordMany(ctx, q, recs); err != nil {
			return DocumentArchiveResult{}, err
		}
		doc.ShelveBatchID = pgtype.Text{String: batch, Valid: true}
		doc.ShelvedAt = pgtype.Timestamptz{Time: s.now(), Valid: true}
		doc.ShelvedBy = nullText(actor.ID)
		doc.ShelvedByKind = nullText(string(actor.Kind))
		view, err := s.documentView(ctx, q, actor, doc)
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		return DocumentArchiveResult{View: view, BatchID: batch, Affected: stamped}, nil
	})
}

// UnshelveDocument clears the shelved state of the item and the same-batch,
// still-shelved descendants the caller manages (addendum §2 S-2): the
// symmetric twin of RestoreDocument's per-batch rule, so a member unshelves
// their share and leaves the rest shelved. Position in the tree never moves -
// shelving did not move it either. Idempotent like shelve: a call on an
// unshelved item is a no-op, Idempotency-Key replays the stored result.
func (s *DocumentService) UnshelveDocument(ctx context.Context, actor Actor, documentID string, in ArchiveDocumentInput) (DocumentArchiveResult, error) {
	return s.documentBatchLifecycle(ctx, actor, documentID, in.IdempotencyKey, idempotencyScopeDocumentUnshelve, decideArchiveRootAccess, func(q *db.Queries, doc db.Document, access DocumentAccess) (DocumentArchiveResult, error) {
		if !doc.ShelvedAt.Valid {
			// Already at the target state: no-op the caller can read back.
			view, err := s.documentView(ctx, q, actor, doc)
			if err != nil {
				return DocumentArchiveResult{}, err
			}
			return DocumentArchiveResult{View: view}, nil
		}
		batch := doc.ShelveBatchID.String
		members, err := s.managedShelvedSubtree(ctx, q, actor, doc)
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		var unshelved []string
		if batch != "" {
			ids := make([]string, 0, len(members))
			for _, m := range members {
				ids = append(ids, m.ID)
			}
			unshelved, err = q.ClearDocumentShelveBatch(ctx, db.ClearDocumentShelveBatchParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
				Ids: ids,
			})
			if err != nil {
				return DocumentArchiveResult{}, err
			}
			sort.Strings(unshelved)
		} else {
			// A shelved row without a batch (written before batches or by
			// hand) clears alone.
			if _, err := q.ClearDocumentShelveBatch(ctx, db.ClearDocumentShelveBatchParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
				Ids: []string{doc.ID},
			}); err != nil {
				return DocumentArchiveResult{}, err
			}
			unshelved = []string{doc.ID}
		}
		recs := make([]audit.Recorded, 0, len(unshelved))
		for _, id := range unshelved {
			recs = append(recs, audit.Recorded{
				Entry: audit.Entry{
					OrganizationID: doc.OrganizationID,
					WorkspaceID:    doc.WorkspaceID,
					Actor:          actor,
					Action:         audit.ActionDocumentUnshelved,
					ResourceType:   "document",
					ResourceID:     id,
					Metadata:       map[string]any{"shelve_batch_id": batch},
				},
				Events: []audit.Event{{Topic: "document.unshelved", Payload: map[string]string{
					"document_id": id, "workspace_id": doc.WorkspaceID, "shelve_batch_id": batch,
				}}},
			})
		}
		if err := auditRecorder.RecordMany(ctx, q, recs); err != nil {
			return DocumentArchiveResult{}, err
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
		return DocumentArchiveResult{View: view, BatchID: batch, Affected: unshelved}, nil
	})
}

// managedShelvedSubtree returns the shelved item and its same-batch,
// still-shelved descendants that the caller holds manage on - the unshelve
// twin of managedArchivedSubtree (restore), same walk over one batch and the
// same per-node rule: the root's manage gate already passed under the row
// lock; descendants the caller cannot manage keep their shelved_* fields
// untouched.
func (s *DocumentService) managedShelvedSubtree(ctx context.Context, q *db.Queries, actor Actor, root db.Document) ([]db.Document, error) {
	batch := root.ShelveBatchID.String
	if batch == "" {
		return []db.Document{root}, nil
	}
	rows, err := q.ListDocumentShelveBatch(ctx, db.ListDocumentShelveBatchParams{
		OrganizationID: root.OrganizationID, WorkspaceID: root.WorkspaceID,
		ShelveBatchID: pgtype.Text{String: batch, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	childrenOf := make(map[string][]db.Document, len(rows))
	rootRow := root
	for _, r := range rows {
		if !r.ShelvedAt.Valid {
			continue
		}
		if r.ID == root.ID {
			rootRow = r
			continue
		}
		if r.ParentID.Valid {
			childrenOf[r.ParentID.String] = append(childrenOf[r.ParentID.String], r)
		}
	}
	subtree := []db.Document{rootRow}
	seen := map[string]bool{rootRow.ID: true}
	for i := 0; i < len(subtree); i++ {
		cur := subtree[i]
		for _, ch := range childrenOf[cur.ID] {
			if seen[ch.ID] {
				continue
			}
			seen[ch.ID] = true
			subtree = append(subtree, ch)
		}
	}
	sort.Slice(subtree, func(i, j int) bool { return subtree[i].ID < subtree[j].ID })

	var isMember, isAdmin bool
	if actor.Kind == audit.KindHuman && len(subtree) > 1 {
		isMember, isAdmin, err = s.workspaceManageHints(ctx, q, root.WorkspaceID, actor.ID)
		if err != nil {
			return nil, err
		}
	}
	members := make([]db.Document, 0, len(subtree))
	for _, m := range subtree {
		if !m.ShelvedAt.Valid {
			continue
		}
		if m.ID == root.ID {
			members = append(members, m)
			continue
		}
		if m.OwnerKind.Valid || isMyFolder(m) {
			continue
		}
		if isAdmin || (isMember && m.AclOwnerID.Valid && m.AclOwnerID.String == actor.ID) {
			members = append(members, m)
			continue
		}
		lvl, err := s.effectiveLevel(ctx, q, actor, m)
		if err != nil {
			return nil, err
		}
		if lvl.canAdminister() {
			members = append(members, m)
		}
	}
	return members, nil
}
