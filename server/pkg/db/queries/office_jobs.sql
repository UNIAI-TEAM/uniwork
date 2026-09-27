-- Office engine jobs (G2-02 / UNI-685). Every business query carries the
-- tenant pair (organization_id + workspace_id). Every state change is a
-- compare-and-set: the WHERE clause names the states it may leave, and a
-- caller that gets no row back lost the race and reads the row again.
-- Two queries are system-facing on purpose and say so: the reconciler sweep
-- and the FileService reference lookup.

-- name: InsertOfficeJob :one
INSERT INTO office_jobs (
  id, organization_id, workspace_id, document_id, operation, format,
  base_revision, base_version_id, idempotency_key, payload_fingerprint,
  input_checksum, input_length, grant_id, output_file_id, deadline_at,
  created_by, created_by_kind
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id),
  sqlc.arg(document_id), sqlc.arg(operation), sqlc.arg(format),
  sqlc.arg(base_revision), sqlc.arg(base_version_id),
  sqlc.arg(idempotency_key), sqlc.arg(payload_fingerprint),
  sqlc.arg(input_checksum), sqlc.arg(input_length), sqlc.arg(grant_id),
  sqlc.arg(output_file_id), sqlc.arg(deadline_at),
  sqlc.arg(created_by), sqlc.arg(created_by_kind)
)
ON CONFLICT DO NOTHING
RETURNING *;

-- name: GetOfficeJob :one
SELECT *
FROM office_jobs
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id);

-- name: GetOfficeJobByIdempotencyKey :one
SELECT *
FROM office_jobs
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND idempotency_key = sqlc.arg(idempotency_key);

-- name: GetLiveOfficeJobByFingerprint :one
SELECT *
FROM office_jobs
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND base_version_id = sqlc.arg(base_version_id)
  AND payload_fingerprint = sqlc.arg(payload_fingerprint)
  AND state IN ('accepted', 'running');

-- The job's base: a version of this document in this tenant.
-- name: GetOfficeJobBaseVersion :one
SELECT *
FROM document_versions
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- name: MarkOfficeJobRunning :one
UPDATE office_jobs
SET state = 'running',
    dispatched_at = COALESCE(dispatched_at, sqlc.arg(now)),
    updated_at = sqlc.arg(now)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND state = 'accepted'
RETURNING *;

-- name: CompleteOfficeJob :one
UPDATE office_jobs
SET state = 'completed',
    output_checksum = sqlc.arg(output_checksum),
    output_length = sqlc.arg(output_length),
    finished_at = sqlc.arg(now),
    updated_at = sqlc.arg(now)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND state IN ('accepted', 'running')
RETURNING *;

-- Settle a live job as failed or timed_out. Only a live job may settle.
-- name: SettleOfficeJob :one
UPDATE office_jobs
SET state = sqlc.arg(state),
    error_code = sqlc.arg(error_code),
    error_reason = sqlc.arg(error_reason),
    finished_at = sqlc.arg(now),
    updated_at = sqlc.arg(now)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND state IN ('accepted', 'running')
  AND sqlc.arg(state)::text IN ('failed', 'timed_out')
RETURNING *;

-- Cancel wins against a live job and against a completed job whose output
-- has not been committed; a committed job is final.
-- name: CancelOfficeJob :one
UPDATE office_jobs
SET state = 'cancelled',
    error_code = 'engine_cancelled',
    error_reason = sqlc.arg(error_reason),
    finished_at = sqlc.arg(now),
    updated_at = sqlc.arg(now)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND state IN ('accepted', 'running', 'completed')
  AND committed_version_id IS NULL
RETURNING *;

-- The commit path (G1-03) claims a completed job's output inside its own
-- transaction. Exactly one commit wins; a cancelled job never matches.
-- name: MarkOfficeJobCommitted :one
UPDATE office_jobs
SET committed_version_id = sqlc.arg(committed_version_id),
    updated_at = sqlc.arg(now)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND state = 'completed'
  AND committed_version_id IS NULL
RETURNING *;

-- System sweep for the reconciler: jobs that have not settled, oldest
-- deadline first. Intentionally NOT tenant filtered - it is the worker's
-- queue, and each row it returns is then read and written through the
-- tenant-scoped queries above.
-- name: ListLiveOfficeJobs :many
SELECT *
FROM office_jobs
WHERE state IN ('accepted', 'running')
ORDER BY deadline_at
LIMIT sqlc.arg(max_rows);

-- FileService reference provider: an output file is held while its job is
-- live (the engine may still be writing it). Provider-facing, so
-- intentionally NOT tenant filtered.
-- name: ListOfficeJobOutputHolds :many
SELECT output_file_id
FROM office_jobs
WHERE output_file_id = ANY(sqlc.arg(file_ids)::text[])
  AND state IN ('accepted', 'running');

-- Tenant of every job naming one of these output files (collector audit).
-- name: FileGCOfficeJobRefTenants :many
SELECT output_file_id, organization_id
FROM office_jobs
WHERE output_file_id = ANY(sqlc.arg(file_ids)::text[]);
