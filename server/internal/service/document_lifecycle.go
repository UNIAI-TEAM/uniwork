package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"sort"
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
// one transaction (ADR 0024): FileService GC, not this code, removes bytes,
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
	// documentArchiveMaxNodes bounds one archive: the command holds the
	// workspace tree lock and checks and writes every node, so a subtree past
	// this is archived in parts. Restore has no bound (see RestoreDocument): a
	// batch can only be larger than this if it was archived before the bound.
	documentArchiveMaxNodes = 1000
)

// archiveBound is the node bound one archive accepts.
func (s *DocumentService) archiveBound() int {
	if s.archiveMaxNodes > 0 {
		return s.archiveMaxNodes
	}
	return documentArchiveMaxNodes
}

func errFolderTooLarge() error {
	return coded(http.StatusUnprocessableEntity, "folder_too_large",
		"thư mục có quá nhiều mục để lưu trữ một lần (tối đa 1000): hãy lưu trữ từng phần")
}

// requireManageOnSubtree refuses (ErrForbidden) unless the actor holds manage
// on every live node of the subtree. One query names the nodes a human actor
// does not trivially manage (workspace owner/admin, ACL owner, a user or
// organization manage share) over the bounded id set the archive walk already
// read - it never walks the tree a second time; only those get the full
// effectiveLevel, and the first refusal ends the walk. Anyone else is checked
// node by node, bounded by documentArchiveMaxNodes.
func (s *DocumentService) requireManageOnSubtree(ctx context.Context, q *db.Queries, actor Actor, root db.Document, live []string) error {
	check := live
	if actor.Kind == audit.KindHuman {
		isMember, isAdmin, err := s.workspaceManageHints(ctx, q, root.WorkspaceID, actor.ID)
		if err != nil {
			return err
		}
		check, err = q.ListDocumentSubtreeNeedingAccessCheck(ctx, db.ListDocumentSubtreeNeedingAccessCheckParams{
			IsWsAdmin: isAdmin, IsWsMember: isMember, ActorID: actor.ID,
			OrganizationID: root.OrganizationID, WorkspaceID: root.WorkspaceID, Ids: live,
		})
		if err != nil {
			return err
		}
	}
	for _, id := range check {
		node, err := q.GetDocument(ctx, db.GetDocumentParams{
			ID: id, OrganizationID: root.OrganizationID, WorkspaceID: root.WorkspaceID,
		})
		if err != nil {
			return err
		}
		if err := s.requireManageOn(ctx, q, actor, node); err != nil {
			return err
		}
	}
	return nil
}

// requireManageOnArchived is the restore twin: the batch members are already
// loaded, so the trivial paths are read off the rows themselves.
func (s *DocumentService) requireManageOnArchived(ctx context.Context, q *db.Queries, actor Actor, members []db.Document) error {
	var isMember, isAdmin bool
	if actor.Kind == audit.KindHuman && len(members) > 0 {
		var err error
		isMember, isAdmin, err = s.workspaceManageHints(ctx, q, members[0].WorkspaceID, actor.ID)
		if err != nil {
			return err
		}
	}
	for _, m := range members {
		if !m.ArchivedAt.Valid {
			continue
		}
		if !m.OwnerKind.Valid && (isAdmin || (isMember && m.AclOwnerID.Valid && m.AclOwnerID.String == actor.ID)) {
			continue
		}
		lvl, err := s.effectiveLevel(ctx, q, actor, m)
		if err != nil {
			return err
		}
		if !lvl.Level.AtLeast(DocumentLevelManage) {
			return ErrForbidden
		}
	}
	return nil
}

// requireManageOn is the per-node answer: manage, or ErrForbidden (a node the
// caller cannot even read is a refusal of the whole command, never a 404 that
// would hide the orphan it would leave).
func (s *DocumentService) requireManageOn(ctx context.Context, q *db.Queries, actor Actor, node db.Document) error {
	lvl, err := s.effectiveLevel(ctx, q, actor, node)
	if err != nil {
		return err
	}
	if err := decideDocumentAccess(node, lvl, DocumentLevelManage); err != nil {
		if errors.Is(err, ErrNotFound) {
			return ErrForbidden
		}
		return err
	}
	return nil
}

// workspaceManageHints reads the actor's workspace membership once: whether
// they are a member and whether the role (organization owners/admins count as
// workspace admins in RequireMember) gives manage on every non-owned document.
func (s *DocumentService) workspaceManageHints(ctx context.Context, q *db.Queries, workspaceID, userID string) (isMember, isAdmin bool, err error) {
	m, err := s.ws.RequireMemberQ(ctx, q, workspaceID, userID)
	switch {
	case err == nil:
		return true, m.Role == "owner" || m.Role == "admin", nil
	case errors.Is(err, ErrForbidden):
		return false, false, nil
	default:
		return false, false, closedTenantOrNil(err)
	}
}

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
	// pristine is decided once under the row lock: the root gate and the
	// subtree check below must agree on it.
	pristine := false
	rootGate := func(doc db.Document, access DocumentAccess) (err error) {
		pristine, err = archiveRootGate(actor, doc, access)
		return err
	}
	return s.documentBatchLifecycle(ctx, actor, documentID, in.IdempotencyKey, idempotencyScopeDocumentArchive, rootGate, func(q *db.Queries, doc db.Document, access DocumentAccess) (DocumentArchiveResult, error) {
		if doc.ArchivedAt.Valid {
			// Already in the trash: the command is a no-op the caller can
			// read back, same answer as a fresh archive.
			view, err := s.documentView(ctx, q, actor, doc)
			if err != nil {
				return DocumentArchiveResult{}, err
			}
			return DocumentArchiveResult{View: view, BatchID: doc.ArchiveBatchID.String}, nil
		}
		// One bounded read of the live subtree: a huge folder is refused before
		// any lock-holding work, and the access check below is one query over
		// the same ids. The walk stops after the bound is passed.
		live, err := q.ListLiveDocumentSubtreeIDs(ctx, db.ListLiveDocumentSubtreeIDsParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, RootID: doc.ID,
			MaxRows: int32(s.archiveBound()) + 1, MaxLevel: subtreeMaxLevel(),
		})
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		if len(live) > s.archiveBound() {
			return DocumentArchiveResult{}, errFolderTooLarge()
		}
		// The walk cannot sort (that would evaluate the whole CTE), so the
		// command sorts the ids it did read: the refusal order and the log
		// stay stable however the planner returns them.
		sort.Strings(live)
		// Never archive a restricted child the caller cannot manage: refuse the
		// whole command, never leave the child orphaned live. A pristine copy
		// is a file with nothing under it; anything else takes the full check.
		if !pristine || len(live) != 1 || live[0] != doc.ID {
			if err := s.requireManageOnSubtree(ctx, q, actor, doc, live); err != nil {
				return DocumentArchiveResult{}, err
			}
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
		// One audit row and one outbox row per node, written in one statement
		// per table: the trail stays per document, the round trips do not.
		recs := make([]audit.Recorded, 0, len(stamped))
		for _, id := range stamped {
			recs = append(recs, audit.Recorded{
				Entry: audit.Entry{
					OrganizationID: doc.OrganizationID,
					WorkspaceID:    doc.WorkspaceID,
					Actor:          actor,
					Action:         audit.ActionDocumentArchived,
					ResourceType:   "document",
					ResourceID:     id,
					Metadata:       map[string]any{"archive_batch_id": batch},
				},
				Events: []audit.Event{{Topic: "document.archived", Payload: map[string]string{
					"document_id": id, "workspace_id": doc.WorkspaceID, "archive_batch_id": batch,
				}}},
			})
		}
		if err := auditRecorder.RecordMany(ctx, q, recs); err != nil {
			return DocumentArchiveResult{}, err
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

// documentArchiveImpactTx is the FD-04 test seam: it runs inside the impact
// read transaction, after the subtree walk and before the bound check, the
// manage gate and the count, so a test can read the transaction's own
// isolation and access mode (SHOW transaction_isolation / transaction_read_only)
// or commit a writer in between and pin that the numbers still describe the
// one snapshot the walk opened. Never set in production.
var documentArchiveImpactTx func(ctx context.Context, tx pgx.Tx)

// DocumentArchiveImpact is what one ArchiveDocument of a subtree would move
// (FD-04, addendum §3.4): the shape the delete dialog warns with.
type DocumentArchiveImpact struct {
	// Folders and Documents count the live subtree WITHOUT the root, by kind:
	// a page inside a page counts as a document.
	Folders   int
	Documents int
	// Total is the rows the archive would stamp, the root included.
	Total int
	// MaxNodes is the bound one archive accepts.
	MaxNodes int
	// TooLarge replaces the counts when the subtree passes the bound; the
	// walk stopped after the bound, so no count is known and none is claimed.
	TooLarge bool
}

// ArchiveImpact answers what ArchiveDocument would do to a subtree without
// doing it. The checks run the archive command's own root gate (not found,
// owned, then manage - the same order, so the read can never show counts for a
// delete the command refuses), then the same bounded subtree walk, then the
// same manage gate on every node of that id set, then the count. All three
// steps after the root gate run in ONE REPEATABLE READ, read-only transaction:
// under READ COMMITTED each statement takes its own snapshot, and the promise
// that the ids, the access check and the numbers describe one moment would not
// hold. Reading writes nothing - no audit row, no event.
func (s *DocumentService) ArchiveImpact(ctx context.Context, actor Actor, documentID string) (DocumentArchiveImpact, error) {
	if !validActor(actor) || documentID == "" {
		return DocumentArchiveImpact{}, ErrNotFound
	}
	bound := s.archiveBound()
	out := DocumentArchiveImpact{MaxNodes: bound}
	// (1) the archive command's own root gate, in its order: an id the caller
	// cannot see is not found, an owned root is refused with
	// document_owned_by_work_product (so the dialog never shows counts for a
	// delete the command refuses), and only then must manage be held.
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentArchiveImpact{}, ErrNotFound
	}
	if err != nil {
		return DocumentArchiveImpact{}, err
	}
	access, err := s.effectiveLevel(ctx, s.q, actor, doc)
	if err != nil {
		return DocumentArchiveImpact{}, err
	}
	pristine, err := archiveRootGate(actor, doc, access)
	if err != nil {
		return DocumentArchiveImpact{}, err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return DocumentArchiveImpact{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	// (2) the same bounded walk as the archive command, one row past the
	// bound: the walk stops early, so an oversized subtree is refused before
	// any per-node work or count.
	live, err := q.ListLiveDocumentSubtreeIDs(ctx, db.ListLiveDocumentSubtreeIDsParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, RootID: doc.ID,
		MaxRows: int32(bound) + 1, MaxLevel: subtreeMaxLevel(),
	})
	if err != nil {
		return DocumentArchiveImpact{}, err
	}
	if documentArchiveImpactTx != nil {
		documentArchiveImpactTx(ctx, tx)
	}
	if len(live) > bound {
		out.TooLarge = true
		return out, nil
	}
	// The walk cannot sort (that would evaluate the whole CTE): sorting here
	// keeps the gate's refusal order as stable as the command's.
	sort.Strings(live)
	// (3) the archive command's own gate on exactly this id set: one node the
	// caller cannot manage refuses the whole read, and the body never carries
	// a number.
	// The pristine-copy root holds nothing under it (the command's own skip).
	if !pristine || len(live) != 1 || live[0] != doc.ID {
		if err := s.requireManageOnSubtree(ctx, q, actor, doc, live); err != nil {
			return DocumentArchiveImpact{}, err
		}
	}
	// (4) count on exactly that id set. page and file are both "documents" to
	// the dialog; the root is counted only in the total.
	rows, err := q.CountLiveDocumentSubtreeByKind(ctx, db.CountLiveDocumentSubtreeByKindParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Ids: live, RootID: doc.ID,
	})
	if err != nil {
		return DocumentArchiveImpact{}, err
	}
	for _, row := range rows {
		if row.Kind == DocumentKindFolder {
			out.Folders += int(row.N)
			continue
		}
		out.Documents += int(row.N)
	}
	out.Total = out.Folders + out.Documents + 1
	return out, nil
}

// RestoreDocument brings back exactly the batch the archive stamped. A node
// whose parent stayed in the trash (or was purged) re-roots itself so it is
// reachable again.
//
// Restore is not bounded like archive. A batch written since the bound exists
// holds at most documentArchiveMaxNodes nodes, so only a legacy batch (from
// before folders) could be larger, and refusing it would strand it in the
// trash: a restore cannot be done in parts. It stays cheap under the tree
// lock: the batch is read, cleared and audited in one statement each, the
// trivial manage rules are read off the rows, and only a node whose parent is
// outside the batch costs a parent lookup. What does scale with the batch is
// effectiveLevel for a node the caller manages only through a share.
func (s *DocumentService) RestoreDocument(ctx context.Context, actor Actor, documentID string, in ArchiveDocumentInput) (DocumentArchiveResult, error) {
	return s.documentBatchLifecycle(ctx, actor, documentID, in.IdempotencyKey, idempotencyScopeDocumentRestore, decideArchiveRootAccess, func(q *db.Queries, doc db.Document, access DocumentAccess) (DocumentArchiveResult, error) {
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
		if err := s.requireManageOnArchived(ctx, q, actor, members); err != nil {
			return DocumentArchiveResult{}, err
		}
		// The final parent of every member and the final name of every member
		// that lands in a live parent are decided while the rows are still
		// archived: the partial unique index of PR 2 only covers live rows, so
		// the batch is named first and cleared second, and an error on the way
		// leaves the whole batch in the trash (§3.3).
		names, err := s.restoreNames(ctx, q, doc, members)
		if err != nil {
			return DocumentArchiveResult{}, err
		}
		for _, n := range names {
			if n.title == n.member.Title && n.parentID == n.member.ParentID.String {
				continue // comes back exactly as it left: nothing to write
			}
			if !n.member.ParentID.Valid || n.parentID != "" {
				if _, err := q.RenameArchivedDocument(ctx, db.RenameArchivedDocumentParams{
					ID: n.member.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
					Title: n.title, SearchText: documentSearchText(n.title, n.member.ContentText),
					UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
				}); err != nil {
					return DocumentArchiveResult{}, err
				}
				continue
			}
			// A member whose parent did not come back with it re-roots itself:
			// parent, position and name in one write, so it is reachable again.
			if _, err := q.DetachDocumentToRoot(ctx, db.DetachDocumentToRootParams{
				ID: n.member.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
				Position: n.position, Title: n.title, SearchText: documentSearchText(n.title, n.member.ContentText),
				UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
			}); err != nil {
				return DocumentArchiveResult{}, err
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
		recs := make([]audit.Recorded, 0, len(restored))
		named := make(map[string]restoreName, len(names))
		for _, n := range names {
			named[n.member.ID] = n
		}
		for _, id := range restored {
			n := named[id]
			before, after := map[string]any{}, map[string]any{}
			if n.title != n.member.Title {
				before["title"], after["title"] = n.member.Title, n.title
			}
			if n.parentID != n.member.ParentID.String {
				before["parent_id"], after["parent_id"] = textOrNil(n.member.ParentID), textOrNil(nullText(n.parentID))
			}
			recs = append(recs, audit.Recorded{
				Entry: audit.Entry{
					OrganizationID: doc.OrganizationID,
					WorkspaceID:    doc.WorkspaceID,
					Actor:          actor,
					Action:         audit.ActionDocumentRestored,
					ResourceType:   "document",
					ResourceID:     id,
					Changes:        audit.Diff(before, after),
					Metadata:       map[string]any{"archive_batch_id": batch},
				},
				Events: []audit.Event{{Topic: "document.restored", Payload: map[string]string{
					"document_id": id, "workspace_id": doc.WorkspaceID, "archive_batch_id": batch,
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
		return DocumentArchiveResult{View: view, BatchID: batch, Affected: restored}, nil
	})
}

// restoreName is one batch member's final slot: the parent it comes back under
// ("" is the root), the position it takes there, and the name it comes back
// with. Both are decided while the row is still archived.
type restoreName struct {
	member   db.Document
	parentID string
	position float64
	title    string
}

// restoreNames decides the final parent and the final name of every member of a
// batch (§3.3).
//
// Parent: the batch root comes back under its old parent when that parent is
// live and outside the batch, and re-roots otherwise; every other member keeps
// its parent when the batch brings that parent back or when it is still live,
// and re-roots when it was purged or is still in the trash. A member that
// re-roots takes a fresh position at the end of the root list.
//
// Name: members are taken in the one stable order (final parent, position,
// created_at, id) and each name is compared against the live documents of its
// final parent and against the names this batch has already given out for that
// parent and kind - an old batch may hold a duplicate pair, and its second half
// moves aside rather than coming back as a duplicate.
func (s *DocumentService) restoreNames(ctx context.Context, q *db.Queries, root db.Document, members []db.Document) ([]restoreName, error) {
	inBatch := make(map[string]bool, len(members))
	for _, m := range members {
		inBatch[m.ID] = true
	}
	plan := make([]restoreName, 0, len(members))
	for _, m := range members {
		final := ""
		position := m.Position
		if m.ParentID.Valid && !inBatch[m.ParentID.String] {
			parent, err := q.GetDocument(ctx, db.GetDocumentParams{
				ID: m.ParentID.String, OrganizationID: root.OrganizationID, WorkspaceID: root.WorkspaceID,
			})
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				// Purged while the batch sat in the trash: re-root it.
			case err != nil:
				return nil, err
			case !parent.ArchivedAt.Valid:
				final = m.ParentID.String
			}
			if final == "" {
				pos, err := q.NextDocumentPosition(ctx, db.NextDocumentPositionParams{
					OrganizationID: root.OrganizationID, WorkspaceID: root.WorkspaceID, ParentID: pgtype.Text{},
				})
				if err != nil {
					return nil, err
				}
				position = pos
			}
		} else if m.ParentID.Valid {
			final = m.ParentID.String
		}
		plan = append(plan, restoreName{member: m, parentID: final, position: position, title: m.Title})
	}
	sort.SliceStable(plan, func(i, j int) bool {
		a, b := plan[i], plan[j]
		if a.parentID != b.parentID {
			return a.parentID < b.parentID
		}
		if a.position != b.position {
			return a.position < b.position
		}
		if !a.member.CreatedAt.Time.Equal(b.member.CreatedAt.Time) {
			return a.member.CreatedAt.Time.Before(b.member.CreatedAt.Time)
		}
		return a.member.ID < b.member.ID
	})
	// given holds, per (final parent, kind), the keys SQL computed for the
	// names this batch has already handed out: a later member collides with
	// them exactly as it collides with a live sibling, and the allocator skips
	// them.
	given := map[string]map[string]bool{}
	for i := range plan {
		group := plan[i].parentID + "\x00" + plan[i].member.Kind
		keys := given[group]
		if keys == nil {
			keys = map[string]bool{}
			given[group] = keys
		}
		scope := documentNameScope{
			OrganizationID: root.OrganizationID, WorkspaceID: root.WorkspaceID,
			ParentID: plan[i].parentID, Kind: plan[i].member.Kind,
		}
		rows, err := s.nameKeys(ctx, q, scope, []string{plan[i].title})
		if err != nil {
			return nil, err
		}
		if len(rows) != 1 {
			return nil, errors.New("documents: restore name lookup returned no row")
		}
		if rows[0].Taken || keys[rows[0].Key] {
			decision, err := s.allocateDocumentTitle(ctx, q, scope, plan[i].title, keys)
			if err != nil {
				return nil, err
			}
			plan[i].title = decision.Title
			rows[0].Key = decision.Key
		}
		keys[rows[0].Key] = true
	}
	return plan, nil
}

// decideArchiveRootAccess is the archive command's root decision, shared with
// the archive-impact read so the two can never drift: a caller with nothing
// readable is not found (never a confirmation of the id), an owned root is
// refused with document_owned_by_work_product, and only then must manage be
// held. The owned refusal sits between the two on purpose - an owned document
// is not the public archive path's business whatever level the caller holds, so
// the answer is 409 rather than the 403 a bare manage gate would give.
func decideArchiveRootAccess(doc db.Document, access DocumentAccess) error {
	if access.Level == DocumentLevelNone {
		// Nothing readable at all is not found - the owned refusal below
		// must never confirm an id to a caller who cannot see it.
		return ErrNotFound
	}
	if doc.OwnerKind.Valid {
		return errDocumentOwned()
	}
	return decideDocumentAccess(doc, access, DocumentLevelManage)
}

// pristineCopyCleanup is the one archive that does not need manage: the
// creator of a plain copy (POST /copies without a job) may trash it while it
// still holds only the bytes it was copied from. Save as a copy (G5-12)
// commits the user's bytes as version 2 and, when that commit fails, archives
// the half copy so server content never passes for the user's version - but
// the copy keeps the source's ACL owner, so its creator often holds only
// edit. Trashing a version-1 copy loses nothing the source does not hold,
// manage holders can still restore it, and no access is widened. Anything
// else - a second version, a converted copy, another editor, a creator who
// lost edit - keeps the manage gate.
func pristineCopyCleanup(actor Actor, doc db.Document, access DocumentAccess) bool {
	return actor.Kind == audit.KindHuman &&
		doc.CreatedBy == actor.ID && doc.CreatedByKind == string(audit.KindHuman) &&
		doc.Kind == DocumentKindFile && !doc.OwnerKind.Valid && !doc.ArchivedAt.Valid &&
		doc.SourceDocumentID.Valid && !doc.ConversionReason.Valid &&
		doc.CurrentVersion == 1 &&
		decideDocumentAccess(doc, access, DocumentLevelEdit) == nil
}

// archiveRootGate is the archive root gate ArchiveDocument and ArchiveImpact
// share, so the read can never refuse (or allow) a delete the command decides
// the other way: the pristine-copy exception first, then the manage gate.
// pristine tells the caller the exception applied, so it can skip the subtree
// manage check when the root is the whole live subtree.
func archiveRootGate(actor Actor, doc db.Document, access DocumentAccess) (pristine bool, err error) {
	if pristineCopyCleanup(actor, doc, access) {
		return true, nil
	}
	return false, decideArchiveRootAccess(doc, access)
}

// documentBatchLifecycle is the shared envelope of archive and restore: one
// transaction holding the ledger claim, the workspace tree lock and the
// document row lock, with the ACL evaluated under the row lock like every
// document command.
func (s *DocumentService) documentBatchLifecycle(
	ctx context.Context, actor Actor, documentID, idemKey, scope string,
	rootGate func(doc db.Document, access DocumentAccess) error,
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
	if err := rootGate(doc, access); err != nil {
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
// the caller's transaction. Returns the restored ids. The rows' own batch
// ids are read under row locks so each document.restored frame names the
// batch it actually left - a concurrent rearchive cannot move it between
// the read and the clear - and the update touches exactly the locked rows.
// A row archived before batches existed still emits the key, empty, like
// the public restore.
func (s *DocumentService) RestoreOwnedDocumentsInTx(ctx context.Context, q *db.Queries, actor Actor, organizationID, workspaceID, ownerID string) ([]string, error) {
	if ownerID == "" {
		return nil, Invalid("owner_id bắt buộc")
	}
	archived, err := q.LockArchivedDocumentsByOwner(ctx, db.LockArchivedDocumentsByOwnerParams{
		OrganizationID: organizationID, WorkspaceID: workspaceID, OwnerID: pgtype.Text{String: ownerID, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(archived))
	batchOf := make(map[string]string, len(archived))
	for _, r := range archived {
		ids = append(ids, r.ID)
		batchOf[r.ID] = r.ArchiveBatchID.String
	}
	var stamped []string
	if len(ids) > 0 {
		stamped, err = q.RestoreDocumentsByOwner(ctx, db.RestoreDocumentsByOwnerParams{
			OrganizationID: organizationID, WorkspaceID: workspaceID, OwnerID: pgtype.Text{String: ownerID, Valid: true},
			Ids: ids,
		})
		if err != nil {
			return nil, err
		}
	}
	for _, id := range stamped {
		batch := batchOf[id]
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: organizationID, WorkspaceID: workspaceID,
			Actor: actor, Action: audit.ActionDocumentRestored,
			ResourceType: "document", ResourceID: id,
			Metadata: map[string]any{"owner_id": ownerID, "archive_batch_id": batch},
		}, audit.Event{Topic: "document.restored", Payload: map[string]string{
			"document_id": id, "workspace_id": workspaceID, "archive_batch_id": batch,
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
	batch := util.NewID()
	stamped, err := q.ArchiveOwnedDocument(ctx, db.ArchiveOwnedDocumentParams{
		ID: documentID, OrganizationID: organizationID, WorkspaceID: workspaceID,
		ArchivedBy:     nullText(actor.ID),
		PurgeAfter:     pgtype.Timestamptz{Time: s.now().Add(documentRetentionDays * 24 * time.Hour), Valid: true},
		ArchiveBatchID: pgtype.Text{String: batch, Valid: true},
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
		Metadata: map[string]any{"seam": "owner", "archive_batch_id": batch},
	}, audit.Event{Topic: "document.archived", Payload: map[string]string{
		"document_id": stamped, "workspace_id": workspaceID, "archive_batch_id": batch,
	}}); err != nil {
		return false, err
	}
	return true, nil
}

// RestoreOwnedDocumentInTx restores one owned document inside the caller's
// transaction; false when it is not owned or not archived. The row lock is
// what makes the emitted batch id honest: a concurrent rearchive or restore
// of the same row waits for this transaction instead of moving the batch
// between the read and the clear.
func (s *DocumentService) RestoreOwnedDocumentInTx(ctx context.Context, q *db.Queries, actor Actor, organizationID, workspaceID, documentID string) (bool, error) {
	// Classify in-tenant without locking first so a foreign id never takes
	// a row lock outside its own workspace pair.
	if _, err := q.GetDocument(ctx, db.GetDocumentParams{
		ID: documentID, OrganizationID: organizationID, WorkspaceID: workspaceID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	before, err := q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	stamped, err := q.RestoreOwnedDocument(ctx, db.RestoreOwnedDocumentParams{
		ID: documentID, OrganizationID: organizationID, WorkspaceID: workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	metadata := map[string]any{"seam": "owner", "archive_batch_id": before.ArchiveBatchID.String}
	payload := map[string]string{"document_id": stamped, "workspace_id": workspaceID, "archive_batch_id": before.ArchiveBatchID.String}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: organizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionDocumentRestored,
		ResourceType: "document", ResourceID: stamped,
		Metadata: metadata,
	}, audit.Event{Topic: "document.restored", Payload: payload}); err != nil {
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
	// Keyset scans: a batch remembers the ordering key of its last row and
	// the next query starts after it, so rows that keep failing move the
	// sweep forward instead of pinning it on the first page forever.
	var afterAt pgtype.Timestamptz
	afterID := pgtype.Text{}
	for {
		if ctx.Err() != nil {
			return rep, ctx.Err()
		}
		batch, err := s.q.ListDocumentsForPurge(ctx, db.ListDocumentsForPurgeParams{
			Before:  pgtype.Timestamptz{Time: now, Valid: true},
			AfterAt: afterAt, AfterID: afterID,
			MaxRows: int32(documentSweepBatch),
		})
		if err != nil {
			return rep, err
		}
		if len(batch) == 0 {
			break
		}
		for _, d := range batch {
			if ctx.Err() != nil {
				return rep, ctx.Err()
			}
			purged, released, err := s.purgeOneDocument(ctx, d, now)
			if err != nil {
				rep.Failed++
				slog.Warn("documents purge: row failed, next sweep retries", "document", d.ID, "err", err)
			} else if purged {
				rep.Purged++
				rep.Released += released
			}
			afterAt = d.PurgeAfter
			afterID = pgtype.Text{String: d.ID, Valid: true}
		}
		if len(batch) < documentSweepBatch {
			break
		}
	}
	cutoff := now.Add(-documentAssetRetentionDays * 24 * time.Hour)
	afterAt = pgtype.Timestamptz{}
	afterID = pgtype.Text{}
	for {
		if ctx.Err() != nil {
			return rep, ctx.Err()
		}
		batch, err := s.q.ListOrphanedDocumentAssets(ctx, db.ListOrphanedDocumentAssetsParams{
			Before:  pgtype.Timestamptz{Time: cutoff, Valid: true},
			AfterAt: afterAt, AfterID: afterID,
			MaxRows: int32(documentSweepBatch),
		})
		if err != nil {
			return rep, err
		}
		if len(batch) == 0 {
			break
		}
		for _, a := range batch {
			if ctx.Err() != nil {
				return rep, ctx.Err()
			}
			purged, err := s.purgeOneAsset(ctx, a, cutoff)
			if err != nil {
				rep.Failed++
				slog.Warn("documents purge: asset row failed, next sweep retries", "asset", a.ID, "err", err)
			} else if purged {
				rep.AssetsPurged++
			}
			afterAt = a.OrphanedAt
			afterID = pgtype.Text{String: a.ID, Valid: true}
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
func (s *DocumentService) purgeOneDocument(ctx context.Context, d db.ListDocumentsForPurgeRow, now time.Time) (bool, int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	doc, err := q.LockDocumentByID(ctx, d.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, 0, nil
	}
	if err != nil {
		return false, 0, err
	}
	if !doc.ArchivedAt.Valid || !doc.PurgeAfter.Valid || !doc.PurgeAfter.Time.Before(now) {
		return false, 0, nil // restored or re-archived later while the scan was in flight
	}
	fileIDs, err := q.ListDocumentFileIDs(ctx, db.ListDocumentFileIDsParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil {
		return false, 0, err
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
		// The comment orbit goes in one order (G8-03): reactions (reached
		// through document_comments, which carries no document_id of its
		// own), mentions, revisions, then the comments themselves.
		func(ctx context.Context) error {
			return q.DeleteDocumentCommentReactionsByDocument(ctx, db.DeleteDocumentCommentReactionsByDocumentParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID})
		},
		func(ctx context.Context) error {
			return q.DeleteDocumentCommentMentionsByDocument(ctx, db.DeleteDocumentCommentMentionsByDocumentParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID})
		},
		func(ctx context.Context) error {
			return q.DeleteDocumentCommentRevisionsByDocument(ctx, db.DeleteDocumentCommentRevisionsByDocumentParams{
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
			return false, 0, err
		}
	}
	n, err := q.DeleteArchivedDocument(ctx, db.DeleteArchivedDocumentParams{
		ID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	})
	if err != nil {
		return false, 0, err
	}
	if n == 0 {
		return false, 0, nil // restored between lock and delete
	}
	released := []files.FileID{}
	for _, id := range fileIDs {
		if id.Valid {
			released = append(released, files.FileID(id.String))
		}
	}
	if err := s.files.ReleaseInTx(ctx, q, released); err != nil {
		return false, 0, err
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
		return false, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, 0, err
	}
	return true, len(released), nil
}

// purgeOneAsset removes one orphaned asset row past its grace and releases
// the file it names. A version that still references it (a restore can bring
// the reference back) keeps it. The grace check runs again under the
// document lock: a row referenced and re-orphaned between the scan and here
// gets a fresh orphaned_at and a fresh seven days.
func (s *DocumentService) purgeOneAsset(ctx context.Context, a db.ListOrphanedDocumentAssetsRow, cutoff time.Time) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	doc, err := q.LockDocumentByID(ctx, a.DocumentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if doc.ArchivedAt.Valid {
		return false, nil // the document's own purge takes the row with it
	}
	held, err := q.DocumentAssetHeldByVersion(ctx, db.DocumentAssetHeldByVersionParams{
		OrganizationID: a.OrganizationID, WorkspaceID: a.WorkspaceID, DocumentID: a.DocumentID, AssetID: pgtype.Text{String: a.ID, Valid: true},
	})
	if err != nil {
		return false, err
	}
	if held {
		return false, nil
	}
	asset, err := q.GetDocumentAsset(ctx, db.GetDocumentAssetParams{
		ID: a.ID, OrganizationID: a.OrganizationID, WorkspaceID: a.WorkspaceID, DocumentID: a.DocumentID,
	})
	if err != nil {
		return false, err
	}
	if !asset.OrphanedAt.Valid || !asset.OrphanedAt.Time.Before(cutoff) {
		return false, nil // referenced again, or orphaned anew inside the grace
	}
	n, err := q.DeleteDocumentAsset(ctx, db.DeleteDocumentAssetParams{
		ID: a.ID, OrganizationID: a.OrganizationID, WorkspaceID: a.WorkspaceID, DocumentID: a.DocumentID,
		OrphanedBefore: pgtype.Timestamptz{Time: cutoff, Valid: true},
	})
	if err != nil || n == 0 {
		return false, err
	}
	if asset.FileID != "" {
		if err := s.files.ReleaseInTx(ctx, q, []files.FileID{files.FileID(asset.FileID)}); err != nil {
			return false, err
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: a.OrganizationID,
		WorkspaceID:    a.WorkspaceID,
		Actor:          audit.System("documents.purge"),
		Action:         audit.ActionDocumentAssetPurged,
		ResourceType:   "document",
		ResourceID:     a.DocumentID,
		Metadata:       map[string]any{"asset_id": a.ID, "file_id": asset.FileID},
	}); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
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
	// Same keyset rule as the purge sweep: a document that cannot lose rows
	// (protected overflow, a failing delete) must move the scan forward.
	afterID := pgtype.Text{}
	for {
		if ctx.Err() != nil {
			return rep, ctx.Err()
		}
		batch, err := s.q.ListDocumentsOverVersionLimit(ctx, db.ListDocumentsOverVersionLimitParams{
			AfterID: afterID, Keep: int32(documentVersionKeep), MaxRows: int32(documentSweepBatch),
		})
		if err != nil {
			return rep, err
		}
		if len(batch) == 0 {
			break
		}
		for _, d := range batch {
			if ctx.Err() != nil {
				return rep, ctx.Err()
			}
			deleted, overflow, err := s.compactOneDocument(ctx, d.OrganizationID, d.WorkspaceID, d.DocumentID)
			if err != nil {
				rep.Failed++
				slog.Warn("documents compact: document failed, next sweep retries", "document", d.DocumentID, "err", err)
			} else if overflow {
				rep.ProtectedOverflow++
			} else if deleted > 0 {
				rep.Compacted++
				rep.VersionsDeleted += deleted
			}
			afterID = pgtype.Text{String: d.DocumentID, Valid: true}
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
	doc, err := q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
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
		s.metrics.IncDocumentVersionsProtectedOverflow()
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
		CurrentVersion: doc.CurrentVersion,
	})
	if err != nil {
		return 0, false, err
	}
	if len(dropped) == 0 {
		// Nothing left to drop - the over-count sits on protected rows, or
		// every droppable auto is current_version. No state changed, so no
		// audit row either.
		return 0, false, tx.Commit(ctx)
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
