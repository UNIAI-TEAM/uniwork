-- File documents (C-01 §14.2/§14.4; G1-03, UNI-677): the version pointer
-- swap, the upload-reuse check the commit, restore and asset commands need
-- (GetDocumentVersionByID lives in document_access.sql, G1-02). Every query carries the tenant pair.

-- Commit/restore of a file version: the pointer moves, the ordinal and the
-- working revision advance; the content changed, so content_revision takes
-- the new revision (OQ-P1). The revision guard repeats the revision the
-- service locked - zero rows means the row moved between the lock and the
-- write, which the service turns into document_version_conflict.
-- name: SetDocumentFileVersion :one
UPDATE documents
SET file_version_id = sqlc.arg(file_version_id),
    current_version = sqlc.arg(current_version),
    title = sqlc.arg(title),
    search_text = sqlc.arg(search_text),
    content_text = '',
    revision = revision + 1,
    content_revision = revision + 1,
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

-- The text index of a file document (document.text_index_requested consumer):
-- the extracted text and the folded search column. A derived column, not a
-- content change, so revision, content_revision and updated_at stay as they
-- are. The file_version_id guard drops a result for a version that is no
-- longer current; zero rows is not an error.
-- name: SetDocumentFileText :execrows
UPDATE documents
SET content_text = sqlc.arg(content_text),
    search_text = sqlc.arg(search_text)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND kind = 'file'
  AND file_version_id = sqlc.arg(file_version_id);

-- cmd/document-text-reindex: one keyset page of file documents across
-- organizations (or one, when organization_id is set), to request the text
-- index of files uploaded before document.text_index_requested existed.
-- name: ListFileDocumentsForTextIndex :many
-- tenant: system
SELECT id, organization_id, workspace_id, file_version_id
FROM documents
WHERE kind = 'file'
  AND file_version_id IS NOT NULL
  AND (sqlc.narg(organization_id)::text IS NULL OR organization_id = sqlc.narg(organization_id))
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_limit);

-- cmd/document-text-reindex: how many requests of one topic still wait for or
-- sit in a consumer, so the command can pace itself behind the slow lane.
-- name: CountOpenOutboxByTopic :one
-- tenant: system
SELECT count(*)::bigint FROM outbox_events
WHERE topic = sqlc.arg('topic') AND status IN ('PENDING', 'PROCESSING');
