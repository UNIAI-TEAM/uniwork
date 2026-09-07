-- Feature flag overrides (F-11 §7). The DB provider reads the whole table
-- into a 30 s cache; the admin service writes it.

-- name: ListActiveFlagOverrides :many
SELECT * FROM feature_flag_overrides
WHERE expires_at IS NULL OR expires_at > now()
ORDER BY flag_key, scope_type, scope_id;

-- name: ListFlagOverridesByKey :many
SELECT * FROM feature_flag_overrides WHERE flag_key = $1 ORDER BY scope_type, scope_id;

-- name: CountFlagOverridesByKey :many
SELECT flag_key, count(*)::bigint AS n FROM feature_flag_overrides
WHERE expires_at IS NULL OR expires_at > now()
GROUP BY flag_key;

-- name: GetFlagOverride :one
SELECT * FROM feature_flag_overrides WHERE flag_key = $1 AND scope_type = $2 AND scope_id = $3;

-- name: UpsertFlagOverride :one
INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by, created_by_kind, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'human', $8)
ON CONFLICT (flag_key, scope_type, scope_id) DO UPDATE SET
  enabled = EXCLUDED.enabled, note = EXCLUDED.note, created_by = EXCLUDED.created_by,
  created_at = now(), expires_at = EXCLUDED.expires_at
RETURNING *;

-- name: DeleteFlagOverride :execrows
DELETE FROM feature_flag_overrides WHERE flag_key = $1 AND scope_type = $2 AND scope_id = $3;

-- name: AdminListAllFlagOverrides :many
-- The console's Flags screen: every override in one round trip, so a
-- catalogue of N flags costs one query instead of N.
SELECT * FROM feature_flag_overrides ORDER BY flag_key, scope_type, scope_id;
