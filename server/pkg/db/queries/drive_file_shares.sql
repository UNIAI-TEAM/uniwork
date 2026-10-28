-- name: CreateDriveFileShare :one
INSERT INTO drive_file_shares (
  id, organization_id, workspace_id, drive_file_id,
  principal_type, principal_id, level,
  created_by, created_by_kind
) VALUES (
  sqlc.arg('id'),
  sqlc.arg('organization_id'),
  sqlc.arg('workspace_id'),
  sqlc.arg('drive_file_id'),
  sqlc.arg('principal_type'),
  sqlc.arg('principal_id'),
  sqlc.arg('level'),
  sqlc.arg('created_by'),
  sqlc.arg('created_by_kind')
)
RETURNING *;

-- name: GetLiveDriveFileShareByPrincipal :one
SELECT *
FROM drive_file_shares
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_file_id = sqlc.arg('drive_file_id')
  AND principal_type = sqlc.arg('principal_type')
  AND principal_id = sqlc.arg('principal_id')
  AND revoked_at IS NULL;

-- name: GetLiveDriveFileShareByID :one
SELECT *
FROM drive_file_shares
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_file_id = sqlc.arg('drive_file_id')
  AND revoked_at IS NULL;

-- name: ListLiveDriveFileSharesByFile :many
SELECT s.*,
       CASE
         WHEN s.principal_type = 'user' THEN COALESCE(pu.display_name, '')
         WHEN s.principal_type = 'workspace' THEN COALESCE(pw.name, '')
         WHEN s.principal_type = 'organization' THEN COALESCE(po.name, '')
         ELSE ''
       END::text AS principal_name,
       CASE
         WHEN s.principal_type = 'user' THEN COALESCE(pu.email, '')
         WHEN s.principal_type = 'workspace' THEN COALESCE(pw.slug, '')
         WHEN s.principal_type = 'organization' THEN COALESCE(po.slug, '')
         ELSE ''
       END::text AS principal_subtitle,
       COALESCE(cu.display_name, '')::text AS created_by_name
FROM drive_file_shares s
LEFT JOIN users pu
  ON s.principal_type = 'user' AND pu.id = s.principal_id
LEFT JOIN workspaces pw
  ON s.principal_type = 'workspace' AND pw.id = s.principal_id AND pw.organization_id = s.organization_id
LEFT JOIN organizations po
  ON s.principal_type = 'organization' AND po.id = s.principal_id
LEFT JOIN users cu
  ON cu.id = s.created_by
WHERE s.organization_id = sqlc.arg('organization_id')
  AND s.workspace_id = sqlc.arg('workspace_id')
  AND s.drive_file_id = sqlc.arg('drive_file_id')
  AND s.revoked_at IS NULL
ORDER BY s.created_at ASC, s.id ASC;

-- name: ListLiveDriveFileSharesByFileIDs :many
SELECT s.*,
       COALESCE(cu.display_name, '')::text AS created_by_name
FROM drive_file_shares s
LEFT JOIN users cu ON cu.id = s.created_by
WHERE s.organization_id = sqlc.arg('organization_id')
  AND s.workspace_id = sqlc.arg('workspace_id')
  AND s.drive_file_id = ANY(sqlc.arg('drive_file_ids')::text[])
  AND s.revoked_at IS NULL
ORDER BY s.created_at DESC, s.id DESC;

-- name: HasViewerDriveFileShare :one
SELECT EXISTS (
  SELECT 1
  FROM drive_file_shares s
  WHERE s.organization_id = sqlc.arg('organization_id')
    AND s.workspace_id = sqlc.arg('workspace_id')
    AND s.drive_file_id = sqlc.arg('drive_file_id')
    AND s.revoked_at IS NULL
    AND (
      (s.principal_type = 'user' AND s.principal_id = sqlc.arg('viewer_user_id'))
      OR (s.principal_type = 'workspace' AND s.principal_id = sqlc.arg('workspace_id'))
      OR (s.principal_type = 'organization' AND s.principal_id = sqlc.arg('organization_id'))
    )
)::boolean;

-- name: RevokeDriveFileShareByID :one
UPDATE drive_file_shares
SET revoked_at = now(),
    revoked_by = sqlc.arg('revoked_by'),
    revoked_by_kind = sqlc.arg('revoked_by_kind')
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_file_id = sqlc.arg('drive_file_id')
  AND revoked_at IS NULL
RETURNING *;

-- name: RevokeDriveFileSharesByFile :execrows
UPDATE drive_file_shares
SET revoked_at = now(),
    revoked_by = sqlc.arg('revoked_by'),
    revoked_by_kind = sqlc.arg('revoked_by_kind')
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_file_id = sqlc.arg('drive_file_id')
  AND revoked_at IS NULL;

-- name: RevokeDriveFileSharesByUserInWorkspace :execrows
UPDATE drive_file_shares
SET revoked_at = now(),
    revoked_by = sqlc.arg('revoked_by'),
    revoked_by_kind = sqlc.arg('revoked_by_kind')
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND principal_type = 'user'
  AND principal_id = sqlc.arg('user_id')
  AND revoked_at IS NULL;

-- name: RevokeDriveFileSharesByUserInOrg :execrows
UPDATE drive_file_shares
SET revoked_at = now(),
    revoked_by = sqlc.arg('revoked_by'),
    revoked_by_kind = sqlc.arg('revoked_by_kind')
WHERE organization_id = sqlc.arg('organization_id')
  AND principal_type = 'user'
  AND principal_id = sqlc.arg('user_id')
  AND revoked_at IS NULL;

-- name: RevokeDriveFileSharesByUserAllOrgs :execrows
-- tenant: self
UPDATE drive_file_shares
SET revoked_at = now(),
    revoked_by = sqlc.arg('revoked_by'),
    revoked_by_kind = sqlc.arg('revoked_by_kind')
WHERE principal_type = 'user'
  AND principal_id = sqlc.arg('user_id')
  AND revoked_at IS NULL;

-- name: CountActiveWorkspaceMembers :one
SELECT count(*)::bigint
FROM organization_members om
LEFT JOIN workspace_members wm
  ON wm.workspace_id = sqlc.arg('workspace_id')::text
 AND wm.user_id = om.user_id
WHERE om.organization_id = sqlc.arg('organization_id')::text
  AND om.deactivated_at IS NULL
  AND (wm.user_id IS NOT NULL OR om.role IN ('owner', 'admin'));

-- name: ListDriveFileSharePrincipalCandidates :many
SELECT
  c.principal_type,
  c.principal_id,
  c.name,
  c.subtitle,
  c.avatar_url,
  c.avatar_file_id,
  c.icon_emoji,
  c.direct_level,
  c.is_home_workspace,
  c.sort_name,
  c.type_rank
FROM (
  SELECT
    'user'::text AS principal_type,
    u.id AS principal_id,
    u.display_name AS name,
    u.email AS subtitle,
    u.avatar_url AS avatar_url,
    u.avatar_file_id AS avatar_file_id,
    NULL::text AS icon_emoji,
    COALESCE((
      SELECT dfs.level FROM drive_file_shares dfs
      WHERE dfs.organization_id = om.organization_id
        AND dfs.workspace_id = sqlc.arg('workspace_id')::text
        AND dfs.drive_file_id = sqlc.arg('drive_file_id')::text
        AND dfs.principal_type = 'user'
        AND dfs.principal_id = u.id
        AND dfs.revoked_at IS NULL
    ), '')::text AS direct_level,
    false AS is_home_workspace,
    lower(u.display_name) AS sort_name,
    0 AS type_rank
  FROM organization_members om
  JOIN users u ON u.id = om.user_id
  LEFT JOIN workspace_members wm
    ON wm.workspace_id = sqlc.arg('workspace_id')::text
   AND wm.user_id = om.user_id
  WHERE om.organization_id = sqlc.arg('organization_id')::text
    AND om.deactivated_at IS NULL
    AND (wm.user_id IS NOT NULL OR om.role IN ('owner', 'admin'))

  UNION ALL

  SELECT
    'workspace'::text AS principal_type,
    w.id AS principal_id,
    w.name AS name,
    w.slug AS subtitle,
    NULL::text AS avatar_url,
    NULL::text AS avatar_file_id,
    w.icon_emoji AS icon_emoji,
    COALESCE((
      SELECT dfs.level FROM drive_file_shares dfs
      WHERE dfs.organization_id = w.organization_id
        AND dfs.workspace_id = sqlc.arg('workspace_id')::text
        AND dfs.drive_file_id = sqlc.arg('drive_file_id')::text
        AND dfs.principal_type = 'workspace'
        AND dfs.principal_id = w.id
        AND dfs.revoked_at IS NULL
    ), '')::text AS direct_level,
    true AS is_home_workspace,
    lower(w.name) AS sort_name,
    1 AS type_rank
  FROM workspaces w
  WHERE w.organization_id = sqlc.arg('organization_id')::text
    AND w.id = sqlc.arg('workspace_id')::text
) c
WHERE (
    sqlc.narg('q')::text IS NULL
    OR uw_fold_search(c.name) LIKE '%' || sqlc.narg('q')::text || '%' ESCAPE '\'
    OR uw_fold_search(c.subtitle) LIKE '%' || sqlc.narg('q')::text || '%' ESCAPE '\'
  )
  AND (
    sqlc.narg('cursor_rank')::int IS NULL
    OR (c.type_rank, c.sort_name, c.principal_id) > (
      sqlc.narg('cursor_rank')::int,
      sqlc.narg('cursor_name')::text,
      sqlc.narg('cursor_id')::text
    )
  )
ORDER BY c.type_rank ASC, c.sort_name ASC, c.principal_id ASC
LIMIT sqlc.arg('row_limit')::int;
