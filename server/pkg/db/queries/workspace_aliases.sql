-- name: InsertWorkspaceAlias :exec
INSERT INTO workspace_aliases (id, organization_id, workspace_id, kind, value)
VALUES ($1, $2, $3, $4, $5);

-- name: DeleteWorkspaceAlias :exec
-- Case-insensitive, so a task prefix matches in any case; slugs are always
-- lower-case.
DELETE FROM workspace_aliases
WHERE organization_id = sqlc.arg('organization_id') AND workspace_id = sqlc.arg('workspace_id')
  AND kind = sqlc.arg('kind') AND upper(value) = upper(sqlc.arg('value'));

-- name: GetWorkspaceSlugAliasOwner :one
SELECT workspace_id FROM workspace_aliases
WHERE organization_id = sqlc.arg('organization_id') AND kind = 'slug' AND value = sqlc.arg('value');

-- name: GetWorkspaceBySlugAlias :one
-- tenant: by-id
-- An old slug: the workspace it belongs to, with its current slug, in the
-- shape of GetWorkspaceBySlugs.
SELECT w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspace_aliases a
JOIN workspaces w ON w.id = a.workspace_id AND w.organization_id = a.organization_id
JOIN organizations o ON o.id = w.organization_id
WHERE o.slug = sqlc.arg('org_slug') AND a.kind = 'slug' AND a.value = sqlc.arg('value');
