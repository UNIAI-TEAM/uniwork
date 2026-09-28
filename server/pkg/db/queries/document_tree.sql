-- Document tree writes (C-01 §5.1, §13; G1-04b, UNI-678). Every query keeps
-- the tenant pair; the workspace tree lock (LockDocumentTree in
-- documents.sql) serializes every writer that uses these, after the
-- idempotency claim and before any document row lock - the one order every
-- tree command keeps (N-01).

-- The subtree rooted at one document: the root row itself plus every
-- descendant, each with its distance from the root (1 = the root). The
-- recursion is capped at twice the tree bound so a corrupted parent chain is
-- reported by the service, not walked forever. Archived nodes stay in the
-- result - a cycle or a depth check through an already-archived node is
-- still one.
-- name: ListDocumentSubtree :many
WITH RECURSIVE sub AS (
  SELECT r.id, 1 AS lvl
  FROM documents r
  WHERE r.organization_id = sqlc.arg(organization_id)
    AND r.workspace_id = sqlc.arg(workspace_id)
    AND r.id = sqlc.arg(root_id)
  UNION ALL
  SELECT d.id, sub.lvl + 1
  FROM documents d
  JOIN sub ON d.parent_id = sub.id
  WHERE d.organization_id = sqlc.arg(organization_id)
    AND d.workspace_id = sqlc.arg(workspace_id)
    AND sub.lvl < 10
)
SELECT d.*, sub.lvl AS subtree_depth
FROM sub
JOIN documents d ON d.id = sub.id;

-- The move write (C-01 §5.1 POST .../move): parent and position change, the
-- revision guard is the optimistic check the service already made under the
-- row and tree locks. Archived rows refuse through archived_at IS NULL.
-- name: MoveDocument :one
UPDATE documents
SET parent_id = sqlc.narg(parent_id),
    position = sqlc.arg(position),
    revision = revision + 1,
    updated_by = sqlc.arg(updated_by),
    updated_by_kind = sqlc.arg(updated_by_kind),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND revision = sqlc.arg(expected_revision)
  AND archived_at IS NULL
RETURNING *;

-- Archive stamping for one batch: every live id of the subtree gets the same
-- archive_batch_id and purge_after. Rows already in the trash keep their own
-- batch - a restore brings back exactly one batch (C-01 §6.3).
-- name: ArchiveDocumentBatch :many
UPDATE documents
SET archived_at = now(),
    archived_by = sqlc.arg(archived_by),
    purge_after = sqlc.arg(purge_after),
    archive_batch_id = sqlc.arg(archive_batch_id)
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND id = ANY(sqlc.arg(ids)::text[])
  AND archived_at IS NULL
RETURNING id;

-- One archive batch's rows (restore and diagnostics read this).
-- name: ListDocumentArchiveBatch :many
SELECT *
FROM documents
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND archive_batch_id = sqlc.arg(archive_batch_id)
ORDER BY id;

-- name: ClearDocumentArchiveBatch :many
UPDATE documents
SET archived_at = NULL,
    archived_by = NULL,
    purge_after = NULL,
    archive_batch_id = NULL
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND archive_batch_id = sqlc.arg(archive_batch_id)
  AND archived_at IS NOT NULL
RETURNING id, parent_id;

-- A document archived before batches existed (or through a path that left
-- no batch) restores alone.
-- name: RestoreSingleDocument :execrows
UPDATE documents
SET archived_at = NULL,
    archived_by = NULL,
    purge_after = NULL,
    archive_batch_id = NULL
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NOT NULL;

-- A restored node whose parent did not come back with it (still archived, or
-- purged) re-roots itself so it is reachable again.
-- name: DetachDocumentToRoot :one
UPDATE documents
SET parent_id = NULL,
    position = sqlc.arg(position),
    revision = revision + 1,
    updated_by = sqlc.arg(updated_by),
    updated_by_kind = sqlc.arg(updated_by_kind),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
RETURNING *;

-- The §13.6 owner seam: archive/restore of every document a work product
-- owns, inside the owner service's own transaction. Owned documents have no
-- tree position, so only the lifecycle fields move.
-- name: ArchiveDocumentsByOwner :many
UPDATE documents
SET archived_at = now(),
    archived_by = sqlc.arg(archived_by),
    purge_after = sqlc.arg(purge_after),
    archive_batch_id = sqlc.arg(archive_batch_id)
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND owner_id = sqlc.arg(owner_id)
  AND archived_at IS NULL
RETURNING id;

-- name: RestoreDocumentsByOwner :many
UPDATE documents
SET archived_at = NULL,
    archived_by = NULL,
    purge_after = NULL,
    archive_batch_id = NULL
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND owner_id = sqlc.arg(owner_id)
  AND archived_at IS NOT NULL
RETURNING id;

-- name: ArchiveOwnedDocument :one
UPDATE documents
SET archived_at = now(),
    archived_by = sqlc.arg(archived_by),
    purge_after = sqlc.arg(purge_after),
    archive_batch_id = sqlc.arg(archive_batch_id)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND owner_id IS NOT NULL
  AND archived_at IS NULL
RETURNING id;

-- name: RestoreOwnedDocument :one
UPDATE documents
SET archived_at = NULL,
    archived_by = NULL,
    purge_after = NULL,
    archive_batch_id = NULL
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND owner_id IS NOT NULL
  AND archived_at IS NOT NULL
RETURNING id;
