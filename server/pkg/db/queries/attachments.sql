-- Attachments on tasks (and optionally comments).

-- name: InsertAttachment :one
INSERT INTO attachments (
  id, organization_id, workspace_id, task_id, comment_id,
  uploader_type, uploader_id, object_key, object_url,
  filename, content_type, metadata, size_bytes, expires_at
) VALUES (
  $1, $2, $3, $4, $5,
  $6, $7, $8, $9,
  $10, $11, $12, $13, $14
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
