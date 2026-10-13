package service

import (
	"context"
	"encoding/json"
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
// The guard has a known stall: pg_snapshot_xmin is held back by the OLDEST
// open transaction (a migration, a backup, a stuck reader), so for as long as
// one old transaction stays open every later commit is ineligible and the feed
// serves nothing. No commit is skipped - the cursor keeps its place - and the
// stall is observable: DocumentChangeFeedPending counts the held-back rows
// (has_more stays true, BE-G1-3) and reports the age as the lag gauge; the
// Office engine runbook names it (BE-G1-5).
//
// # Kinds and visibility
//
// One audit row does not say what happened: the feed reads the document's
// current row to decide. A live document in this workspace the caller can read
// now is an upsert (its revision may have moved for content OR metadata only -
// OQ-P1(b): the client rebases base_revision while version_id is unchanged; a
// grant is an upsert too, whether or not the snapshot held the document). An
// archived document is an upsert carrying archived=true, so archive and
// restore stay distinct from delete.
//
// A removal (delete, move-away, revoke, visibility demotion, becoming
// Work-Product-owned) reaches a caller iff the caller could read the document
// IMMEDIATELY BEFORE the removing change, decided by the existing read gate
// (listRowAccess through feedRowLevel - never an ACL of our own, BE-G1-1,
// BE-G1-2) applied to the state the removal left behind:
//
//   - move-away: the row and its live share rows survive the move; the gate is
//     evaluated ignoring the moved marker - the caller's membership in THIS
//     workspace and the shares still hanging on the row decide it.
//   - revoke (document.share_revoked): the share row is gone, but the audit row
//     names the revoked principal and its prior level (metadata
//     principal_type/principal_id/level). The caller must BE that principal (a
//     user, a workspace they are in, or their organization) and must not read
//     through any other path now. A caller who still reads another way gets the
//     upsert, never a removal.
//   - visibility demotion (document.settings_changed): the prior visibility
//     comes from the audit row (metadata.visibility, or changes.visibility.from
//     when the command writes the diff). A member the prior visibility admitted
//     and the current one refuses gets the removal.
//   - becoming Work-Product-owned: the owner resolver is NOT on this root
//     (document_owner.go is only the default-deny seam), so the level is none
//     for everyone (spec 11, BLOCKED; see feedRowLevel). The current row no
//     longer carries the pre-change owner state, so the caller's snapshot-held
//     evidence decides: held -> the ids-only removal; not held and nothing
//     granted them on the page -> nothing; no evidence -> 410 (below).
//   - delete: document.deleted is the RETENTION PURGE - it deletes the row, its
//     shares and its versions in one transaction, so the state immediately
//     before the removal is gone. The cursor's snapshot is the only surviving
//     evidence, and it cannot prove the state right before the purge: the feed
//     answers 410 change_cursor_expired whenever the purge may concern the
//     cursor (never a silent skip, never a removal to unproven readers). The
//     trash purge retention (documentRetentionDays = 30 days) exceeds the feed
//     cursor TTL (DocumentChangeFeedTTL = 7 days), so a real purge cannot catch
//     a still-valid cursor that held the document live; the 410 paths are the
//     defensive answer for a swept snapshot, a pre-fix cursor with no snapshot
//     id, or a granting action on the page that may have admitted the caller
//     after the snapshot.
//
// Someone who never had access learns nothing about a document, not even that
// it exists: every removal branch proves a prior level or, where the removing
// change destroyed the proof, forces a resync (410) instead of guessing.
//
// Work Product documents stay BLOCKED until C-14 (spec 11): their level is the
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
// moves, archive/restore, the retention purge and the share commands (a grant
// makes a document readable - an upsert for the new reader; a revoke takes it
// away - a removal for the old one) all land here, plus a document-level
// visibility change (document.settings_changed; the organization-level
// public-links switch carries resource_type organization and never reaches
// this query). A read (the access log) changes nothing, and comment, favorite
// and link rows carry no library state this feed serves.
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
	"document.settings_changed": true,
}

// feedGrantActions are the actions that can make a document readable to
// someone: a document created (its creator reads it) or a share granted. One
// of these on the page means a caller's readership cannot be proven to predate
// their snapshot, so a removal whose evidence the change destroyed (a purge, a
// document becoming an owner's) answers 410 instead of guessing.
var feedGrantActions = map[string]bool{
	"document.created": true,
	"document.shared":  true,
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
	// count decides has_more exactly: it includes a change held back because
	// its transaction was still in flight at read time (the query drops the
	// page read's in-flight guard on purpose, BE-G1-3) and one beyond this
	// page, so the client keeps paging instead of stopping one poll short. A
	// page that read nothing can therefore still report has_more with an
	// unchanged position - the held-back change is delivered once its
	// transaction settles. The age is the lag metric.
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
		// The snapshot id rides along as evidence availability for the two
		// removal kinds whose pre-change state the change itself destroys
		// (purge, becoming Work-Product-owned): it is never the permission
		// decision (BE-G1-1/BE-G1-2). A pre-fix cursor without it answers 410
		// where that evidence would be needed.
		SnapshotID: claims.SnapshotID,
		AfterXact:  lastXact, AfterID: lastID, ExpiresAt: out.ExpiresAt.Unix(),
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
// - and the fan-out is BLOCKED, not built here (spec 11). The owned branch of
// resolveFeedRow then treats an owned document as unreadable: a caller the
// snapshot proves read it before it became owned gets the ids-only removal, a
// stranger gets nothing.
func feedRowLevel(scope documentListScope, doc db.Document, shares []db.ListLiveSharesForDocumentsRow) DocumentLevel {
	if doc.OwnerID.Valid {
		return DocumentLevelNone
	}
	return listRowAccess(scope, false, doc, shares).Level
}

// feedCandidate is one document's audit rows on one page, in xact order: the
// actions that can change what a caller's library holds and the audit fields
// the prior-reader reconstruction reads.
type feedCandidate struct {
	actions  []string
	metadata []map[string]any
	changes  []map[string]any
}

// feedRows turns one page's audit rows into feed rows. It reads the documents,
// the snapshot evidence and the page's live shares in one query each, so the
// cost is per page, not per row.
func (s *DocumentChangesService) feedRows(ctx context.Context, q *db.Queries, cs changeCursorScope, snapshotID string, rows []db.ListDocumentChangeFeedRow) ([]DocumentChangeFeedRow, error) {
	cands := make(map[string]*feedCandidate, len(rows))
	order := make([]string, 0, len(rows))
	for _, r := range rows {
		if !feedDocumentActions[r.Action] {
			continue
		}
		c, ok := cands[r.ResourceID]
		if !ok {
			c = &feedCandidate{}
			cands[r.ResourceID] = c
			order = append(order, r.ResourceID)
		}
		c.actions = append(c.actions, r.Action)
		c.metadata = append(c.metadata, decodeAuditObject(r.Metadata))
		c.changes = append(c.changes, decodeAuditObject(r.Changes))
	}
	if len(order) == 0 {
		return []DocumentChangeFeedRow{}, nil
	}
	docs, err := q.ListDocumentsForChangeFeed(ctx, db.ListDocumentsForChangeFeedParams{
		OrganizationID: cs.organization, Ids: order,
	})
	if err != nil {
		return nil, err
	}
	byID := make(map[string]db.Document, len(docs))
	for _, d := range docs {
		// Only the columns ListDocumentsForChangeFeed selects exist here
		// (BE-G1-6); the feed never reads content.
		byID[d.ID] = db.Document{
			ID: d.ID, OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
			Kind: d.Kind, Revision: d.Revision, CurrentVersion: d.CurrentVersion,
			FileVersionID: d.FileVersionID, ArchivedAt: d.ArchivedAt,
			OwnerID: d.OwnerID, Visibility: d.Visibility, AclOwnerID: d.AclOwnerID,
		}
	}
	held, haveEvidence, err := s.snapshotEvidence(ctx, q, cs, snapshotID, order)
	if err != nil {
		return nil, err
	}
	scope, err := s.feedScope(ctx, q, cs)
	if err != nil {
		return nil, err
	}
	shares, err := q.ListLiveSharesForDocuments(ctx, db.ListLiveSharesForDocumentsParams{
		OrganizationID: cs.organization, WorkspaceID: cs.workspace, DocumentIds: order,
	})
	if err != nil {
		return nil, err
	}
	shareByDoc := make(map[string][]db.ListLiveSharesForDocumentsRow, len(shares))
	for _, sh := range shares {
		shareByDoc[sh.DocumentID] = append(shareByDoc[sh.DocumentID], sh)
	}

	out := make([]DocumentChangeFeedRow, 0, len(order))
	for _, id := range order {
		doc, found := byID[id]
		row, deliver, err := resolveFeedRow(cs, scope, cands[id], doc, found, shareByDoc[id], held[id], haveEvidence)
		if err != nil {
			return nil, err
		}
		if deliver {
			out = append(out, row)
		}
	}
	return out, nil
}

// resolveFeedRow answers one document's page window: the row to deliver (if
// any), or ErrChangeCursorExpired when the removing change destroyed the
// evidence its removal needs and the caller cannot be proven a non-reader.
func resolveFeedRow(cs changeCursorScope, scope documentListScope, c *feedCandidate, doc db.Document, found bool, shares []db.ListLiveSharesForDocumentsRow, held, haveEvidence bool) (DocumentChangeFeedRow, bool, error) {
	switch {
	case !found:
		return purgeAnswer(c, held, haveEvidence)
	case doc.WorkspaceID != cs.workspace:
		// Move-away: the row and its live share rows survive the move, so the
		// existing gate answers the pre-change question. The moved marker is
		// ignored and the membership leg is THIS workspace's - the one the
		// caller's scope was resolved for.
		if feedRowLevel(scope, doc, shares).AtLeast(DocumentLevelView) {
			return removalRow(doc.ID, doc.Revision, DocumentChangeRemovalMovedWorkspace), true, nil
		}
		return DocumentChangeFeedRow{}, false, nil
	case feedRowLevel(scope, doc, shares).AtLeast(DocumentLevelView):
		// Readable now: an upsert, whether the snapshot held it (an update) or
		// not (a grant). The version pointer tells the client content from a
		// metadata-only revision bump (OQ-P1(b)).
		return upsertRow(doc), true, nil
	default:
		// Not readable now. Only a change that itself took a level away can
		// owe a removal, and its audit row names the prior reader.
		revoked, undecided := removalByAudit(c, scope, cs.userID)
		if undecided {
			return DocumentChangeFeedRow{}, false, ErrChangeCursorExpired
		}
		if revoked {
			return removalRow(doc.ID, doc.Revision, DocumentChangeRemovalPermissionRevoked), true, nil
		}
		if doc.OwnerID.Valid {
			return ownedAnswer(doc, c, held, haveEvidence)
		}
		// The change did not remove a level (an edit, an archive, a
		// same-workspace move, a restore): the caller could not read before it
		// either, so nothing is owed and nothing is revealed.
		return DocumentChangeFeedRow{}, false, nil
	}
}

func upsertRow(doc db.Document) DocumentChangeFeedRow {
	return DocumentChangeFeedRow{
		DocumentID: doc.ID, ChangeKind: DocumentChangeKindUpsert, Kind: doc.Kind,
		Revision: doc.Revision, CurrentVersion: doc.CurrentVersion,
		FileVersionID: doc.FileVersionID.String, Archived: doc.ArchivedAt.Valid,
	}
}

func removalRow(id string, revision int64, reason string) DocumentChangeFeedRow {
	return DocumentChangeFeedRow{
		DocumentID: id, ChangeKind: DocumentChangeKindRemoval, Revision: revision, Removal: reason,
	}
}

// purgeAnswer answers a candidate whose document row is gone: document.deleted
// is the retention purge, which deleted the row, its shares and its versions in
// the same transaction. The state immediately before the removal cannot be
// reconstructed, and the cursor's snapshot only proves readership at the
// snapshot's point:
//
//   - no snapshot evidence (swept source, or a pre-fix cursor without a
//     snapshot id): the removal may concern this cursor -> 410;
//   - held by the snapshot: the cursor may have seen the document and nothing
//     survives to prove the immediate pre-purge state -> 410 (never a silent
//     skip, never a removal to an unproven reader);
//   - a granting action on the page (created/shared) for the id and not held:
//     the caller may have become a reader after the snapshot -> 410;
//   - not held and nothing granted it on the page: the caller provably held
//     nothing and gained nothing, so no removal is due - the cursor advances.
func purgeAnswer(c *feedCandidate, held, haveEvidence bool) (DocumentChangeFeedRow, bool, error) {
	switch {
	case !haveEvidence, held, feedCandidateHasGrant(c):
		return DocumentChangeFeedRow{}, false, ErrChangeCursorExpired
	default:
		return DocumentChangeFeedRow{}, false, nil
	}
}

// ownedAnswer answers a document that is now a Work Product's. Its level
// resolves to none for everyone until C-14 (feedRowLevel), and the owner change
// overwrote the pre-change owner state, so the snapshot-held evidence decides a
// former reader: held -> the ids-only removal; not held with nothing granting
// the caller on the page -> nothing; anything else -> 410.
func ownedAnswer(doc db.Document, c *feedCandidate, held, haveEvidence bool) (DocumentChangeFeedRow, bool, error) {
	switch {
	case !haveEvidence:
		return DocumentChangeFeedRow{}, false, ErrChangeCursorExpired
	case held:
		return removalRow(doc.ID, doc.Revision, DocumentChangeRemovalPermissionRevoked), true, nil
	case feedCandidateHasGrant(c):
		return DocumentChangeFeedRow{}, false, ErrChangeCursorExpired
	default:
		return DocumentChangeFeedRow{}, false, nil
	}
}

// feedCandidateHasGrant answers whether any row on the page can have granted
// the caller a level on this document (a create or a share).
func feedCandidateHasGrant(c *feedCandidate) bool {
	for _, action := range c.actions {
		if feedGrantActions[action] {
			return true
		}
	}
	return false
}

// removalByAudit answers whether a row on the page itself proves the caller
// lost a level they held: a share revoke of a principal that admitted them
// (metadata principal_type/principal_id), or a visibility demotion whose prior
// visibility did. undecided is true for a demotion row that does not name the
// prior visibility: the removal may be due and cannot be proven either way, so
// the caller answers 410 (never a silent skip).
func removalByAudit(c *feedCandidate, scope documentListScope, userID string) (removed, undecided bool) {
	for i, action := range c.actions {
		switch action {
		case "document.share_revoked":
			if feedShareAdmitsActor(c.metadata[i], scope, userID) {
				return true, false
			}
		case "document.settings_changed":
			prior, ok := feedPriorVisibility(c, i)
			if !ok {
				return false, true
			}
			if scope.memberVisible && prior != documentVisibilityRestricted {
				return true, false
			}
		}
	}
	return false, false
}

// feedPriorVisibility reads the visibility in force before a settings change:
// metadata.visibility (what a document-level command should write), or the
// audit diff's changes.visibility.from/before. Missing means the prior state
// cannot be reconstructed.
func feedPriorVisibility(c *feedCandidate, i int) (string, bool) {
	if v := auditString(c.metadata[i], "visibility"); v != "" {
		return v, true
	}
	diff, ok := c.changes[i]["visibility"].(map[string]any)
	if !ok {
		return "", false
	}
	if v := auditString(diff, "from"); v != "" {
		return v, true
	}
	if v := auditString(diff, "before"); v != "" {
		return v, true
	}
	return "", false
}

// feedShareAdmitsActor answers whether one revoked share's principal admitted
// the caller: the same legs listShareApplies applies to a live row, read from
// the audit metadata the revoking command writes.
func feedShareAdmitsActor(md map[string]any, scope documentListScope, userID string) bool {
	switch auditString(md, "principal_type") {
	case DocumentPrincipalUser:
		return auditString(md, "principal_id") == userID
	case DocumentPrincipalWorkspace:
		id := auditString(md, "principal_id")
		for _, w := range scope.shareWorkspaces {
			if w == id {
				return true
			}
		}
	case DocumentPrincipalOrganization:
		return auditString(md, "principal_id") == scope.organizationID
	}
	return false
}

// snapshotEvidence answers which candidate ids the caller's snapshot held, and
// whether that evidence still exists. The sweeper deletes the snapshot row and
// its items in one transaction, so the row's existence is the availability
// check - an empty snapshot is real evidence (it held nothing), which is why
// the item query alone cannot answer it. A pre-fix feed cursor carries no
// snapshot id and answers no evidence.
func (s *DocumentChangesService) snapshotEvidence(ctx context.Context, q *db.Queries, cs changeCursorScope, snapshotID string, ids []string) (map[string]bool, bool, error) {
	out := map[string]bool{}
	if snapshotID == "" {
		return out, false, nil
	}
	if _, err := q.GetDocumentChangeSnapshot(ctx, db.GetDocumentChangeSnapshotParams{
		ID: snapshotID, OrganizationID: cs.organization, WorkspaceID: cs.workspace,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return out, false, nil
		}
		return nil, false, err
	}
	found, err := q.ReadableAtSnapshotIDs(ctx, db.ReadableAtSnapshotIDsParams{
		SnapshotID: snapshotID, OrganizationID: cs.organization, WorkspaceID: cs.workspace, Ids: ids,
	})
	if err != nil {
		return nil, false, err
	}
	for _, id := range found {
		out[id] = true
	}
	return out, true, nil
}

// decodeAuditObject parses one audit JSON column; an empty or malformed value
// answers nil, which the callers treat as "cannot reconstruct".
func decodeAuditObject(s string) map[string]any {
	if s == "" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil
	}
	return m
}

func auditString(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, _ := m[key].(string)
	return v
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
