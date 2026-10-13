-- Office change feed, cold-start snapshot (G5-01a, UNI-1344). The service
-- runs CurrentChangeHighWater, InsertDocumentChangeSnapshot and
-- InsertDocumentChangeSnapshotItems in ONE REPEATABLE READ transaction, so
-- the high-water mark and the items are the same MVCC snapshot.

-- name: CurrentChangeHighWater :one
-- The transaction snapshot of a REPEATABLE READ transaction: the commits
-- every later statement of it sees (G5-01b continues from it).
SELECT pg_current_snapshot()::text AS high_water;

-- name: InsertDocumentChangeSnapshot :exec
INSERT INTO document_change_snapshots (
  id, organization_id, workspace_id, created_by, created_by_kind, high_water, item_count, expires_at
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(created_by),
  sqlc.arg(created_by_kind), sqlc.arg(high_water), 0, sqlc.arg(expires_at)
);

-- name: InsertDocumentChangeSnapshotItems :execrows
-- The documents the actor reads in the workspace tree: the same legs as the
-- document lists (ListRecentDocumentsPage), workspace tree only (owned work
-- products are G5-01b's fan-out), archived documents left out. Ids, kind,
-- revision and the version pointer only.
INSERT INTO document_change_snapshot_items (
  snapshot_id, organization_id, workspace_id, document_id, kind, revision, current_version, file_version_id
)
SELECT sqlc.arg(snapshot_id), d.organization_id, d.workspace_id, d.id, d.kind, d.revision, d.current_version, d.file_version_id
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NULL
  AND (sqlc.arg(see_all)::boolean
       OR (sqlc.arg(member_visible)::boolean AND d.visibility = 'workspace')
       OR (sqlc.arg(acl_owner)::boolean AND d.acl_owner_id = sqlc.arg(actor_id)::text)
       OR (sqlc.arg(allow_shares)::boolean AND EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))));

-- name: SetDocumentChangeSnapshotCount :exec
UPDATE document_change_snapshots
SET item_count = sqlc.arg(item_count)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: GetDocumentChangeSnapshot :one
SELECT * FROM document_change_snapshots
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id);

-- name: ListDocumentChangeSnapshotItems :many
-- One keyset page by document id; the caller reads it in the same
-- transaction as GetDocumentChangeSnapshot, so a sweep is all or nothing.
SELECT document_id, kind, revision, current_version, file_version_id
FROM document_change_snapshot_items
WHERE snapshot_id = sqlc.arg(snapshot_id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id > sqlc.arg(after_document_id)
ORDER BY document_id
LIMIT sqlc.arg(page_limit);

-- name: SweepExpiredDocumentChangeSnapshots :many
-- tenant: system
-- The TTL sweep: one batch of expired snapshot rows. The caller deletes
-- their items in the same transaction.
DELETE FROM document_change_snapshots
WHERE id IN (
  SELECT s.id FROM document_change_snapshots s
  WHERE s.expires_at <= sqlc.arg(now)
  ORDER BY s.expires_at
  LIMIT sqlc.arg(batch_limit)
  FOR UPDATE SKIP LOCKED
)
RETURNING id;

-- name: DeleteDocumentChangeSnapshotItems :execrows
-- tenant: system
DELETE FROM document_change_snapshot_items
WHERE snapshot_id = ANY(sqlc.arg(snapshot_ids)::text[]);

-- ---- Incremental feed (G5-01b, UNI-1346) -----------------------------------
-- The feed continues from a snapshot's high-water mark. Its position is the
-- COMMITTED transaction id of the audit row every document command already
-- writes (ADR 0009): audit_events rows are never UPDATEd (the append-only
-- trigger), so xact_id is a stable commit-order keyset. ULIDs and created_at
-- are not commit ordered and cannot play that role.
--
-- "After the snapshot" is NOT pg_visible_in_snapshot alone. A transaction that
-- was in flight when the high-water mark was taken is invisible to it AND
-- absent from the snapshot's items, so the feed must carry it - but a
-- transaction that is STILL in flight when the feed reads must not be carried
-- yet, or a client could advance its cursor past a change that later commits.
-- The guard is xact_id < pg_snapshot_xmin(pg_current_snapshot()): only
-- transactions that are already committed as of this read are eligible, so an
-- in-flight one is held back for the next page and never skipped.
--
-- name: ListDocumentChangeFeed :many
SELECT a.id, a.action, a.resource_id, a.xact_id::text AS xact_id, a.metadata
FROM audit_events a
WHERE a.organization_id = sqlc.arg(organization_id)
  AND a.workspace_id = sqlc.arg(workspace_id)
  AND a.resource_type = 'document'
  AND a.xact_id IS NOT NULL
  AND NOT pg_visible_in_snapshot(a.xact_id, sqlc.arg(high_water)::text::pg_snapshot)
  AND a.xact_id < pg_snapshot_xmin(pg_current_snapshot())
  AND (sqlc.arg(after_xact)::text = ''
       OR (a.xact_id, a.id) > (sqlc.arg(after_xact)::xid8, sqlc.arg(after_id)::text))
ORDER BY a.xact_id, a.id
LIMIT sqlc.arg(page_limit);

-- name: DocumentChangeFeedPending :one
-- What the feed still owes after the position one page handed out: how many
-- changes are already committed and eligible (the same predicate as the page
-- read), and the age of the oldest of them. The count is has_more (a page that
-- stopped at the limit, or held a still-in-flight transaction back, keeps the
-- client paging); the age is the feed lag metric. No row answers (0, 0).
SELECT count(*)::bigint AS pending,
       COALESCE(EXTRACT(EPOCH FROM (now() - min(a.occurred_at))), 0)::float8 AS lag_seconds
FROM audit_events a
WHERE a.organization_id = sqlc.arg(organization_id)
  AND a.workspace_id = sqlc.arg(workspace_id)
  AND a.resource_type = 'document'
  AND a.xact_id IS NOT NULL
  AND NOT pg_visible_in_snapshot(a.xact_id, sqlc.arg(high_water)::text::pg_snapshot)
  AND a.xact_id < pg_snapshot_xmin(pg_current_snapshot())
  AND (sqlc.arg(after_xact)::text = ''
       OR (a.xact_id, a.id) > (sqlc.arg(after_xact)::xid8, sqlc.arg(after_id)::text));

-- name: ChangeFeedEpochSeen :one
-- Does a high-water mark postdate the change-feed position column? The epoch
-- row (migration 9991791830000302) carries the xid from which
-- audit_events.xact_id is filled; a mark that cannot see it was taken before
-- the column, so commits between the mark and the column have no position and
-- the feed answers 410 instead of a page with a hole in it. A missing epoch
-- row (the migration never ran) reads as not seen.
SELECT COALESCE((
  SELECT pg_visible_in_snapshot(e.xact_id, sqlc.arg(high_water)::text::pg_snapshot)
  FROM change_feed_epoch e
  ORDER BY e.xact_id DESC
  LIMIT 1
), false)::boolean AS seen;

-- name: ListDocumentsForChangeFeed :many
-- One page's documents, WITHOUT the workspace filter: a row whose document now
-- lives in another workspace of the same organization is a removal for this
-- workspace, and a row with no document is a hard delete. Cross-tenant ids
-- read nothing.
SELECT * FROM documents
WHERE organization_id = sqlc.arg(organization_id)
  AND id = ANY(sqlc.arg(ids)::text[]);

-- name: ReadableAtSnapshotIDs :many
-- The document ids the caller's snapshot held among these candidates: the
-- snapshot items were materialised at the snapshot's MVCC point, so they are
-- exactly what the caller could read then. The feed sends a removal only to a
-- caller in this set, so a stranger learns nothing about a document.
SELECT document_id FROM document_change_snapshot_items
WHERE snapshot_id = sqlc.arg(snapshot_id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = ANY(sqlc.arg(ids)::text[]);
