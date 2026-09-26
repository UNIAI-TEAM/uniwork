-- Upload coordination rows (spec 2026-09-22 section 4.3). Sessions are
-- internal plumbing: the service always reaches them with an actor/scope
-- check first, and the idempotency lookup binds key -> actor -> scope ->
-- purpose exactly (T1-Q8).

-- name: InsertUploadSession :one
-- One row per logical upload. The actor pair, verified scope and purpose are
-- fixed here; idempotency uniqueness is enforced by
-- uidx_file_upload_sessions_idempotency.
INSERT INTO file_upload_sessions (
  id, file_id, created_by, created_by_kind, purpose,
  organization_id, workspace_id, user_id,
  idempotency_key, command_fingerprint, provider_operation_id
) VALUES (
  sqlc.arg('id'), sqlc.arg('file_id'), sqlc.arg('created_by'),
  sqlc.arg('created_by_kind'), sqlc.arg('purpose'),
  sqlc.arg('organization_id'), sqlc.arg('workspace_id'), sqlc.arg('user_id'),
  sqlc.arg('idempotency_key'), sqlc.arg('command_fingerprint'),
  sqlc.arg('provider_operation_id')
) RETURNING *;

-- name: GetUploadSessionByID :one
SELECT * FROM file_upload_sessions WHERE id = sqlc.arg('id');

-- name: GetUploadSessionByIDForUpdate :one
SELECT * FROM file_upload_sessions WHERE id = sqlc.arg('id') FOR UPDATE;

-- name: FindUploadSessionByIdempotencyKey :one
-- Replay lookup: the key is bound to the same actor pair, purpose and full
-- scope (T1-Q8). IS NOT DISTINCT FROM keeps NULL scope fields comparable.
SELECT * FROM file_upload_sessions
WHERE created_by_kind = sqlc.arg('created_by_kind')
  AND created_by = sqlc.arg('created_by')
  AND purpose = sqlc.arg('purpose')
  AND organization_id IS NOT DISTINCT FROM sqlc.arg('organization_id')
  AND workspace_id IS NOT DISTINCT FROM sqlc.arg('workspace_id')
  AND user_id IS NOT DISTINCT FROM sqlc.arg('user_id')
  AND idempotency_key = sqlc.arg('idempotency_key');

-- name: GetUploadSessionByProviderOp :one
-- Provider callback -> session (egress/job completion retry path).
SELECT * FROM file_upload_sessions
WHERE provider_operation_id = sqlc.arg('provider_operation_id');

-- name: GetUploadSessionByFile :one
-- file_id is unique per session; the session row is the temporary grant the
-- claim path consumes.
SELECT * FROM file_upload_sessions WHERE file_id = sqlc.arg('file_id');

-- name: LockUploadSessionsByFileIDs :many
-- Lock contract step 2: after LockFilesInIDOrder, lock sessions in the same
-- file_id order before mutating (spec 9.5).
SELECT * FROM file_upload_sessions
WHERE file_id = ANY(sqlc.arg('file_ids')::text[])
ORDER BY file_id
FOR UPDATE;

-- name: AcquireUploadSessionLease :execrows
-- Write lease: take it only while the session is still open and no live lease
-- blocks it. Zero rows means another writer owns it - refuse, do not wait.
UPDATE file_upload_sessions SET
  lease_owner = sqlc.arg('lease_owner'),
  lease_expires_at = sqlc.arg('lease_expires_at'),
  updated_at = now()
WHERE id = sqlc.arg('id')
  AND status IN ('receiving', 'staged')
  AND (lease_expires_at IS NULL
       OR lease_expires_at <= now()
       OR lease_owner = sqlc.arg('lease_owner'));

-- name: ReleaseUploadSessionLease :execrows
UPDATE file_upload_sessions SET
  lease_owner = NULL,
  lease_expires_at = NULL,
  updated_at = now()
WHERE id = sqlc.arg('id') AND lease_owner = sqlc.arg('lease_owner');

-- name: MarkUploadSessionStaged :execrows
-- receiving -> staged when the file readies: stamp the 24h claim deadline
-- (ready_at + 24h, T1-Q5) and drop the write lease.
UPDATE file_upload_sessions SET
  status = 'staged',
  claim_expires_at = sqlc.arg('claim_expires_at'),
  lease_owner = NULL,
  lease_expires_at = NULL,
  updated_at = now()
WHERE id = sqlc.arg('id') AND status = 'receiving';

-- name: ConsumeUploadSession :execrows
-- Claim consumes the grant: staged -> claimed, only inside the deadline.
-- Zero rows means already claimed/canceled/expired or past the window - the
-- service maps that to file_already_claimed / file_claim_expired (T1-Q5).
UPDATE file_upload_sessions SET
  status = 'claimed',
  closed_at = now(),
  updated_at = now()
WHERE id = sqlc.arg('id')
  AND status = 'staged'
  AND claim_expires_at > now();

-- name: CancelUploadSession :execrows
-- Either open state -> canceled; terminal rows never resurrect (T1-Q8).
UPDATE file_upload_sessions SET
  status = 'canceled',
  lease_owner = NULL,
  lease_expires_at = NULL,
  closed_at = now(),
  updated_at = now()
WHERE id = sqlc.arg('id') AND status IN ('receiving', 'staged');

-- name: CancelOrgUploadSessions :execrows
-- Tenant teardown: every still-open session in the organization is canceled.
UPDATE file_upload_sessions SET
  status = 'canceled',
  lease_owner = NULL,
  lease_expires_at = NULL,
  closed_at = now(),
  updated_at = now()
WHERE organization_id = sqlc.arg('organization_id')
  AND status IN ('receiving', 'staged');

-- name: ExpireUploadSessions :many
-- Daily sweep: staged sessions past the claim deadline. The update marks
-- them and returns the rows so the worker can schedule file cleanup.
UPDATE file_upload_sessions SET
  status = 'expired',
  closed_at = now(),
  updated_at = now()
WHERE status = 'staged' AND claim_expires_at <= now()
RETURNING *;

-- name: BumpUploadSessionFile :execrows
-- Technical retry after an uncertain write (spec 9.4): repoint the session
-- at the new attempt file, bump the write generation and drop the lease, so
-- a stale completion carrying the old generation is refused.
UPDATE file_upload_sessions SET
  file_id = sqlc.arg('file_id'),
  generation = generation + 1,
  lease_owner = NULL,
  lease_expires_at = NULL,
  updated_at = now()
WHERE id = sqlc.arg('id') AND status IN ('receiving', 'staged');
