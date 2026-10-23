-- FileService coordination jobs (spec 2026-09-22 section 9.4). Workers claim
-- with SKIP LOCKED, lease ownership plus generation fencing makes a stale
-- completion a no-op, and a failure always returns the job to pending for
-- the next daily scan - retry intent is never dropped.

-- name: EnqueueFileJob :exec
-- uidx_file_jobs_live dedupes: a live job for the same (file, operation)
-- makes this insert a no-op.
INSERT INTO file_jobs (
  id, file_id, organization_id, operation, next_attempt_at, details, retain_until
) VALUES (
  sqlc.arg('id'), sqlc.arg('file_id'), sqlc.arg('organization_id'),
  sqlc.arg('operation'), sqlc.arg('next_attempt_at'),
  sqlc.arg('details')::jsonb, sqlc.arg('retain_until')
)
ON CONFLICT (file_id, operation) WHERE status IN ('pending', 'leased')
DO NOTHING;

-- name: GetFileJob :one
-- tenant: system
SELECT * FROM file_jobs WHERE id = sqlc.arg('id');

-- name: ListFileJobsByFile :many
-- tenant: system
-- Reconcile/claim-time view of every job queued for a file.
SELECT * FROM file_jobs
WHERE file_id = sqlc.arg('file_id')
ORDER BY created_at, id;

-- name: LockFileJobsInIDOrder :many
-- tenant: system
-- Lock contract step 3: after files and sessions, lock job rows ordered by id
-- before mutating them (spec 9.5).
SELECT * FROM file_jobs
WHERE id = ANY(sqlc.arg('job_ids')::text[])
ORDER BY id
FOR UPDATE;

-- name: ClaimFileJobs :many
-- tenant: system
-- Lease the next runnable batch. SKIP LOCKED lets replicas share the scan;
-- the UPDATE flips each winner to leased with owner + expiry + a bumped
-- generation, so a late-finish from an older lease is fenced off. `now` and
-- `lease_expires_at` are caller-supplied so lease timing is deterministic.
UPDATE file_jobs SET
  status = 'leased',
  lease_owner = sqlc.arg('lease_owner'),
  lease_expires_at = sqlc.arg('lease_expires_at'),
  generation = generation + 1,
  updated_at = now()
WHERE id IN (
  SELECT file_jobs.id FROM file_jobs
  WHERE file_jobs.status = 'pending' AND file_jobs.next_attempt_at <= sqlc.arg('now')
  ORDER BY file_jobs.next_attempt_at, file_jobs.id
  LIMIT sqlc.arg('limit_n')
  FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: ReleaseExpiredFileJobLeases :execrows
-- tenant: system
-- Crashed-worker recovery: a lease that outlived its expiry returns to
-- pending and is claimable again. `now` is the caller's sweep instant.
UPDATE file_jobs SET
  status = 'pending',
  lease_owner = NULL,
  lease_expires_at = NULL,
  updated_at = now()
WHERE status = 'leased' AND lease_expires_at <= sqlc.arg('now');

-- name: CompleteFileJob :execrows
-- tenant: system
-- leased -> succeeded, fenced by owner + generation so only the live holder
-- can close the job. finished_at is caller-supplied.
UPDATE file_jobs SET
  status = 'succeeded',
  attempt = attempt + 1,
  lease_owner = NULL,
  lease_expires_at = NULL,
  error_code = NULL,
  finished_at = sqlc.arg('finished_at'),
  updated_at = now()
WHERE id = sqlc.arg('id')
  AND status = 'leased'
  AND generation = sqlc.arg('generation')
  AND lease_owner = sqlc.arg('lease_owner');

-- name: RetryFileJob :execrows
-- tenant: system
-- leased -> pending with the next-scan backoff. The job is never dropped:
-- alerting keys off attempt count and age, not a terminal failure state.
UPDATE file_jobs SET
  status = 'pending',
  attempt = attempt + 1,
  next_attempt_at = sqlc.arg('next_attempt_at'),
  error_code = sqlc.arg('error_code'),
  lease_owner = NULL,
  lease_expires_at = NULL,
  updated_at = now()
WHERE id = sqlc.arg('id')
  AND status = 'leased'
  AND generation = sqlc.arg('generation')
  AND lease_owner = sqlc.arg('lease_owner');

-- name: FailFileJob :execrows
-- tenant: system
-- Terminal failure after a retry sequence the worker chooses to stop:
-- leased -> failed, fenced the same way. finished_at is caller-supplied.
UPDATE file_jobs SET
  status = 'failed',
  attempt = attempt + 1,
  error_code = sqlc.arg('error_code'),
  lease_owner = NULL,
  lease_expires_at = NULL,
  finished_at = sqlc.arg('finished_at'),
  updated_at = now()
WHERE id = sqlc.arg('id')
  AND status = 'leased'
  AND generation = sqlc.arg('generation')
  AND lease_owner = sqlc.arg('lease_owner');

-- name: CancelPendingFileJobs :execrows
-- tenant: parent file_id
-- Claim/GC voids queued same-operation work for a file (e.g. a cleanup job
-- whose file just got referenced). Only pending rows cancel - a leased row
-- is fenced by its generation instead. finished_at is caller-supplied.
UPDATE file_jobs SET
  status = 'canceled',
  lease_owner = NULL,
  lease_expires_at = NULL,
  finished_at = sqlc.arg('finished_at'),
  updated_at = now()
WHERE file_id = sqlc.arg('file_id')
  AND operation = sqlc.arg('operation')
  AND status = 'pending';
