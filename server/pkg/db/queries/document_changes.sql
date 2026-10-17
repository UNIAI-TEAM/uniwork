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
  -- ARCHIVE-01: shelved rows stay in the snapshot - read-only is a feed-row
  -- flag; it is trashed rows that the snapshot excludes (archived_at above).
  AND (sqlc.arg(see_all)::boolean
       OR (sqlc.arg(member_visible)::boolean AND d.visibility = 'workspace'
           AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
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
SELECT a.id, a.action, a.resource_id, a.xact_id::text AS xact_id, a.metadata, a.changes
FROM audit_events a
WHERE a.organization_id = sqlc.arg(organization_id)
  AND a.workspace_id = sqlc.arg(workspace_id)
  AND a.resource_type = 'document'
  AND a.xact_id IS NOT NULL
  AND NOT pg_visible_in_snapshot(a.xact_id, sqlc.arg(high_water)::text::pg_snapshot)
  AND a.xact_id < pg_snapshot_xmin(pg_current_snapshot())
  -- CASE, not OR: the empty first-page keyset must never reach the ::xid8
  -- cast, and only CASE guarantees that the branch is not evaluated.
  AND (CASE WHEN sqlc.arg(after_xact)::text = '' THEN TRUE
            ELSE (a.xact_id, a.id) > (sqlc.arg(after_xact)::xid8, sqlc.arg(after_id)::text) END)
ORDER BY a.xact_id, a.id
LIMIT sqlc.arg(page_limit);

-- name: DocumentChangeFeedPending :one
-- The feed's backlog after the position one page handed out: every change
-- after it the page read would eventually deliver, and the age of the oldest
-- of them. This count deliberately DROPS the page read's in-flight-xid guard
-- (BE-G1-3): a change held back because its transaction was still open when
-- the page read is still owed, so it is part of the backlog. The guard itself
-- stays on the page read (ListDocumentChangeFeed) - it is what stops a client
-- from advancing past a transaction that may still roll back. This count does
-- NOT decide has_more: the page's own keyset advance does, so a page whose
-- every candidate is held back answers has_more=false with its cursor
-- position unchanged (keyset intact) (BE-G2-2) and this backlog simply drains
-- on a later poll. The age is the feed lag metric: a long-running transaction
-- (the xmin horizon) keeps this count and the age non-zero while no page
-- delivers, which is the stall the runbook names. No row answers (0, 0).
SELECT count(*)::bigint AS pending,
       COALESCE(EXTRACT(EPOCH FROM (now() - min(a.occurred_at))), 0)::float8 AS lag_seconds
FROM audit_events a
WHERE a.organization_id = sqlc.arg(organization_id)
  AND a.workspace_id = sqlc.arg(workspace_id)
  AND a.resource_type = 'document'
  AND a.xact_id IS NOT NULL
  AND NOT pg_visible_in_snapshot(a.xact_id, sqlc.arg(high_water)::text::pg_snapshot)
  AND (CASE WHEN sqlc.arg(after_xact)::text = '' THEN TRUE
            ELSE (a.xact_id, a.id) > (sqlc.arg(after_xact)::xid8, sqlc.arg(after_id)::text) END);

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
-- read nothing. Exactly the columns the feed reads (BE-G1-6) - never SELECT *,
-- which would drag content, content_text and search_text through a hot read.
SELECT
  d.id, d.organization_id, d.workspace_id, d.kind, d.revision,
  d.current_version, d.file_version_id, d.archived_at,
  d.owner_id, d.visibility, d.acl_owner_id, d.workspace_level
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.id = ANY(sqlc.arg(ids)::text[]);

-- name: ReadableAtSnapshotIDs :many
-- The document ids the caller's snapshot held among these candidates: the
-- snapshot items were materialised at the snapshot's MVCC point, so they are
-- exactly what the caller could read then. Since the removal basis moved to a
-- reconstruction at removal time (BE-G1-1/BE-G1-2) this set is NOT the
-- permission decision: it is consulted only for the two kinds whose pre-change
-- state the removal itself destroys (a purge removes the row and its shares; a
-- document that becomes Work-Product-owned overwrites its permission row) - a
-- held id makes the removal due (owned) or its evidence unreconstructable
-- (purge, answered 410), an absent id with no granting action on the page
-- proves no removal is due. An empty set from a swept snapshot is never read
-- as "not held": the caller checks the snapshot row still exists first.
SELECT document_id FROM document_change_snapshot_items
WHERE snapshot_id = sqlc.arg(snapshot_id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = ANY(sqlc.arg(ids)::text[]);
