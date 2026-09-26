-- Attachments on tasks (and optionally comments).

-- name: InsertAttachment :one
INSERT INTO attachments (
  id, organization_id, workspace_id, task_id, comment_id,
  uploader_type, uploader_id, object_key, object_url,
  filename, content_type, metadata, size_bytes, expires_at,
  file_id, purpose
) VALUES (
  $1, $2, $3, $4, $5,
  $6, $7, $8, $9,
  $10, $11, $12, $13, $14,
  $15, $16
)
RETURNING *;

-- name: BindAttachmentsToTask :many
UPDATE attachments
SET task_id = sqlc.arg(task_id), expires_at = NULL, updated_at = now()
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND uploader_type = sqlc.arg(uploader_type)
  AND uploader_id = sqlc.arg(uploader_id)
  AND task_id IS NULL
  AND comment_id IS NULL
  AND expires_at > now()
  AND id = ANY(sqlc.arg(attachment_ids)::text[])
RETURNING id;

-- name: ListAttachmentsByTask :many
SELECT *
FROM attachments
WHERE organization_id = $1
  AND workspace_id = $2
  AND task_id = $3
ORDER BY created_at, id;

-- name: GetAttachment :one
SELECT *
FROM attachments
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3;

-- name: GetAttachmentByID :one
SELECT *
FROM attachments
WHERE id = $1;

-- name: DeleteAttachment :exec
DELETE FROM attachments
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3;

-- FileService window: the file ids and upload purposes of rows that are being
-- bound, so task create can claim them grouped by purpose in the same
-- transaction. Legacy rows (file_id NULL) never reach FileService.
-- name: ListAttachmentFileRefsByIDs :many
SELECT id, file_id, purpose
FROM attachments
WHERE organization_id = $1
  AND workspace_id = $2
  AND file_id IS NOT NULL
  AND id = ANY(sqlc.arg('attachment_ids')::text[]);

-- The file ids FileService may release when a task goes away: every file-
-- backed row still bound to it, regardless of which content references the
-- row had. Providers decide holds on their own; this is only the unlink list.
-- name: ListAttachmentFileIDsByTask :many
SELECT file_id
FROM attachments
WHERE organization_id = $1
  AND workspace_id = $2
  AND task_id = $3
  AND file_id IS NOT NULL;

-- The reference-provider view: for the file ids a collector is considering,
-- which attachment rows still hold them. A row holds its file while it points
-- at a live task or comment, while its staging window is still open, or while
-- a live task description / comment body still embeds the row's attachment
-- URL — the embed survives unbinding, and its row is the only map from the
-- URL back to the file.
-- name: ListAttachmentFileHolds :many
SELECT a.id, a.file_id, a.purpose
FROM attachments a
WHERE a.file_id = ANY(sqlc.arg('file_ids')::text[])
  AND (
    (a.task_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM tasks t WHERE t.id = a.task_id))
    OR (a.comment_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM task_comments c WHERE c.id = a.comment_id))
    OR (a.expires_at IS NOT NULL AND a.expires_at > now())
    OR EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.organization_id = a.organization_id
        AND t.workspace_id = a.workspace_id
        AND t.description LIKE '%/attachments/' || a.id || '/%')
    OR EXISTS (
      SELECT 1 FROM task_comments c
      WHERE c.organization_id = a.organization_id
        AND c.workspace_id = a.workspace_id
        AND c.body LIKE '%/attachments/' || a.id || '/%')
  );

-- name: ListAttachmentFileIDsByComment :many
SELECT file_id
FROM attachments
WHERE organization_id = $1
  AND workspace_id = $2
  AND comment_id = $3
  AND file_id IS NOT NULL;
