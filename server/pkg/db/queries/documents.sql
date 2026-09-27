-- Documents (C-01; UNI-675). Every business query carries the tenant pair
-- (organization_id + workspace_id); the FileService collector queries that
-- must run unscoped live in file_gc.sql.

-- name: InsertDocument :one
INSERT INTO documents (
  id, organization_id, workspace_id, parent_id, kind, title, icon, visibility,
  content, content_text, search_text, content_bytes,
  current_version, file_version_id, revision, position,
  owner_kind, owner_id, acl_owner_id,
  source_document_id, source_version_id, source_revision,
  source_format, source_engine, target_format, source_checksum_sha256,
  conversion_reason,
  created_by, created_by_kind, updated_by, updated_by_kind,
  content_saved_at, last_version_at, archived_at, archived_by, purge_after
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id),
  sqlc.arg(parent_id), sqlc.arg(kind), sqlc.arg(title), sqlc.arg(icon),
  sqlc.arg(visibility),
  sqlc.arg(content), sqlc.arg(content_text), sqlc.arg(search_text),
  sqlc.arg(content_bytes),
  sqlc.arg(current_version), sqlc.arg(file_version_id), sqlc.arg(revision),
  sqlc.arg(position),
  sqlc.arg(owner_kind), sqlc.arg(owner_id), sqlc.arg(acl_owner_id),
  sqlc.arg(source_document_id), sqlc.arg(source_version_id),
  sqlc.arg(source_revision),
  sqlc.arg(source_format), sqlc.arg(source_engine), sqlc.arg(target_format),
  sqlc.arg(source_checksum_sha256), sqlc.arg(conversion_reason),
  sqlc.arg(created_by), sqlc.arg(created_by_kind), sqlc.arg(updated_by),
  sqlc.arg(updated_by_kind),
  sqlc.arg(content_saved_at), sqlc.arg(last_version_at),
  sqlc.arg(archived_at), sqlc.arg(archived_by), sqlc.arg(purge_after)
)
RETURNING *;

-- name: GetDocument :one
SELECT *
FROM documents
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id);

-- The workspace tree/sidebar listing. Owned documents never stand in the
-- tree (§13.3), archived rows are gone from it as well.
-- name: ListDocumentsByParent :many
SELECT *
FROM documents
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND parent_id IS NOT DISTINCT FROM sqlc.arg(parent_id)
  AND owner_id IS NULL
  AND archived_at IS NULL
ORDER BY position, id;

-- The owner surface (§13.3/C-14): the live documents a work product owns.
-- name: ListDocumentsByOwner :many
SELECT *
FROM documents
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND owner_kind = sqlc.arg(owner_kind)
  AND owner_id = sqlc.arg(owner_id)
  AND archived_at IS NULL
ORDER BY position, id;

-- Working-copy autosave for pages: bumps revision, refreshes the extracted
-- text columns and content_saved_at. The `revision` guard is the optimistic
-- concurrency check - zero rows means a revision_conflict for the service.
-- name: UpdateDocumentContent :one
UPDATE documents
SET content = sqlc.arg(content),
    content_text = sqlc.arg(content_text),
    search_text = sqlc.arg(search_text),
    content_bytes = sqlc.arg(content_bytes),
    revision = revision + 1,
    updated_by = sqlc.arg(updated_by),
    updated_by_kind = sqlc.arg(updated_by_kind),
    content_saved_at = now(),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND revision = sqlc.arg(expected_revision)
RETURNING *;

-- ---- Pages (G1-04a, UNI-678) ----------------------------------------------

-- The PATCH write (C-01 §5.1): the service has already merged the patch onto
-- the locked row, so every field is written back whole. The revision guard
-- repeats the base check the service made under the row lock - zero rows is
-- a revision_conflict. content_saved_at moves only when the content itself
-- changed: it is the auto-version worker's input (§6.3), and a rename is
-- not an edit of the working copy.
-- name: UpdateDocumentFields :one
UPDATE documents
SET title = sqlc.arg(title),
    icon = sqlc.arg(icon),
    visibility = sqlc.arg(visibility),
    content = sqlc.arg(content),
    content_text = sqlc.arg(content_text),
    search_text = sqlc.arg(search_text),
    content_bytes = sqlc.arg(content_bytes),
    revision = revision + 1,
    updated_by = sqlc.arg(updated_by),
    updated_by_kind = sqlc.arg(updated_by_kind),
    content_saved_at = CASE WHEN sqlc.arg(content_changed)::boolean THEN now() ELSE content_saved_at END,
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND revision = sqlc.arg(expected_revision)
RETURNING *;

-- A new page goes after its live siblings in the workspace tree; the first
-- child of a parent (or of the root) sits at 0.
-- name: NextDocumentPosition :one
SELECT COALESCE(MAX(position) + 1, 0)::double precision AS position
FROM documents
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND parent_id IS NOT DISTINCT FROM sqlc.arg(parent_id)
  AND owner_id IS NULL
  AND archived_at IS NULL;

-- Content references an asset again (an undo, a restored version): its
-- orphan mark goes, so the reference provider holds it active (C-01 §14.2).
-- name: ClearDocumentAssetsOrphaned :exec
UPDATE document_assets
SET orphaned_at = NULL
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND id = ANY(sqlc.arg(ids)::text[])
  AND orphaned_at IS NOT NULL;

-- One workspace's tree changes one at a time: creates (sibling position)
-- take it now, and the move/archive commands of G1-04b take the same key, so
-- two tree writes never race on position, depth or cycles. Transaction-scoped;
-- taken after the idempotency claim and before any document row lock
-- (every tree command keeps that one order).
-- name: LockDocumentTree :exec
SELECT pg_advisory_xact_lock(hashtextextended('documents.tree:' || sqlc.arg(workspace_id)::text, 0));
