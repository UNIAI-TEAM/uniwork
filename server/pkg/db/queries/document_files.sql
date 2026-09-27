-- File documents (C-01 §14.2/§14.4; G1-03, UNI-677): the version pointer
-- swap, the upload-reuse check and the version lookup by id the commit,
-- restore and download commands need. Every query carries the tenant pair.

-- Commit/restore of a file version: the pointer moves, the ordinal and the
-- working revision advance. The revision guard is the base check - zero rows
-- means the base went stale between the lock and the write, which the
-- service turns into document_version_conflict.
-- name: SetDocumentFileVersion :one
UPDATE documents
SET file_version_id = sqlc.arg(file_version_id),
    current_version = sqlc.arg(current_version),
    revision = revision + 1,
    updated_by = sqlc.arg(updated_by),
    updated_by_kind = sqlc.arg(updated_by_kind),
    last_version_at = now(),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND kind = 'file'
  AND revision = sqlc.arg(expected_revision)
RETURNING *;

-- Is this file already bound to a Documents row in the organization? An
-- upload is consumed by the first version or asset that claims it;
-- FileService allows reuse inside a tenant (T1-Q3), Documents does not
-- (upload_already_committed, C-01 §14.5).
-- Document purposes are workspace-scoped in FileService, so a file can only
-- ever be claimed inside its own workspace.
-- name: DocumentFileInUse :one
SELECT EXISTS (
  SELECT 1 FROM document_versions v
  WHERE v.organization_id = sqlc.arg(organization_id)
    AND v.workspace_id = sqlc.arg(workspace_id)
    AND v.file_id = sqlc.arg(file_id)
  UNION ALL
  SELECT 1 FROM document_assets a
  WHERE a.organization_id = sqlc.arg(organization_id)
    AND a.workspace_id = sqlc.arg(workspace_id)
    AND a.file_id = sqlc.arg(file_id)
) AS in_use;

-- name: GetDocumentVersionByID :one
SELECT *
FROM document_versions
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);
