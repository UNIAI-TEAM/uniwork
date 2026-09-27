-- Document comments (G1-07, UNI-681): the document_comments table behind
-- the shared comment core. Every query filters the tenant pair; reactions
-- reuse the shared comment_reactions table, reached only through a document
-- comment row.

-- name: GetDocumentCommentByID :one
SELECT *
FROM document_comments
WHERE id = $1;

-- name: GetDocumentComment :one
SELECT *
FROM document_comments
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3;

-- name: CreateDocumentComment :one
INSERT INTO document_comments (
  id, organization_id, workspace_id, document_id, author_id, author_kind,
  body, parent_comment_id, comment_type
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: UpdateDocumentCommentBody :one
UPDATE document_comments
SET body = $4,
    revision = revision + 1,
    updated_at = now()
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3
RETURNING *;

-- name: DeleteDocumentComment :exec
DELETE FROM document_comments
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3;

-- name: ResolveDocumentComment :one
UPDATE document_comments
SET resolved_at = now(),
    resolved_by_type = $4,
    resolved_by_id = $5,
    revision = revision + 1,
    updated_at = now()
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3
  AND resolved_at IS NULL
RETURNING *;

-- name: UnresolveDocumentComment :one
UPDATE document_comments
SET resolved_at = NULL,
    resolved_by_type = NULL,
    resolved_by_id = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3
  AND resolved_at IS NOT NULL
RETURNING *;

-- name: ListDocumentComments :many
SELECT c.id, c.document_id, c.author_id, c.author_kind, c.body, c.created_at,
       c.parent_comment_id, c.comment_type, c.revision, c.updated_at,
       c.resolved_at, c.resolved_by_type, c.resolved_by_id,
       COALESCE(u.display_name, a.name, '')::text AS display_name,
       COALESCE(u.avatar_url, a.avatar_url) AS avatar_url,
       u.avatar_file_id
FROM document_comments c
LEFT JOIN users u ON c.author_kind = 'human' AND u.id = c.author_id
LEFT JOIN agents a ON c.author_kind = 'agent' AND a.id = c.author_id
WHERE c.document_id = $1
  AND c.organization_id = $2
  AND c.workspace_id = $3
ORDER BY c.created_at;

-- name: ListDocumentCommentReactions :many
SELECT r.*
FROM comment_reactions r
JOIN document_comments c ON c.id = r.comment_id
WHERE c.document_id = $1
  AND r.organization_id = $2
  AND r.workspace_id = $3
ORDER BY r.created_at;
