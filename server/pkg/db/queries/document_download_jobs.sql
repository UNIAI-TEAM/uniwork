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
    finished_at = now(), expires_at = $7, document_ids = '{}'
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3 AND status = 'running'
RETURNING id;

-- name: FailDocumentDownloadJob :execrows
UPDATE document_download_jobs
SET status = 'failed', error = $4, skipped = $5, finished_at = now(), document_ids = '{}'
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3 AND status IN ('queued', 'running');

-- name: ListExpiredDocumentDownloadFiles :many
-- tenant: system
SELECT id, file_id FROM document_download_jobs
WHERE file_id IS NOT NULL AND expires_at IS NOT NULL AND expires_at <= now();

-- name: FailStaleDocumentDownloadJobs :execrows
-- tenant: system
-- A job still queued or running an hour after it started (a crash on the last
-- attempt leaves the row running with a parked event) is closed, so it stops
-- counting toward the creator's cap.
UPDATE document_download_jobs
SET status = 'failed', error = 'build_failed', finished_at = now(), document_ids = '{}'
WHERE status IN ('queued', 'running')
  AND COALESCE(started_at, created_at) < now() - interval '1 hour';

-- name: DeleteSettledDocumentDownloadJobs :execrows
-- tenant: system
-- A settled row has no use after a week; one that still holds its zip is kept
-- until the expiry release clears file_id.
DELETE FROM document_download_jobs
WHERE file_id IS NULL AND finished_at IS NOT NULL AND finished_at < now() - interval '7 days';

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
-- The cap is per creator across the organization's workspaces, so the
-- workspace is not part of the count; organization_id keeps it in the tenant.
SELECT count(*) FROM document_download_jobs
WHERE organization_id = $1
  AND created_by = $2 AND created_by_kind = $3
  AND status IN ('queued', 'running');
