-- Attachments on tasks (and optionally comments).

-- name: InsertAttachment :one
INSERT INTO attachments (
  id, organization_id, workspace_id, task_id, comment_id,
  uploader_type, uploader_id, object_key, object_url,
  filename, content_type, metadata, size_bytes
) VALUES (
  $1, $2, $3, $4, $5,
  $6, $7, $8, $9,
  $10, $11, $12, $13
)
RETURNING *;

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
