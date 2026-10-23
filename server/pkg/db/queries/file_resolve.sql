-- Read path of FileService (T4, spec 2026-09-22 section 8). One round trip
-- per resolve batch: the file row and the session that staged it come back
-- together, so ResolveMany never runs a query per id.

-- name: ListOrgFilesWithSessionsByIDs :many
-- Organization branch. The tenant is matched on the file AND on the session,
-- so neither half can widen the other; the caller then compares the full
-- session scope (workspace, user) with the scope it authorized.
SELECT sqlc.embed(f), sqlc.embed(s)
FROM files f
JOIN file_upload_sessions s ON s.file_id = f.id
WHERE f.organization_id = sqlc.arg('organization_id')
  AND s.organization_id = sqlc.arg('organization_id')
  AND f.id = ANY(sqlc.arg('file_ids')::text[])
ORDER BY f.id;

-- name: ListAvatarFilesWithSessionsByIDs :many
-- tenant: by-id
-- Identity branch (T1-Q10, ADR 0023): only NULL-tenant files staged by this
-- user for purpose user_avatar. It is a separate query on purpose - an
-- organization request never reaches a NULL-tenant file, and this one never
-- reaches a tenant file.
SELECT sqlc.embed(f), sqlc.embed(s)
FROM files f
JOIN file_upload_sessions s ON s.file_id = f.id
WHERE f.organization_id IS NULL
  AND s.organization_id IS NULL
  AND s.purpose = 'user_avatar'
  AND s.user_id = sqlc.arg('user_id')
  AND f.id = ANY(sqlc.arg('file_ids')::text[])
ORDER BY f.id;

-- name: GetLiveAuthSessionExpiry :one
-- Proxy tickets (T4): the latest expiry of a live refresh token in this
-- session, or NULL when the session is revoked or expired. Every ticketed
-- request asks again, so logging out or revoking the session closes the
-- proxy route at once. `now` comes from the service clock.
SELECT max(expires_at)::timestamptz AS expires_at
FROM refresh_tokens
WHERE user_id = sqlc.arg('user_id')
  AND session_id = sqlc.arg('session_id')
  AND revoked_at IS NULL
  AND expires_at > sqlc.arg('now');
