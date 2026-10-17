-- Document tree writes (C-01 §5.1, §13; G1-04b, UNI-678). Every query keeps
-- the tenant pair; the workspace tree lock (LockDocumentTree in
-- documents.sql) serializes every writer that uses these, after the
-- idempotency claim and before any document row lock - the one order every
-- tree command keeps (N-01).

-- The subtree rooted at one document: the root row itself plus every
-- descendant, each with its distance from the root (1 = the root). The
-- recursion is capped at max_level (twice the tree bound, from
-- subtreeMaxLevel) so a corrupted parent chain is reported by the service,
-- not walked forever. Archived nodes stay in the result - a cycle or a depth
-- check through an already-archived node is still one.
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
    AND sub.lvl < sqlc.arg(max_level)::int
)
SELECT d.*, sub.lvl AS subtree_depth
FROM sub
JOIN documents d ON d.id = sub.id;

-- The move write (C-01 §5.1 POST .../move): parent, position, title and the
-- folded search text change, the revision guard is the optimistic check the
-- service already made under the row and tree locks. The title is written on
-- every move - the service renames "(n)" when the destination holds the name
-- (§3.3) - and search_text follows it in the same statement so a rename is
-- findable at once. Archived rows refuse through archived_at IS NULL.
-- name: MoveDocument :one
UPDATE documents
SET parent_id = sqlc.narg(parent_id),
    position = sqlc.arg(position),
    title = sqlc.arg(title),
    search_text = sqlc.arg(search_text),
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

-- Every restore path bumps revision: a row that leaves the trash changes,
-- and a client holding the pre-archive revision must conflict on write
-- rather than silently keep a stale base.
-- name: ClearDocumentArchiveBatch :many
UPDATE documents
SET archived_at = NULL,
    archived_by = NULL,
    purge_after = NULL,
    archive_batch_id = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND id = ANY(sqlc.arg(ids)::text[])
  AND archived_at IS NOT NULL
RETURNING id, parent_id;

-- A document archived before batches existed (or through a path that left
-- no batch) restores alone.
-- name: RestoreSingleDocument :execrows
UPDATE documents
SET archived_at = NULL,
    archived_by = NULL,
    purge_after = NULL,
    archive_batch_id = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NOT NULL;

-- A restored node whose parent did not come back with it (still archived, or
-- purged) re-roots itself so it is reachable again. The restore writes the
-- final title here too, while the row is still in the trash: the partial
-- unique index does not apply to archived rows, so the batch is named first
-- and cleared second (§3.3).
-- name: DetachDocumentToRoot :one
UPDATE documents
SET parent_id = NULL,
    position = sqlc.arg(position),
    title = sqlc.arg(title),
    search_text = sqlc.arg(search_text),
    revision = revision + 1,
    updated_by = sqlc.arg(updated_by),
    updated_by_kind = sqlc.arg(updated_by_kind),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
RETURNING *;

-- The restore's other name write: a batch member keeps its parent and only its
-- title moves. Written while the row is still archived, for the same reason as
-- the detach above.
-- name: RenameArchivedDocument :one
UPDATE documents
SET title = sqlc.arg(title),
    search_text = sqlc.arg(search_text),
    revision = revision + 1,
    updated_by = sqlc.arg(updated_by),
    updated_by_kind = sqlc.arg(updated_by_kind),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NOT NULL
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

-- The archived rows an owner holds, locked for the caller's transaction and
-- carrying the batch each one was stamped under: the seam emits
-- document.restored with the batch the row cleared, which the restore
-- cannot RETURNING (it writes NULL there). The row lock is what makes that
-- batch honest - a concurrent rearchive or restore of the same row waits
-- for this transaction instead of moving the batch between read and clear.
-- name: LockArchivedDocumentsByOwner :many
SELECT id, archive_batch_id
FROM documents
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND owner_id = sqlc.arg(owner_id)
  AND archived_at IS NOT NULL
ORDER BY id
FOR UPDATE;

-- The restore update touches exactly the rows the lock above read: a row
-- archived after the lock (or by a racing transaction) is a newer batch and
-- stays put.
-- name: RestoreDocumentsByOwner :many
UPDATE documents
SET archived_at = NULL,
    archived_by = NULL,
    purge_after = NULL,
    archive_batch_id = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND owner_id = sqlc.arg(owner_id)
  AND id = ANY(sqlc.arg(ids)::text[])
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
    archive_batch_id = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND owner_id IS NOT NULL
  AND archived_at IS NOT NULL
RETURNING id;

-- The live (not archived) ids of a subtree, at most max_rows of them: the
-- archive command asks for one row past its bound to learn the subtree is too
-- big without walking all of it. The walk STOPS after max_rows live rows:
-- UNION ALL, the live filter in the outer query over the primary key, and no
-- ORDER BY before LIMIT - an ordering step would force the whole CTE to be
-- evaluated, while Postgres only computes the CTE rows the outer query really
-- takes. Archived nodes on the way are still walked (a live child of an
-- archived parent must stay reachable) but do not count against the cap. The
-- ids come back in no particular order; a caller that needs a stable order
-- sorts them itself. max_level is the corrupted-chain guard from
-- subtreeMaxLevel.
-- name: ListLiveDocumentSubtreeIDs :many
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
    AND sub.lvl < sqlc.arg(max_level)::int
)
SELECT d.id
FROM sub
JOIN documents d ON d.id = sub.id
WHERE d.archived_at IS NULL
LIMIT sqlc.arg(max_rows);

-- The live rows of the bounded id set the archive walk returned, counted by
-- kind and WITHOUT the root: GET /documents/{documentID}/archive-impact
-- answers folders/documents over the subtree and adds the root back in total
-- only (FD-04, addendum §3.4). The caller hands the ids
-- ListLiveDocumentSubtreeIDs read inside the same REPEATABLE READ, read-only
-- transaction, so the id set, the manage gate and these counts all come from
-- one snapshot; archived_at IS NULL repeats the archive command's own write
-- predicate, so the count is exactly the rows it would stamp besides the root.
-- name: CountLiveDocumentSubtreeByKind :many
SELECT d.kind, count(*) AS n
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.id = ANY(sqlc.arg(ids)::text[])
  AND d.id <> sqlc.arg(root_id)
  AND d.archived_at IS NULL
GROUP BY d.kind;

-- The live nodes of the bounded id set the archive walk returned that the
-- actor does not hold manage on through a path plain SQL can read: a workspace
-- owner/admin (is_ws_admin), the ACL owner (a workspace member only,
-- is_ws_member), or a live user/organization share at manage. A node it
-- returns is not refused - it still needs the full effectiveLevel
-- (workspace-principal shares, work-product owners); a node it omits is
-- manageable, so one query replaces a per-node access loop for the common
-- archive. Owned documents are always returned: the owner resolver decides
-- them, never these columns. It never walks the tree itself: the caller hands
-- it the bounded id set ListLiveDocumentSubtreeIDs returned, so the gate runs
-- on at most one archive bound of rows whatever the tree size.
-- name: ListDocumentSubtreeNeedingAccessCheck :many
SELECT d.id
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.id = ANY(sqlc.arg(ids)::text[])
  AND d.archived_at IS NULL
  AND (
    d.owner_kind IS NOT NULL
    OR NOT (
      sqlc.arg(is_ws_admin)::boolean
      -- acl_owner_id is NULL for agent/system-created documents: without the
      -- IS NOT NULL guard the comparison is NULL, NOT NULL stays NULL and the
      -- row would drop out of the result as if it were manageable.
      OR (sqlc.arg(is_ws_member)::boolean AND d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id)::text)
      OR EXISTS (
        SELECT 1
        FROM document_shares s
        WHERE s.organization_id = d.organization_id
          AND s.workspace_id = d.workspace_id
          AND s.document_id = d.id
          AND s.revoked_at IS NULL
          AND s.level = 'manage'
          AND (
            (s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id)::text)
            OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
          )
      )
    )
  )
ORDER BY d.id;
