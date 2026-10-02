-- Document versions (C-01 §3.2; UNI-675). Append-only: services insert and
-- read, never update or delete (the document purge job removes them with the
-- document itself). The file_id hold query is provider-facing.

-- name: InsertDocumentVersion :one
INSERT INTO document_versions (
  id, organization_id, workspace_id, document_id, version, kind, reason,
  label, content, file_id, mime_type, size_bytes, checksum_sha256,
  restored_from, engine_name, engine_version, contract_version,
  protocol_version, created_by, created_by_kind
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id),
  sqlc.arg(document_id), sqlc.arg(version), sqlc.arg(kind), sqlc.arg(reason),
  sqlc.arg(label), sqlc.arg(content), sqlc.arg(file_id), sqlc.arg(mime_type),
  sqlc.arg(size_bytes), sqlc.arg(checksum_sha256),
  sqlc.arg(restored_from), sqlc.arg(engine_name), sqlc.arg(engine_version),
  sqlc.arg(contract_version),
  sqlc.arg(protocol_version), sqlc.arg(created_by), sqlc.arg(created_by_kind)
)
RETURNING *;

-- name: GetDocumentVersion :one
SELECT *
FROM document_versions
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND version = sqlc.arg(version);

-- name: ListDocumentVersions :many
SELECT *
FROM document_versions
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
ORDER BY version DESC;

-- name: GetLatestDocumentVersion :one
SELECT *
FROM document_versions
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
ORDER BY version DESC
LIMIT 1;

-- FileService hold classification for the `documents.versions` reference
-- provider: active while the version is the document's current pointer,
-- version_history once superseded, soft_deleted while the parent document
-- is archived-but-not-purged. Provider-facing: intentionally NOT tenant
-- filtered - the collector asks whether a given file_id is still held.
-- name: ListDocumentVersionFileHolds :many
-- tenant: system
SELECT v.file_id,
  CASE
    WHEN d.archived_at IS NOT NULL THEN 'soft_deleted'
    WHEN d.file_version_id IS DISTINCT FROM v.id THEN 'version_history'
    ELSE 'active'
  END AS reason
FROM document_versions v
JOIN documents d
  ON d.organization_id = v.organization_id
 AND d.workspace_id = v.workspace_id
 AND d.id = v.document_id
WHERE v.file_id = ANY(sqlc.arg('file_ids')::text[]);

-- ---- Page versions and restore (G1-04a, UNI-678) ---------------------------

-- A manual page version moves the ordinal and the version clock; the working
-- copy did not change, so the revision stays (C-01 §5.2). The ordinal guard
-- is the row-lock twin of the revision guard.
-- name: MarkDocumentVersioned :one
UPDATE documents
SET current_version = sqlc.arg(current_version),
    last_version_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND current_version = sqlc.arg(expected_version)
RETURNING *;

-- Restore of a page version: the working copy takes the version's content,
-- the ordinal points at the new restore version and the revision advances
-- (C-01 §5.2). content_saved_at and last_version_at take the same now(), so
-- the auto-versioner does not snapshot the restore a second time.
-- name: RestoreDocumentPage :one
UPDATE documents
SET content = sqlc.arg(content),
    content_text = sqlc.arg(content_text),
    search_text = sqlc.arg(search_text),
    content_bytes = sqlc.arg(content_bytes),
    current_version = sqlc.arg(current_version),
    revision = revision + 1,
    updated_by = sqlc.arg(updated_by),
    updated_by_kind = sqlc.arg(updated_by_kind),
    content_saved_at = now(),
    last_version_at = now(),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND kind = 'page'
  AND revision = sqlc.arg(expected_revision)
RETURNING *;

-- The history list (C-01 §5.2): newest first, metadata only - content stays
-- out of the page. The cursor is the last version number seen; versions are
-- append-only ordinals, so a version created between two reads lands above
-- the cursor and never shifts the next page.
-- name: ListDocumentVersionsPage :many
SELECT id, organization_id, workspace_id, document_id, version, kind, reason,
  label, file_id, mime_type, size_bytes, checksum_sha256, restored_from,
  engine_name, engine_version, contract_version, protocol_version,
  created_by, created_by_kind, created_at
FROM document_versions
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND (sqlc.narg(before_version)::integer IS NULL OR version < sqlc.narg(before_version)::integer)
ORDER BY version DESC
LIMIT sqlc.arg(max_rows);
