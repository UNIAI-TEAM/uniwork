-- Folder bulk access batches and subtree scope queries (UNI-2244 §1–§5).

-- Locks the folder for a bulk contents-access update when serializing queue insertion.
-- name: LockFolderAccessBatch :exec
SELECT pg_advisory_xact_lock(hashtextextended('document-folder-access:' || sqlc.arg(folder_id)::text, 0));

-- Returns the active (queued or running) batch id for a folder, if one exists (spec §3.1 step 2).
-- name: GetRunningDocumentAccessBatchForFolder :one
SELECT id
FROM document_access_batches
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND folder_id = sqlc.arg(folder_id)
  AND status IN ('queued', 'running')
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- Lists every live non-folder document in the folder's subtree in the workspace,
-- recursing through both sub-folders and child pages, excluding Trash (archived_at)
-- and foreign My Folder subtrees (uw_my_folder_foreign_ids, spec §1, §3.1 step 3).
-- Sorted by id COLLATE "C" so cursor_id can resume after any chunk.
-- name: ListFolderContentsAccessSubtreeIDs :many
WITH RECURSIVE sub AS (
  SELECT r.id, 1 AS lvl
  FROM documents r
  WHERE r.organization_id = sqlc.arg(organization_id)
    AND r.workspace_id = sqlc.arg(workspace_id)
    AND r.id = sqlc.arg(folder_id)
    AND r.archived_at IS NULL
  UNION ALL
  SELECT c.id, sub.lvl + 1
  FROM documents c
  JOIN sub ON c.parent_id = sub.id
  WHERE c.organization_id = sqlc.arg(organization_id)
    AND c.workspace_id = sqlc.arg(workspace_id)
    AND c.archived_at IS NULL
    AND sub.lvl < sqlc.arg(max_level)::int
)
SELECT d.id
FROM sub
JOIN documents d ON d.id = sub.id
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.id <> sqlc.arg(folder_id)
  AND d.kind <> 'folder'
  AND (d.system_kind IS NULL OR d.system_kind <> 'my_folder')
  AND d.archived_at IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM uw_my_folder_foreign_ids(
          sqlc.arg(actor_id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(max_level)::int
        ) mfs WHERE mfs.document_id = d.id)
ORDER BY d.id COLLATE "C";


-- Lists every active human member user_id of the organization so dry-run preview
-- can evaluate losing_users and downgraded_users across a folder subtree (spec §3.1).
-- name: ListActiveOrgMemberUserIDsForAccessBatch :many
SELECT user_id
FROM organization_members
WHERE organization_id = sqlc.arg(organization_id)
  AND deactivated_at IS NULL
ORDER BY user_id;
-- Inserts a new queued (or sync-completed) document_access_batches row (spec §3.1, §5).
-- name: InsertDocumentAccessBatch :one
INSERT INTO document_access_batches (
  id, organization_id, workspace_id, folder_id, created_by, created_by_kind,
  mode, items, document_ids, notified_levels, status, total, processed,
  changed, unchanged, skipped_not_manageable, skipped_locked, cursor_id, finished_at
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(folder_id),
  sqlc.arg(created_by), sqlc.arg(created_by_kind), sqlc.arg(mode), sqlc.arg(items),
  sqlc.arg(document_ids), sqlc.arg(notified_levels), sqlc.arg(status), sqlc.arg(total),
  sqlc.arg(processed), sqlc.arg(changed), sqlc.arg(unchanged),
  sqlc.arg(skipped_not_manageable), sqlc.arg(skipped_locked),
  sqlc.arg(cursor_id), sqlc.narg(finished_at)
)
RETURNING *;

-- Reads a batch for its creator on GET /api/v1/documents/{folderID}/contents-access/{batchID} (spec §3.2).
-- name: GetDocumentAccessBatchForCreator :one
SELECT *
FROM document_access_batches
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND folder_id = sqlc.arg(folder_id)
  AND created_by = sqlc.arg(created_by)
  AND created_by_kind = sqlc.arg(created_by_kind);

-- Reads a completed bulk access batch for the notification consumer (spec §6).
-- name: GetDocumentAccessBatchForNotification :one
SELECT *
FROM document_access_batches
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id);

-- Claims one queued or interrupted running batch for the worker loop (spec §4, §5).
-- name: ClaimNextDocumentAccessBatch :one
-- tenant: system
UPDATE document_access_batches
SET status = 'running', updated_at = now()
WHERE id = (
  SELECT b.id
  FROM document_access_batches b
  WHERE b.status IN ('queued', 'running')
  ORDER BY b.created_at ASC, b.id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- Locks a specific batch row inside a worker chunk transaction with FOR UPDATE SKIP LOCKED.
-- name: LockDocumentAccessBatchForChunk :one
-- tenant: system
SELECT *
FROM document_access_batches
WHERE id = sqlc.arg(id)
  AND status IN ('queued', 'running')
FOR UPDATE SKIP LOCKED;

-- Advances the batch counters, cursor_id and notified_levels at the end of a chunk transaction (spec §4).
-- name: AdvanceDocumentAccessBatchChunk :one
UPDATE document_access_batches
SET status = 'running',
    processed = sqlc.arg(processed),
    changed = sqlc.arg(changed),
    unchanged = sqlc.arg(unchanged),
    skipped_not_manageable = sqlc.arg(skipped_not_manageable),
    skipped_locked = sqlc.arg(skipped_locked),
    cursor_id = sqlc.arg(cursor_id),
    notified_levels = sqlc.arg(notified_levels),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND status IN ('queued', 'running')
RETURNING *;

-- Marks a background batch completed once all chunks have been processed (spec §4, §6).
-- name: CompleteDocumentAccessBatch :one
UPDATE document_access_batches
SET status = 'completed',
    processed = sqlc.arg(processed),
    changed = sqlc.arg(changed),
    unchanged = sqlc.arg(unchanged),
    skipped_not_manageable = sqlc.arg(skipped_not_manageable),
    skipped_locked = sqlc.arg(skipped_locked),
    cursor_id = sqlc.arg(cursor_id),
    notified_levels = sqlc.arg(notified_levels),
    updated_at = now(),
    finished_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND status IN ('queued', 'running')
RETURNING *;

-- Marks a background batch failed when the root folder is lost or a chunk document moved out of the subtree (spec §4).
-- name: FailDocumentAccessBatch :one
UPDATE document_access_batches
SET status = 'failed',
    error_code = sqlc.arg(error_code),
    updated_at = now(),
    finished_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND status IN ('queued', 'running')
RETURNING *;
