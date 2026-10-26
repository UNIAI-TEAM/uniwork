-- name: CreateDriveConnection :one
INSERT INTO drive_connections (
  id, organization_id, user_id, provider, google_sub, google_email,
  refresh_token_enc, access_token_enc, access_expires_at, scopes
) VALUES (
  sqlc.arg('id'),
  sqlc.arg('organization_id'),
  sqlc.arg('user_id'),
  sqlc.arg('provider'),
  sqlc.arg('google_sub'),
  sqlc.arg('google_email'),
  sqlc.arg('refresh_token_enc'),
  sqlc.arg('access_token_enc'),
  sqlc.narg('access_expires_at'),
  sqlc.arg('scopes')
)
RETURNING *;

-- name: GetDriveConnectionByOrgUserSubForUpdate :one
-- Locks the unique (organization_id, user_id, google_sub) row across all states
-- so a reconnect or re-connect revives the existing row in place and keeps its
-- id for drive_files / drive_file_access (spec §5.3).
SELECT *
FROM drive_connections
WHERE organization_id = sqlc.arg('organization_id')
  AND user_id = sqlc.arg('user_id')
  AND google_sub = sqlc.arg('google_sub')
FOR UPDATE;

-- name: ReviveDriveConnection :one
-- Restores a disconnected or auth-failed connection on the same id, clearing
-- disconnected_at and auth_failed_at and bumping credential_version to fence
-- any older in-flight refresh (spec §5.3).
UPDATE drive_connections
SET google_email = sqlc.arg('google_email'),
    refresh_token_enc = sqlc.arg('refresh_token_enc'),
    access_token_enc = sqlc.arg('access_token_enc'),
    access_expires_at = sqlc.narg('access_expires_at'),
    scopes = sqlc.arg('scopes'),
    auth_failed_at = NULL,
    auth_failed_reason = '',
    disconnected_at = NULL,
    credential_version = credential_version + 1,
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND user_id = sqlc.arg('user_id')
RETURNING *;

-- name: ListDriveConnectionsByUser :many
SELECT *
FROM drive_connections
WHERE organization_id = sqlc.arg('organization_id')
  AND user_id = sqlc.arg('user_id')
  AND disconnected_at IS NULL
ORDER BY created_at ASC, id ASC;

-- name: GetDriveConnection :one
SELECT *
FROM drive_connections
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND user_id = sqlc.arg('user_id')
  AND disconnected_at IS NULL;

-- name: GetDriveConnectionForShare :one
-- Shared lock used when verifying source liveness before saving a task proposal
-- or creating tasks from a proposal (spec §8.2b).
SELECT *
FROM drive_connections
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND user_id = sqlc.arg('user_id')
  AND disconnected_at IS NULL
FOR SHARE;

-- name: UpdateDriveConnectionTokens :execrows
-- Conditional refresh write fenced by credential_version and the previous
-- access_expires_at so a concurrent refresh, reconnect, auth failure or
-- disconnect is never overwritten (spec §5.3).
UPDATE drive_connections
SET access_token_enc = sqlc.arg('access_token_enc'),
    access_expires_at = sqlc.narg('access_expires_at'),
    refresh_token_enc = COALESCE(NULLIF(sqlc.arg('refresh_token_enc')::text, ''), refresh_token_enc),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND credential_version = sqlc.arg('credential_version')
  AND access_expires_at IS NOT DISTINCT FROM sqlc.narg('prev_expires_at')::timestamptz
  AND disconnected_at IS NULL
  AND auth_failed_at IS NULL;

-- name: MarkDriveConnectionAuthFailed :one
-- Marks the connection lost on invalid_grant / unauthorized_client only when
-- the row still holds the credential_version that failed (spec §5.3).
UPDATE drive_connections c
SET auth_failed_at = now(),
    auth_failed_reason = sqlc.arg('reason'),
    access_token_enc = '',
    access_expires_at = NULL,
    updated_at = now()
FROM (
  SELECT o.id, o.google_sub, o.google_email
  FROM drive_connections o
  WHERE o.id = sqlc.arg('id')
    AND o.organization_id = sqlc.arg('organization_id')
    AND o.credential_version = sqlc.arg('credential_version')
    AND o.disconnected_at IS NULL
    AND o.auth_failed_at IS NULL
  FOR UPDATE
) old
WHERE c.id = old.id
RETURNING c.*;

-- name: DisconnectDriveConnection :one
-- Clears stored tokens, bumps credential_version, and returns the pre-update
-- row (including refresh_token_enc and google_sub) so the caller can enqueue a
-- revocation in drive_grant_revocations in the same transaction (spec §5.3).
UPDATE drive_connections c
SET disconnected_at = now(),
    refresh_token_enc = '',
    access_token_enc = '',
    access_expires_at = NULL,
    credential_version = c.credential_version + 1,
    updated_at = now()
FROM (
  SELECT o.id, o.organization_id, o.user_id, o.google_sub, o.google_email, o.refresh_token_enc
  FROM drive_connections o
  WHERE o.id = sqlc.arg('id')
    AND o.organization_id = sqlc.arg('organization_id')
    AND o.user_id = sqlc.arg('user_id')
    AND o.disconnected_at IS NULL
  FOR UPDATE
) old
WHERE c.id = old.id
RETURNING old.id, old.organization_id, old.user_id, old.google_sub, old.google_email, old.refresh_token_enc;

-- name: ListActiveDriveSubsForUser :many
-- tenant: self
-- Lists distinct google_sub values for the user's active Drive connections in
-- one organization or across all organizations (when organization_id is NULL)
-- without row locks so lifecycle paths can acquire sorted global drive_grant
-- advisory locks before locking drive_connections rows (spec §5.3a, §5.3b).
SELECT DISTINCT google_sub
FROM drive_connections
WHERE user_id = sqlc.arg('user_id')
  AND (sqlc.narg('organization_id')::text IS NULL OR organization_id = sqlc.narg('organization_id'))
  AND disconnected_at IS NULL
ORDER BY google_sub ASC;

-- name: DisconnectDriveConnectionsForUser :many
-- tenant: self
-- Disconnects every active Drive connection of the user in one organization
-- (leave, deactivate, organization close) or across all organizations when
-- organization_id is NULL (account deletion; spec §5.3a).
UPDATE drive_connections c
SET disconnected_at = now(),
    refresh_token_enc = '',
    access_token_enc = '',
    access_expires_at = NULL,
    credential_version = c.credential_version + 1,
    updated_at = now()
FROM (
  SELECT o.id, o.organization_id, o.user_id, o.google_sub, o.google_email, o.refresh_token_enc
  FROM drive_connections o
  WHERE o.user_id = sqlc.arg('user_id')
    AND (sqlc.narg('organization_id')::text IS NULL OR o.organization_id = sqlc.narg('organization_id'))
    AND o.disconnected_at IS NULL
  FOR UPDATE
) old
WHERE c.id = old.id
RETURNING old.id, old.organization_id, old.user_id, old.google_sub, old.google_email, old.refresh_token_enc;

-- name: CountActiveDriveConnectionsBySub :one
-- tenant: system
-- Counts remaining live connections for google_sub across all organizations
-- under the global drive_grant:<google_sub> advisory lock before revoking the
-- grant at Google (spec §5.3, §5.3b).
SELECT count(*)::bigint
FROM drive_connections
WHERE google_sub = sqlc.arg('google_sub')
  AND disconnected_at IS NULL;

-- name: LockDriveGrantSub :exec
-- Takes the global transaction-scoped advisory lock for a google_sub (spec §5.3b).
SELECT pg_advisory_xact_lock(hashtext('drive_grant:' || sqlc.arg('google_sub')::text));

-- name: GetDriveGrantRevocationForUpdate :one
-- Locks the revocation queue row for google_sub inside a callback or revocation
-- transaction (spec §5.3b, §6.8).
SELECT *
FROM drive_grant_revocations
WHERE google_sub = sqlc.arg('google_sub')
FOR UPDATE;

-- name: UpsertDriveGrantRevocation :one
-- Enqueues or advances a pending/resolved revocation request to a new
-- generation while preserving last_attempt_started_at and last_resolved_at
-- evidence timestamps; refuses to overwrite an in-flight attempt (spec §5.3b).
INSERT INTO drive_grant_revocations (
  google_sub, generation, requested_at, refresh_token_enc,
  attempt_id, attempt_started_at, resolved_at, attempts, last_error
) VALUES (
  sqlc.arg('google_sub'),
  1,
  now(),
  sqlc.narg('refresh_token_enc'),
  NULL,
  NULL,
  NULL,
  0,
  ''
)
ON CONFLICT (google_sub) DO UPDATE SET
  generation = drive_grant_revocations.generation + 1,
  requested_at = now(),
  refresh_token_enc = EXCLUDED.refresh_token_enc,
  attempt_id = NULL,
  attempt_started_at = NULL,
  resolved_at = NULL,
  attempts = 0,
  last_error = ''
WHERE drive_grant_revocations.attempt_id IS NULL
   OR drive_grant_revocations.resolved_at IS NOT NULL
RETURNING *;

-- name: ClaimDriveGrantRevocationAttempt :one
-- Claims a pending revocation or re-claims one whose lease expired
-- (attempt_started_at < lease_cutoff), stamping a new attempt_id and updating
-- both attempt_started_at and last_attempt_started_at (spec §5.3b step 1).
UPDATE drive_grant_revocations
SET attempt_id = sqlc.arg('attempt_id'),
    attempt_started_at = now(),
    last_attempt_started_at = now(),
    attempts = attempts + 1
WHERE google_sub = sqlc.arg('google_sub')
  AND refresh_token_enc IS NOT NULL
  AND resolved_at IS NULL
  AND (
    attempt_id IS NULL
    OR attempt_started_at < sqlc.arg('lease_cutoff')::timestamptz
  )
RETURNING *;

-- name: ResolveDriveGrantRevocationAttempt :execrows
-- Resolves the revocation only if (google_sub, generation, attempt_id) still
-- matches the attempt that called Google, clearing refresh_token_enc and
-- recording last_resolved_at (spec §5.3b step 3).
UPDATE drive_grant_revocations
SET resolved_at = now(),
    last_resolved_at = now(),
    refresh_token_enc = NULL,
    last_error = sqlc.arg('last_error')
WHERE google_sub = sqlc.arg('google_sub')
  AND generation = sqlc.arg('generation')
  AND attempt_id = sqlc.arg('attempt_id')
  AND resolved_at IS NULL;

-- name: CancelPendingDriveGrantRevocation :exec
-- Clears a pending revocation (when an active owner still exists or a new
-- callback succeeds after all prior attempts) while keeping evidence timestamps
-- intact (spec §5.3b).
UPDATE drive_grant_revocations
SET refresh_token_enc = NULL,
    attempt_id = NULL,
    attempt_started_at = NULL,
    resolved_at = COALESCE(resolved_at, last_resolved_at)
WHERE google_sub = sqlc.arg('google_sub')
  AND (attempt_id IS NULL OR resolved_at IS NOT NULL);

-- name: DeleteDriveGrantRevocationIfNoEvidence :exec
-- Removes a pending row that never started a Google revoke attempt when an
-- active owner still exists (spec §5.3b).
DELETE FROM drive_grant_revocations
WHERE google_sub = sqlc.arg('google_sub')
  AND attempt_id IS NULL
  AND last_attempt_started_at IS NULL
  AND last_resolved_at IS NULL;

-- name: PurgeExpiredDriveGrantRevocations :execrows
-- Purges resolved/empty revocation rows older than the 1-day evidence window
-- (spec §5.3b).
DELETE FROM drive_grant_revocations
WHERE refresh_token_enc IS NULL
  AND (attempt_id IS NULL OR resolved_at IS NOT NULL)
  AND requested_at < sqlc.arg('cutoff')::timestamptz
  AND (last_attempt_started_at IS NULL OR last_attempt_started_at < sqlc.arg('cutoff')::timestamptz)
  AND (last_resolved_at IS NULL OR last_resolved_at < sqlc.arg('cutoff')::timestamptz);

-- name: ListDueDriveGrantRevocations :many
-- Lists google_subs with a pending revocation or an expired lease for the
-- provider-lane revocation worker (spec §5.3b).
SELECT google_sub
FROM drive_grant_revocations
WHERE refresh_token_enc IS NOT NULL
  AND resolved_at IS NULL
  AND (
    attempt_id IS NULL
    OR attempt_started_at < sqlc.arg('lease_cutoff')::timestamptz
  )
ORDER BY requested_at ASC, google_sub ASC
LIMIT sqlc.arg('limit_n');
