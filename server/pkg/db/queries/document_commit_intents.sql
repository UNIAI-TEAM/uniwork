-- Logical commit intents of the file version commit (G5-07, UNI-1345;
-- migration 9991791830000200). Every time comparison uses clock_timestamp():
-- the database clock is the one clock every API instance shares, and now()
-- would be the transaction's start, which a long commit transaction outlives.

-- name: InsertDocumentCommitIntent :one
INSERT INTO document_commit_intents (
  id, organization_id, workspace_id, document_id, idempotency_key, payload_fingerprint,
  created_by, created_by_kind, claim_expires_at, retain_until
) VALUES (
  sqlc.arg('id'), sqlc.arg('organization_id'), sqlc.arg('workspace_id'), sqlc.arg('document_id'),
  sqlc.arg('idempotency_key'), sqlc.arg('payload_fingerprint'), sqlc.arg('created_by'), sqlc.arg('created_by_kind'),
  clock_timestamp() + make_interval(secs => sqlc.arg('claim_seconds')::double precision),
  clock_timestamp() + make_interval(secs => sqlc.arg('retain_seconds')::double precision)
)
ON CONFLICT (organization_id, workspace_id, idempotency_key) DO NOTHING
RETURNING *;

-- LockDocumentCommitIntent reads the row under FOR UPDATE: the claim path
-- (renew or refuse) and the commit transaction's fence both decide on it.
-- live is computed after the lock is granted, on the database clock.
-- name: LockDocumentCommitIntent :one
SELECT sqlc.embed(document_commit_intents), (claim_expires_at > clock_timestamp())::boolean AS live
FROM document_commit_intents
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND idempotency_key = sqlc.arg('idempotency_key')
FOR UPDATE;

-- ShareDocumentCommitIntent is the lookup's read. FOR SHARE waits for a commit
-- transaction that holds the row, so a lookup never answers not_committed for
-- an attempt that is about to commit; once the lock is granted, live is read
-- on the same clock the fence uses.
-- name: ShareDocumentCommitIntent :one
SELECT sqlc.embed(document_commit_intents), (claim_expires_at > clock_timestamp())::boolean AS live
FROM document_commit_intents
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND idempotency_key = sqlc.arg('idempotency_key')
FOR SHARE;

-- RenewDocumentCommitIntent hands an expired claim to a new attempt. The
-- caller holds the row lock (LockDocumentCommitIntent) and has proved the
-- claim expired; the attempt check makes a second renewer a no-op.
-- name: RenewDocumentCommitIntent :one
UPDATE document_commit_intents
SET attempt = attempt + 1,
    claim_expires_at = clock_timestamp() + make_interval(secs => sqlc.arg('claim_seconds')::double precision),
    retain_until = clock_timestamp() + make_interval(secs => sqlc.arg('retain_seconds')::double precision),
    updated_at = clock_timestamp()
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND id = sqlc.arg('id')
  AND attempt = sqlc.arg('attempt')
  AND state = 'claimed'
  AND claim_expires_at <= clock_timestamp()
RETURNING *;

-- MarkDocumentCommitIntentCommitted runs inside the commit transaction, after
-- the fence, with the version the commit produced.
-- name: MarkDocumentCommitIntentCommitted :one
UPDATE document_commit_intents
SET state = 'committed',
    version_id = sqlc.arg('version_id'),
    version = sqlc.arg('version'),
    revision = sqlc.arg('revision'),
    committed_at = clock_timestamp(),
    retain_until = clock_timestamp() + make_interval(secs => sqlc.arg('retain_seconds')::double precision),
    updated_at = clock_timestamp()
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND id = sqlc.arg('id')
  AND attempt = sqlc.arg('attempt')
  AND state = 'claimed'
RETURNING *;

-- ReleaseDocumentCommitIntent ends an attempt's own claim early after its
-- commit was refused or rolled back, so a retry of the same key does not wait
-- out the claim. It only ever shortens a live claim of that attempt and never
-- touches a committed row.
-- name: ReleaseDocumentCommitIntent :exec
UPDATE document_commit_intents
SET claim_expires_at = clock_timestamp(),
    updated_at = clock_timestamp()
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND id = sqlc.arg('id')
  AND attempt = sqlc.arg('attempt')
  AND state = 'claimed'
  AND claim_expires_at > clock_timestamp();

-- SweepDocumentCommitIntents deletes up to max_rows intents past their
-- retention whose claim is no longer live. SKIP LOCKED leaves a row a claim,
-- a commit or a lookup holds for the next pass.
-- name: SweepDocumentCommitIntents :execrows
-- tenant: system
DELETE FROM document_commit_intents
WHERE id IN (
  SELECT i.id FROM document_commit_intents i
  WHERE i.retain_until < clock_timestamp()
    AND (i.state = 'committed' OR i.claim_expires_at < clock_timestamp())
  ORDER BY i.retain_until
  LIMIT sqlc.arg('max_rows')::int
  FOR UPDATE SKIP LOCKED
);
