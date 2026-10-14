-- MCP connector queries (UNI-1308). mcp_clients, mcp_auth_attempts and
-- organizations are tenant-exempt; mcp_grants and mcp_tokens carry
-- organization_id and name their tenant below.

-- name: CreateMcpClient :one
INSERT INTO mcp_clients (
  id, client_id, kind, client_name, logo_uri, redirect_uris, token_endpoint_auth_method, secret_digest
) VALUES ($1, $2, 'dcr', $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpsertMcpCIMDClient :one
INSERT INTO mcp_clients (
  id, client_id, kind, client_name, logo_uri, redirect_uris, token_endpoint_auth_method, metadata_fetched_at
) VALUES ($1, $2, 'cimd', $3, $4, $5, 'none', now())
ON CONFLICT (client_id) DO UPDATE SET
  client_name = EXCLUDED.client_name,
  logo_uri = EXCLUDED.logo_uri,
  redirect_uris = EXCLUDED.redirect_uris,
  metadata_fetched_at = now()
RETURNING *;

-- name: GetMcpClientByClientID :one
SELECT * FROM mcp_clients WHERE client_id = $1;

-- name: TouchMcpClient :exec
UPDATE mcp_clients SET last_used_at = now()
WHERE client_id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes');

-- name: CreateMcpAuthAttempt :one
INSERT INTO mcp_auth_attempts (
  id, client_id, redirect_uri, code_challenge, scope, resource, state, expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetMcpAuthAttempt :one
SELECT * FROM mcp_auth_attempts WHERE id = $1;

-- name: GetMcpAuthAttemptForUpdate :one
SELECT * FROM mcp_auth_attempts WHERE id = $1 FOR UPDATE;

-- name: ClaimMcpAuthAttempt :one
-- The first signed-in reader owns the attempt; every read rotates the CSRF
-- token, so only the latest consent page can approve.
UPDATE mcp_auth_attempts SET user_id = sqlc.arg(user_id), csrf_digest = sqlc.arg(csrf_digest)
WHERE id = sqlc.arg(id)
  AND (user_id IS NULL OR user_id = sqlc.arg(user_id))
  AND approved_at IS NULL AND cancelled_at IS NULL AND expires_at > now()
RETURNING *;

-- name: ApproveMcpAuthAttempt :one
UPDATE mcp_auth_attempts
SET approved_at = now(), grant_id = $2, code_digest = $3, code_expires_at = $4
WHERE id = $1 AND approved_at IS NULL AND cancelled_at IS NULL
  AND used_at IS NULL AND expires_at > now()
RETURNING *;

-- name: CancelMcpAuthAttempt :exec
UPDATE mcp_auth_attempts SET cancelled_at = now()
WHERE id = $1 AND approved_at IS NULL AND cancelled_at IS NULL;

-- name: RedeemMcpAuthAttempt :one
UPDATE mcp_auth_attempts SET used_at = now()
WHERE code_digest = $1 AND client_id = $2 AND redirect_uri = $3 AND code_challenge = $4
  AND used_at IS NULL AND cancelled_at IS NULL AND approved_at IS NOT NULL AND code_expires_at > now()
RETURNING *;

-- name: GetMcpAuthAttemptByCodeDigest :one
SELECT * FROM mcp_auth_attempts WHERE code_digest = $1;

-- name: GetActiveMcpGrant :one
SELECT * FROM mcp_grants
WHERE organization_id = $1 AND user_id = $2 AND client_id = $3 AND revoked_at IS NULL;

-- name: CreateMcpGrant :one
INSERT INTO mcp_grants (id, organization_id, user_id, client_id, scope, created_by, created_by_kind)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetMcpGrantByID :one
-- tenant: by-id
SELECT * FROM mcp_grants WHERE id = $1;

-- name: GetMcpGrantForUpdate :one
-- tenant: by-id
SELECT * FROM mcp_grants WHERE id = $1 FOR UPDATE;

-- name: RevokeMcpGrant :execrows
-- tenant: by-id
UPDATE mcp_grants SET revoked_at = now(), revoked_by = $2, revoked_by_kind = $3
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeMcpGrantTokens :execrows
-- tenant: parent grant_id
-- Tokens that already expired are unusable and are DeleteExpiredMcpTokens's to
-- remove; touching them here would make the two wait on the same old rows in
-- different orders (40P01). The same filter is on the bulk revocations below.
UPDATE mcp_tokens SET revoked_at = now() WHERE grant_id = $1 AND revoked_at IS NULL AND expires_at > now();

-- name: TouchMcpGrant :exec
-- tenant: by-id
UPDATE mcp_grants SET last_used_at = now()
WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes');

-- name: ListMcpGrantsForUser :many
-- tenant: self
SELECT g.id, g.organization_id, o.name AS organization_name, g.client_id, c.client_name,
       c.redirect_uris, g.scope, g.created_at, g.last_used_at
FROM mcp_grants g
JOIN organizations o ON o.id = g.organization_id
JOIN mcp_clients c ON c.client_id = g.client_id
WHERE g.user_id = $1 AND g.revoked_at IS NULL
ORDER BY g.created_at DESC;

-- name: ListMcpGrantsForOrganization :many
SELECT g.id, g.organization_id, g.user_id, u.display_name AS user_name, g.client_id, c.client_name,
       c.redirect_uris, g.scope, g.created_at, g.last_used_at
FROM mcp_grants g
JOIN users u ON u.id = g.user_id
JOIN mcp_clients c ON c.client_id = g.client_id
WHERE g.organization_id = $1 AND g.revoked_at IS NULL
ORDER BY g.created_at DESC;

-- name: LockMcpGrantsForUserInOrganization :many
-- First step of revoking a person's grants in bulk (Leave): lock them in id
-- order, so a mint or rotation in flight on one of them commits before the
-- revocation reads its tokens, and two bulk revocations of one person take
-- their grants in the same sequence. Lock order everywhere: attempt, then
-- grant, then token.
SELECT id FROM mcp_grants
WHERE organization_id = sqlc.arg(organization_id) AND user_id = sqlc.arg(user_id) AND revoked_at IS NULL
ORDER BY id
FOR UPDATE;

-- name: LockAllMcpGrantsForUser :many
-- tenant: self
-- The same first step for DeleteAccount, across every organization.
SELECT id FROM mcp_grants
WHERE user_id = $1 AND revoked_at IS NULL
ORDER BY id
FOR UPDATE;

-- name: RevokeMcpTokensForUserInOrganization :execrows
UPDATE mcp_tokens t SET revoked_at = now()
WHERE t.organization_id = sqlc.arg(organization_id) AND t.revoked_at IS NULL AND t.expires_at > now()
  AND t.grant_id IN (SELECT g.id FROM mcp_grants g WHERE g.organization_id = sqlc.arg(organization_id) AND g.user_id = sqlc.arg(user_id));

-- name: RevokeMcpGrantsForUserInOrganization :execrows
UPDATE mcp_grants SET revoked_at = now(), revoked_by = sqlc.arg(user_id)::text, revoked_by_kind = 'human'
WHERE organization_id = sqlc.arg(organization_id) AND user_id = sqlc.arg(user_id) AND revoked_at IS NULL;

-- name: RevokeAllMcpTokensForUser :execrows
-- tenant: self
UPDATE mcp_tokens SET revoked_at = now()
WHERE revoked_at IS NULL AND expires_at > now() AND grant_id IN (SELECT id FROM mcp_grants WHERE user_id = $1);

-- name: RevokeAllMcpGrantsForUser :execrows
-- tenant: self
UPDATE mcp_grants SET revoked_at = now(), revoked_by = $1::text, revoked_by_kind = 'human'
WHERE user_id = $1 AND revoked_at IS NULL;

-- name: CreateMcpToken :one
INSERT INTO mcp_tokens (id, organization_id, grant_id, family_id, kind, digest, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetMcpTokenByDigest :one
-- tenant: token
SELECT * FROM mcp_tokens WHERE digest = $1;

-- name: GetMcpTokenByDigestForUpdate :one
-- tenant: token
SELECT * FROM mcp_tokens WHERE digest = $1 FOR UPDATE;

-- name: MarkMcpTokenUsed :execrows
-- tenant: by-id
UPDATE mcp_tokens SET used_at = $2 WHERE id = $1 AND used_at IS NULL;

-- name: RevokeMcpTokenByID :execrows
-- tenant: by-id
UPDATE mcp_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeMcpTokenFamily :execrows
-- tenant: parent family_id
-- Tokens that already expired are skipped for the same reason as in
-- RevokeMcpGrantTokens: the cleanup sweep deletes them, and two statements
-- waiting on the same old rows in different orders end in 40P01. An expired
-- token is refused whether or not it is marked revoked.
UPDATE mcp_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL AND expires_at > now();

-- name: GetOrganizationMcpPolicy :one
SELECT id, mcp_enabled_at, mcp_enabled_by FROM organizations WHERE id = $1;

-- name: GetOrganizationMcpPolicyForUpdate :one
-- SetPolicy reads the value it is about to change under the row lock, so the
-- audit row's before/after is true and a repeated toggle writes no second row.
SELECT id, mcp_enabled_at, mcp_enabled_by FROM organizations WHERE id = $1 FOR UPDATE;

-- name: SetOrganizationMcpPolicy :one
UPDATE organizations SET
  mcp_enabled_at = CASE WHEN sqlc.arg(enabled)::bool THEN COALESCE(mcp_enabled_at, now()) ELSE NULL END,
  mcp_enabled_by = CASE WHEN sqlc.arg(enabled)::bool THEN sqlc.arg(actor_id)::text ELSE NULL END,
  updated_at = now()
WHERE id = sqlc.arg(id)
RETURNING id, mcp_enabled_at, mcp_enabled_by;

-- name: DeleteExpiredMcpAuthAttempts :execrows
DELETE FROM mcp_auth_attempts WHERE expires_at < now() - interval '1 day';

-- name: DeleteExpiredMcpTokens :execrows
-- tenant: system
DELETE FROM mcp_tokens WHERE expires_at < now() - interval '7 days';

-- name: DeleteAbandonedMcpClients :execrows
-- tenant: system
-- A registered (dcr) client goes after 30 days unused. A metadata-document
-- (cimd) row is only a cache of a document fetched again on the next request,
-- and anyone can make the server store one by naming a URL, so it goes once it
-- has been neither used nor fetched for a day. Either kind stays while it has
-- a grant (the grant lists JOIN mcp_clients) or a live authorization attempt:
-- Start does not touch last_used_at, so without that a client could be deleted
-- between Start and Approve, which would then write a grant for a client that
-- is gone.
DELETE FROM mcp_clients c
WHERE ((c.kind = 'dcr' AND COALESCE(c.last_used_at, c.created_at) < now() - interval '30 days')
    OR (c.kind = 'cimd' AND GREATEST(c.created_at, c.metadata_fetched_at, c.last_used_at) < now() - interval '1 day'))
  AND NOT EXISTS (SELECT 1 FROM mcp_grants g WHERE g.client_id = c.client_id)
  AND NOT EXISTS (SELECT 1 FROM mcp_auth_attempts a WHERE a.client_id = c.client_id AND a.expires_at > now());
