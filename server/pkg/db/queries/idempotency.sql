-- Idempotency ledger for HTTP create/comment (and later mutations).
-- UNIQUE (organization_id, workspace_id, scope, key) is enforced by
-- idx_idempotency_keys_scope_key (migration 133).

-- name: GetIdempotencyKey :one
SELECT * FROM idempotency_keys
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND scope = sqlc.arg('scope')
  AND key = sqlc.arg('key');

-- name: InsertIdempotencyKey :one
INSERT INTO idempotency_keys (
  id, organization_id, workspace_id, scope, key, actor_id
) VALUES (
  $1, $2, $3, $4, $5, $6
)
ON CONFLICT (organization_id, workspace_id, scope, key) DO NOTHING
RETURNING *;

-- name: CompleteIdempotencyKey :exec
UPDATE idempotency_keys
SET response_status = sqlc.arg('response_status'),
    response_body = sqlc.arg('response_body')
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND scope = sqlc.arg('scope')
  AND key = sqlc.arg('key')
  AND response_status IS NULL;

-- name: CountIdempotencyKeys :one
SELECT count(*)::bigint FROM idempotency_keys
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND scope = sqlc.arg('scope')
  AND key = sqlc.arg('key');
