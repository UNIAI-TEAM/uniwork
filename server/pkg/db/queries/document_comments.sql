-- Document comments (G1-07, UNI-681): the document_comments table behind
-- the shared comment core. Every query filters the tenant pair; reactions
-- reuse the shared comment_reactions table, reached only through a document
-- comment row.

-- name: GetDocumentCommentByID :one
-- tenant: by-id
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
-- The anchor trio rides on the create (G8-04): NULL for a discussion, a
-- reply or any comment with no anchor.
INSERT INTO document_comments (
  id, organization_id, workspace_id, document_id, author_id, author_kind,
  body, parent_comment_id, comment_type, anchor, anchor_version_id, anchor_state
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
)
RETURNING *;

-- name: UpdateDocumentCommentAnchor :one
-- One accepted PUT anchors item (G8-04). The caller proved the row live and
-- the version never moves back before it reaches here; updated_at moves
-- because the list_token hashes it.
UPDATE document_comments
SET anchor = $4,
    anchor_version_id = $5,
    anchor_state = $6,
    updated_at = now()
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3
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

-- name: TombstoneDocumentComment :one
-- A comment with surviving replies keeps its place in the thread: the body
-- goes, the frame stays (G8-03, Q8). The deleted_at guard makes a repeat of a
-- raced delete a no-op instead of an overwrite.
UPDATE document_comments
SET body = '',
    deleted_at = now(),
    deleted_by_id = $4,
    deleted_by_kind = $5,
    updated_at = now()
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3
  AND deleted_at IS NULL
RETURNING *;

-- name: CountDocumentCommentReplies :one
-- Any child row keeps the parent alive as a tombstone - a tombstoned reply
-- counts too (the thread structure is what the frame preserves).
SELECT count(*) AS replies
FROM document_comments
WHERE parent_comment_id = $1
  AND organization_id = $2
  AND workspace_id = $3;

-- name: DeleteDocumentCommentRevisions :exec
-- The edit history is deleted for real with its comment (Q8): tombstone and
-- hard delete both drop these rows in their own transaction.
DELETE FROM document_comment_revisions
WHERE comment_id = $1
  AND organization_id = $2
  AND workspace_id = $3;

-- name: InsertDocumentCommentRevision :one
-- One row per edit holds the body being replaced and the revision number that
-- body carried (OQ-C3); created_by is the actor of the edit.
INSERT INTO document_comment_revisions (
  id, organization_id, workspace_id, document_id, comment_id,
  body, revision, created_by, created_by_kind
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: ListDocumentCommentRevisions :many
-- Newest first; the service proves the comment hangs on the document first.
SELECT *
FROM document_comment_revisions
WHERE comment_id = $1
  AND document_id = $2
  AND organization_id = $3
  AND workspace_id = $4
ORDER BY revision DESC;

-- name: ResolveDocumentComment :one
-- The state change moves updated_at (so the list_token moves, contract 2.5)
-- and never consumes a revision number: revision is the content-edit counter
-- whose history rows are a contiguous sequence (REV, G8-04 r3c). Consuming
-- one here made the next edit insert a body under a revision already taken.
UPDATE document_comments
SET resolved_at = now(),
    resolved_by_type = $4,
    resolved_by_id = $5,
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
    updated_at = now()
WHERE id = $1
  AND organization_id = $2
  AND workspace_id = $3
  AND resolved_at IS NOT NULL
RETURNING *;

-- name: ListDocumentComments :many
-- One statement is one snapshot: the list and its list_token come from the
-- same rows, so the token can never run ahead of what the caller received
-- (contract-collab section 6). Both thread kinds and tombstones ride along;
-- the service filters kind in memory.
SELECT c.id, c.document_id, c.author_id, c.author_kind, c.body, c.created_at,
       c.parent_comment_id, c.comment_type, c.revision, c.updated_at,
       c.resolved_at, c.resolved_by_type, c.resolved_by_id,
       c.anchor, c.anchor_version_id, c.anchor_state,
       c.deleted_at, c.deleted_by_id, c.deleted_by_kind,
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
  AND c.organization_id = $2
  AND c.workspace_id = $3
ORDER BY r.created_at;

-- name: DeleteDocumentCommentReactions :exec
-- A deleted document comment takes its reactions with it (no FK: service
-- cleanup in the delete transaction).
DELETE FROM comment_reactions
WHERE comment_id = $1
  AND organization_id = $2
  AND workspace_id = $3;
