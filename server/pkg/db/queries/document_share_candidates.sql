-- Share candidates for one document (SH-S2, UNI-1781): active organization
-- members, workspaces of the document's organization, and the organization
-- row itself, scoped to organization_id.
-- The caller is authorized with authorizeDocumentAdminister before this query
-- runs. The page is ordered users (rank 0), then workspaces (rank 1), then the
-- organization (rank 2), and by name then id inside a rank; the keyset cursor
-- compares the same keys, so a page never repeats or skips a candidate
-- (contract §1.2, R1-11).
--
-- The search term arrives already folded (foldForSearch) and LIKE-escaped, and
-- is matched against uw_fold_search(name) and uw_fold_search(subtitle) (email
-- for users, slug for workspaces and organization).

-- name: ListDocumentSharePrincipalCandidates :many
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
      SELECT ds.level FROM document_shares ds
      WHERE ds.organization_id = om.organization_id
        AND ds.workspace_id = sqlc.arg(workspace_id)::text
        AND ds.document_id = sqlc.arg(document_id)::text
        AND ds.principal_type = 'user'
        AND ds.principal_id = u.id
        AND ds.revoked_at IS NULL
    ), '')::text AS direct_level,
    false AS is_home_workspace,
    lower(u.display_name) AS sort_name,
    0 AS type_rank
  FROM organization_members om
  JOIN users u ON u.id = om.user_id
  WHERE om.organization_id = sqlc.arg(organization_id)::text
    AND om.deactivated_at IS NULL

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
      SELECT ds.level FROM document_shares ds
      WHERE ds.organization_id = w.organization_id
        AND ds.workspace_id = sqlc.arg(workspace_id)::text
        AND ds.document_id = sqlc.arg(document_id)::text
        AND ds.principal_type = 'workspace'
        AND ds.principal_id = w.id
        AND ds.revoked_at IS NULL
    ), '')::text AS direct_level,
    (w.id = sqlc.arg(workspace_id)::text) AS is_home_workspace,
    lower(w.name) AS sort_name,
    1 AS type_rank
  FROM workspaces w
  WHERE w.organization_id = sqlc.arg(organization_id)::text

  UNION ALL

  SELECT
    'organization'::text AS principal_type,
    o.id AS principal_id,
    o.name AS name,
    o.slug AS subtitle,
    NULL::text AS avatar_url,
    NULL::text AS avatar_file_id,
    NULL::text AS icon_emoji,
    COALESCE((
      SELECT ds.level FROM document_shares ds
      WHERE ds.organization_id = o.id
        AND ds.workspace_id = sqlc.arg(workspace_id)::text
        AND ds.document_id = sqlc.arg(document_id)::text
        AND ds.principal_type = 'organization'
        AND ds.principal_id = o.id
        AND ds.revoked_at IS NULL
    ), '')::text AS direct_level,
    false AS is_home_workspace,
    lower(o.name) AS sort_name,
    2 AS type_rank
  FROM organizations o
  WHERE o.id = sqlc.arg(organization_id)::text
) c
WHERE (
    sqlc.narg(q)::text IS NULL
    OR uw_fold_search(c.name) LIKE '%' || sqlc.narg(q)::text || '%' ESCAPE '\'
    OR uw_fold_search(c.subtitle) LIKE '%' || sqlc.narg(q)::text || '%' ESCAPE '\'
  )
  AND (
    sqlc.narg(cursor_rank)::int IS NULL
    OR (c.type_rank, c.sort_name, c.principal_id) > (
      sqlc.narg(cursor_rank)::int,
      sqlc.narg(cursor_name)::text,
      sqlc.narg(cursor_id)::text
    )
  )
ORDER BY c.type_rank ASC, c.sort_name ASC, c.principal_id ASC
LIMIT sqlc.arg(row_limit)::int;
