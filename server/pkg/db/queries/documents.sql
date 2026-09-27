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
