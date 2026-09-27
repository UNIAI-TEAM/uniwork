-- Document favorites (G1-07, UNI-681): server-side per-user favorites.
-- Add/remove are idempotent (the (document_id, user_id) unique pair and a
-- plain delete); every list read is re-filtered by live permission in
-- service code.

-- name: AddDocumentFavorite :one
INSERT INTO document_favorites (
  id, organization_id, workspace_id, document_id, user_id, created_by, created_by_kind
) VALUES (
  $1, $2, $3, $4, $5, $6, $7
)
ON CONFLICT (document_id, user_id) DO NOTHING
RETURNING *;

-- name: GetDocumentFavorite :one
SELECT *
FROM document_favorites
WHERE document_id = $1
  AND user_id = $2
  AND organization_id = $3
  AND workspace_id = $4;

-- name: RemoveDocumentFavorite :execrows
DELETE FROM document_favorites
WHERE document_id = $1
  AND user_id = $2
  AND organization_id = $3
  AND workspace_id = $4;

-- name: ListDocumentFavorites :many
SELECT f.id AS favorite_id, f.created_at AS favorited_at, sqlc.embed(d)
FROM document_favorites f
JOIN documents d
  ON d.id = f.document_id
 AND d.organization_id = f.organization_id
 AND d.workspace_id = f.workspace_id
WHERE f.user_id = $1
  AND f.organization_id = $2
ORDER BY f.created_at DESC;
