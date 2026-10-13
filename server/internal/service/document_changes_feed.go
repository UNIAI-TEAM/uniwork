package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The incremental change feed (G5-01b, UNI-1346; spec 4.1, contract-p0 7.1).
//
// A cold-start snapshot (G5-01a) materialises the documents a caller could
// read at one MVCC point and hands out a feed cursor carrying that point's
// high-water mark. This file serves every page after it: the commits the
// snapshot did not see, in commit order, exactly once, and never a change the
// caller could not read.
//
// # Position
//
// The position is the transaction id of the audit row every document command
// already writes in its own transaction (ADR 0009), stored as
// audit_events.xact_id. audit_events is append-only (the no-update trigger),
// so a row's transaction id never moves: it is a stable commit-order keyset.
// ULIDs and created_at are NOT commit ordered - a ULID minted before a slow
// commit sorts below rows that committed first - so neither can be a position.
//
// A change is "after the snapshot" when its xact_id is not visible in the
// snapshot's high-water mark (pg_visible_in_snapshot is false), which covers
// both a transaction that committed after the snapshot and one that was still
// in flight when the snapshot began. The second case must be carried (it is
// absent from the snapshot's items), but only once it has actually committed:
// the query also requires xact_id < pg_snapshot_xmin(pg_current_snapshot()), so
// a transaction still in flight at read time is held back for a later page
// instead of being handed to a client that would then advance past it. That is
// the in-progress-xid guard: no commit is skipped, and no page names a change
// whose commit could still roll back. The guard also makes the keyset safe: a
// page only ever advances past xact_ids below the read's xmin, and no row can
// later appear below that mark with a lower xact_id, so no gap opens behind the
// cursor.
//
// The column is young. audit_events.xact_id was added by migration
// 9991791830000300 and is NULL on every row written before it; commits between
// such a cursor's high-water mark and the column's default can never be
// delivered. The epoch row of migration 9991791830000302 records the xid from
// which the column is filled, and a high-water mark that cannot see it answers
// 410 change_cursor_expired - one cold start, never a feed with a hole in it.
//
// # Kinds and visibility
//
// One audit row does not say what happened: the feed reads the document's
// current row to decide. A live document in this workspace is an upsert (its
// revision may have moved for content OR metadata only - OQ-P1(b): the client
// rebases base_revision while version_id is unchanged). A missing document is
// a tombstone. An archived document is an upsert carrying archived=true, so
// archive and restore stay distinct from delete. A document that moved to
// another workspace of the same organization is a removal for this workspace.
// A change the caller cannot read now is a removal, but only to someone who
// could read the document at the snapshot's point - someone who never had
// access learns nothing about it, not even that it exists. A grant (a share
// that admits the caller, a visibility change that opens a document) needs no
// history: a document the caller can read now is an upsert whether or not the
// snapshot held it.
//
// Work Product documents are BLOCKED until C-14 (spec 11): their level is the
// owner resolver's answer alone (C-01 13.4), that resolver is not on this root
// (document_owner.go is only the seam and defaults to deny), and no ACL of our
// own is built here - see feedRowLevel.
//
// DocumentChangeFeedTTL is how long a feed cursor stays valid: the incremental
// feed retention (contract-p0 G5-D2 owns the production number). audit_events
// is never deleted (ADR 0012), so this TTL, not a retention sweep, is the
// boundary past which a cursor answers 410 change_cursor_expired.
const DocumentChangeFeedTTL = DocumentChangeFeedCursorTTL

// # Removal payload
//
// A removal is ids only: document id, revision and the removal reason. No
// name, no path, no metadata (spec 4.1).

// Removal reasons (the removal row's kind, spec 4.1).
const (
	// DocumentChangeRemovalDeleted is a hard delete or a purge: the document
	// row is gone. The client stops replaying and does not resurrect it.
	DocumentChangeRemovalDeleted = "document_deleted"
	// DocumentChangeRemovalPermissionRevoked is a lost read level (a revoked
	// share, a visibility change, a demotion): the document exists but the
	// caller may not read it any more.
	DocumentChangeRemovalPermissionRevoked = "permission_revoked"
	// DocumentChangeRemovalMovedWorkspace is a move to another workspace of
	// the same organization: the document left this workspace's library.
	DocumentChangeRemovalMovedWorkspace = "moved_workspace"
)

// Change kinds (the row's change_kind on the wire).
const (
	// DocumentChangeKindUpsert is a created, updated, restored, granted or
	// moved-in document: the client applies the row.
	DocumentChangeKindUpsert = "upsert"
	// DocumentChangeKindRemoval is a document that left the caller's feed.
	DocumentChangeKindRemoval = "removal"
)

// feedDocumentActions is the set of document.* audit actions that change what
// a caller's library holds. Content and metadata edits, version commits,
// moves, archive/restore, the retention purge and the two share commands
// (a grant makes a document readable - an upsert for the new reader; a revoke
// takes it away - a removal for the old one) all land here. A read (the access
// log) changes nothing, and comment, favorite, link and settings rows carry no
// library state this feed serves.
var feedDocumentActions = map[string]bool{
	"document.created":          true,
	"document.updated":          true,
	"document.version_created":  true,
	"document.version_restored": true,
	"document.moved":            true,
	"document.archived":         true,
	"document.restored":         true,
	"document.deleted":          true,
	"document.asset_uploaded":   true,
	"document.shared":           true,
	"document.share_revoked":    true,
}

// DocumentChangeFeedRow is one incremental-feed row. It carries ids, the
// document kind and revision and version pointer (upsert) or the removal
// reason (removal) - never a title, path or content.
type DocumentChangeFeedRow struct {
	DocumentID string
	// ChangeKind is DocumentChangeKindUpsert or DocumentChangeKindRemoval.
	ChangeKind string
	// Kind is the document kind on an upsert (page/file/folder); empty on a
	// removal, whose reason lives in Removal so this field keeps one meaning.
	Kind string
	// Revision is the document's revision; zero on a hard-delete tombstone,
	// whose row is gone.
	Revision int64
	// CurrentVersion and FileVersionID are the upsert's version pointer; the
	// client rebases base_revision from Revision and treats only a changed
	// FileVersionID as new content (OQ-P1(b)).
	CurrentVersion int32
	FileVersionID  string
	// Archived marks an archived document: still an upsert, so archive and
	// restore are distinct from delete.
	Archived bool
	// Removal is the reason; empty on an upsert.
	Removal string
}

// DocumentChangeFeedLagMetrics records the feed's lag: the age of the oldest
// eligible change the feed had not delivered when a page was served (zero once
// a page caught the caller up). metrics.OfficeChangeFeed implements it.
type DocumentChangeFeedLagMetrics interface {
	ObserveDocumentChangeFeedLag(seconds float64)
}

// pageFeed serves one incremental-feed page from claims.HighWater, continuing
// after the (AfterXact, AfterID) keyset when set.
func (s *DocumentChangesService) pageFeed(ctx context.Context, cs changeCursorScope, claims changeCursorClaims, limit int32) (DocumentChangePage, error) {
	tx, err := s.docs.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: s.isoLevel(), AccessMode: pgx.ReadOnly})
	if err != nil {
		return DocumentChangePage{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.docs.q.WithTx(tx)

	// A high-water mark that cannot see the feed epoch was taken before the
	// xact_id column existed, so commits between it and the column's default
	// have no position and could never reach the feed: answer 410 and let the
	// client cold-start against the column, never a feed with a hole in it.
	seen, err := q.ChangeFeedEpochSeen(ctx, claims.HighWater)
	if err != nil {
		return DocumentChangePage{}, err
	}
	if !seen {
		return DocumentChangePage{}, ErrChangeCursorExpired
	}

	rows, err := q.ListDocumentChangeFeed(ctx, db.ListDocumentChangeFeedParams{
		OrganizationID: cs.organization, WorkspaceID: pgtype.Text{String: cs.workspace, Valid: true},
		HighWater: claims.HighWater, AfterXact: claims.AfterXact, AfterID: claims.AfterID,
		PageLimit: limit + 1,
	})
	if err != nil {
		return DocumentChangePage{}, err
	}
	// The keyset advances over every audit row READ, filtered or not, so a page
	// whose rows are all filtered out for this caller still hands out a cursor
	// past them and can never repeat the same cursor forever. It is the last
	// row this page DELIVERS: the one-row probe that only proves more follows
	// stays for the next page.
	if len(rows) > int(limit) {
		rows = rows[:limit]
	}
	lastXact, lastID := claims.AfterXact, claims.AfterID
	if len(rows) > 0 {
		last := rows[len(rows)-1]
		lastXact, lastID = last.XactID, last.ID
	}

	feed, err := s.feedRows(ctx, q, cs, claims.SnapshotID, rows)
	if err != nil {
		return DocumentChangePage{}, err
	}

	// What the feed still owes after the position this page hands out. The
	// count decides has_more exactly: a change held back because its
	// transaction was still in flight at read time, or one beyond this page,
	// keeps the client paging instead of stopping one poll short. Rows read is
	// zero exactly when pending is zero (same predicate), so a page that read
	// nothing ends instead of repeating its cursor. The age is the lag metric.
	pending, err := q.DocumentChangeFeedPending(ctx, db.DocumentChangeFeedPendingParams{
		OrganizationID: cs.organization, WorkspaceID: pgtype.Text{String: cs.workspace, Valid: true},
		HighWater: claims.HighWater, AfterXact: lastXact, AfterID: lastID,
	})
	if err != nil {
		return DocumentChangePage{}, err
	}
	if s.feedLag != nil {
		s.feedLag.ObserveDocumentChangeFeedLag(pending.LagSeconds)
	}

	out := DocumentChangePage{Phase: changeCursorPhaseFeed, Feed: feed, HasMore: pending.Pending > 0}
	out.ExpiresAt = s.now().Add(DocumentChangeFeedTTL)
	next := changeCursorClaims{
		Protocol: DocumentChangeProtocol, Deployment: cs.deployment, UserID: cs.userID,
		Organization: cs.organization, Workspace: cs.workspace,
		Phase: changeCursorPhaseFeed, HighWater: claims.HighWater,
		AfterXact: lastXact, AfterID: lastID, ExpiresAt: out.ExpiresAt.Unix(),
	}
	if out.NextCursor, err = s.codec.sign(next); err != nil {
		return DocumentChangePage{}, err
	}
	return out, nil
}

// feedRowLevel is the level one feed row's document resolves to for the
// scope's actor. A Work Product document resolves to none until C-14 lands:
// its level is the owner resolver's answer alone (C-01 13.4), document_owner.go
// is only the default-deny seam - no production resolver is wired on this root
// - and the fan-out is BLOCKED, not built here (spec 11). The generic branches
// in feedRows then treat an owned document as unreadable: a former reader gets
// the ids-only removal, a stranger gets nothing.
func feedRowLevel(scope documentListScope, doc db.Document, shares []db.ListLiveSharesForDocumentsRow) DocumentLevel {
	if doc.OwnerID.Valid {
		return DocumentLevelNone
	}
	return listRowAccess(scope, false, doc, shares).Level
}

// feedRows turns one page's audit rows into feed rows. It reads the documents
// in one query, the snapshot's readable set in one query and the page's live
// shares in one query, so the cost is per page, not per row.
func (s *DocumentChangesService) feedRows(ctx context.Context, q *db.Queries, cs changeCursorScope, snapshotID string, rows []db.ListDocumentChangeFeedRow) ([]DocumentChangeFeedRow, error) {
	ids := make([]string, 0, len(rows))
	seen := make(map[string]bool, len(rows))
	for _, r := range rows {
		if !feedDocumentActions[r.Action] || seen[r.ResourceID] {
			continue
		}
		seen[r.ResourceID] = true
		ids = append(ids, r.ResourceID)
	}
	if len(ids) == 0 {
		return []DocumentChangeFeedRow{}, nil
	}
	docs, err := q.ListDocumentsForChangeFeed(ctx, db.ListDocumentsForChangeFeedParams{
		OrganizationID: cs.organization, Ids: ids,
	})
	if err != nil {
		return nil, err
	}
	byID := make(map[string]db.Document, len(docs))
	for _, d := range docs {
		byID[d.ID] = d
	}
	readable, err := s.readableAtSnapshot(ctx, q, cs, snapshotID, ids)
	if err != nil {
		return nil, err
	}
	scope, err := s.feedScope(ctx, q, cs)
	if err != nil {
		return nil, err
	}
	shares, err := q.ListLiveSharesForDocuments(ctx, db.ListLiveSharesForDocumentsParams{
		OrganizationID: cs.organization, WorkspaceID: cs.workspace, DocumentIds: ids,
	})
	if err != nil {
		return nil, err
	}
	shareByDoc := make(map[string][]db.ListLiveSharesForDocumentsRow, len(shares))
	for _, sh := range shares {
		shareByDoc[sh.DocumentID] = append(shareByDoc[sh.DocumentID], sh)
	}

	out := make([]DocumentChangeFeedRow, 0, len(ids))
	for _, id := range ids {
		doc, ok := byID[id]
		switch {
		case !ok:
			// The row is gone entirely: a hard delete / purge. The tombstone
			// is ids only - id and reason, no revision, no name.
			if readable[id] {
				out = append(out, DocumentChangeFeedRow{
					DocumentID: id, ChangeKind: DocumentChangeKindRemoval, Removal: DocumentChangeRemovalDeleted,
				})
			}
		case doc.WorkspaceID != cs.workspace:
			// The document now lives in another workspace of this
			// organization: leaving is a removal here, and it names neither
			// the target workspace nor anything about the document.
			if readable[id] {
				out = append(out, DocumentChangeFeedRow{
					DocumentID: id, ChangeKind: DocumentChangeKindRemoval, Revision: doc.Revision,
					Removal: DocumentChangeRemovalMovedWorkspace,
				})
			}
		case !feedRowLevel(scope, doc, shareByDoc[id]).AtLeast(DocumentLevelView):
			// The caller cannot read it now: a revoked share, a visibility
			// change, a demotion, or a document that became a Work Product's
			// (feedRowLevel). A removal only to someone who could read it at
			// the snapshot's point; a stranger learns nothing about it.
			if readable[id] {
				out = append(out, DocumentChangeFeedRow{
					DocumentID: id, ChangeKind: DocumentChangeKindRemoval, Revision: doc.Revision,
					Removal: DocumentChangeRemovalPermissionRevoked,
				})
			}
		default:
			// Readable now: an upsert, whether the snapshot held it (an
			// update) or not (a grant). The version pointer tells the client
			// content from a metadata-only revision bump (OQ-P1(b)).
			out = append(out, DocumentChangeFeedRow{
				DocumentID: id, ChangeKind: DocumentChangeKindUpsert, Kind: doc.Kind,
				Revision: doc.Revision, CurrentVersion: doc.CurrentVersion,
				FileVersionID: doc.FileVersionID.String, Archived: doc.ArchivedAt.Valid,
			})
		}
	}
	return out, nil
}

// readableAtSnapshot answers which of the candidate ids the caller's snapshot
// held. The snapshot items were materialised at the snapshot's MVCC point, so
// they are exactly what the caller could read then. A swept snapshot row
// answers nothing, which under-sends a removal but never leaks one.
func (s *DocumentChangesService) readableAtSnapshot(ctx context.Context, q *db.Queries, cs changeCursorScope, snapshotID string, ids []string) (map[string]bool, error) {
	out := map[string]bool{}
	if snapshotID == "" {
		return out, nil
	}
	found, err := q.ReadableAtSnapshotIDs(ctx, db.ReadableAtSnapshotIDsParams{
		SnapshotID: snapshotID, OrganizationID: cs.organization, WorkspaceID: cs.workspace, Ids: ids,
	})
	if err != nil {
		return nil, err
	}
	for _, id := range found {
		out[id] = true
	}
	return out, nil
}

// feedScope resolves the caller's list scope against the workspace the feed
// page serves, read through the page's own transaction so the access decision
// and the rows share one snapshot.
func (s *DocumentChangesService) feedScope(ctx context.Context, q *db.Queries, cs changeCursorScope) (documentListScope, error) {
	w, err := q.GetWorkspaceByID(ctx, cs.workspace)
	if errors.Is(err, pgx.ErrNoRows) {
		return documentListScope{}, ErrNotFound
	}
	if err != nil {
		return documentListScope{}, err
	}
	return s.docs.documentListScopeForWorkspace(ctx, q, Human(cs.userID), cs.workspace, w)
}
