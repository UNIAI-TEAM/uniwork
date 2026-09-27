-- Page assets (C-01 §3.3; UNI-675). Orphan tracking: when content stops
-- referencing an asset the service stamps orphaned_at; the reference
-- provider keeps the file held for a 7-day retention window from that mark.

-- name: InsertDocumentAsset :one
INSERT INTO document_assets (
  id, organization_id, workspace_id, document_id, file_id, mime_type,
  size_bytes, width, height, created_by, created_by_kind, orphaned_at
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id),
  sqlc.arg(document_id), sqlc.arg(file_id), sqlc.arg(mime_type),
  sqlc.arg(size_bytes), sqlc.arg(width), sqlc.arg(height),
  sqlc.arg(created_by), sqlc.arg(created_by_kind), sqlc.arg(orphaned_at)
)
RETURNING *;

-- name: GetDocumentAsset :one
SELECT *
FROM document_assets
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- name: ListDocumentAssetsByDocument :many
SELECT *
FROM document_assets
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
ORDER BY created_at, id;

-- The orphan sweep: mark assets no longer referenced by content. Passes the
-- whole list so the caller computes the diff; orphaned_at moves to now().
-- name: MarkDocumentAssetOrphaned :exec
UPDATE document_assets
SET orphaned_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- FileService hold classification for the `documents.assets` reference
-- provider: active while content still references it, retention inside the
-- 7-day hold after orphaned_at, soft_deleted while the parent document is
-- archived-but-not-purged. Rows past the hold read 'released' - the
-- provider must not hold them. Provider-facing: NOT tenant filtered.
-- name: ListDocumentAssetFileHolds :many
SELECT a.file_id,
  CASE
    WHEN d.archived_at IS NOT NULL THEN 'soft_deleted'
    WHEN a.orphaned_at IS NULL THEN 'active'
    WHEN a.orphaned_at > now() - interval '7 days' THEN 'retention'
    ELSE 'released'
  END AS reason
FROM document_assets a
JOIN documents d
  ON d.organization_id = a.organization_id
 AND d.workspace_id = a.workspace_id
 AND d.id = a.document_id
WHERE a.file_id = ANY(sqlc.arg('file_ids')::text[]);
