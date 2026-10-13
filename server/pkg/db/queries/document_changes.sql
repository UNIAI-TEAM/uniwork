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
