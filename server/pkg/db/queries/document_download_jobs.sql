-- Multi-document zip download jobs (UNI-2045 SV-9).

-- name: InsertDocumentDownloadJob :one
INSERT INTO document_download_jobs (
  id, organization_id, workspace_id, created_by, created_by_kind, document_ids
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetDocumentDownloadJob :one
SELECT * FROM document_download_jobs
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3;

-- name: StartDocumentDownloadJob :execrows
-- A retried delivery finds the row running and takes it again; a settled row
-- stays untouched.
UPDATE document_download_jobs SET status = 'running', started_at = COALESCE(started_at, now())
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3 AND status IN ('queued', 'running');

-- name: CompleteDocumentDownloadJob :one
UPDATE document_download_jobs
SET status = 'ready', file_id = $4, file_count = $5, skipped = $6,
    finished_at = now(), expires_at = $7
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3 AND status = 'running'
RETURNING id;

-- name: FailDocumentDownloadJob :execrows
UPDATE document_download_jobs
SET status = 'failed', error = $4, skipped = $5, finished_at = now()
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3 AND status IN ('queued', 'running');

-- name: ListExpiredDocumentDownloadFiles :many
-- tenant: system
SELECT id, file_id FROM document_download_jobs
WHERE file_id IS NOT NULL AND expires_at IS NOT NULL AND expires_at <= now();

-- name: ReleaseDocumentDownloadFile :execrows
-- tenant: system
UPDATE document_download_jobs SET file_id = NULL WHERE id = $1 AND file_id = $2;

-- name: DocumentDownloadHeldFileIDs :many
-- tenant: system
SELECT file_id FROM document_download_jobs WHERE file_id = ANY(sqlc.arg('file_ids')::text[]);

-- name: ClearDocumentDownloadJobFiles :exec
UPDATE document_download_jobs SET file_id = NULL
WHERE organization_id = $1 AND file_id IS NOT NULL;

-- name: LockDocumentDownloadCreator :exec
-- Serializes the per-creator active-job count with the insert that follows it,
-- so two concurrent requests cannot both pass the cap.
SELECT pg_advisory_xact_lock(hashtextextended('document-download:' || sqlc.arg(created_by)::text, 0));

-- name: CountActiveDocumentDownloadJobs :one
SELECT count(*) FROM document_download_jobs
WHERE organization_id = $1 AND workspace_id = $2
  AND created_by = $3 AND created_by_kind = $4
  AND status IN ('queued', 'running');
