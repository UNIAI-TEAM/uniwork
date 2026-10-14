-- name: InsertWorkspaceAlias :exec
INSERT INTO workspace_aliases (id, organization_id, workspace_id, kind, value)
VALUES ($1, $2, $3, $4, $5);

-- name: DeleteWorkspaceAlias :exec
-- Case-insensitive, so a task prefix matches in any case; slugs are always
-- lower-case.
DELETE FROM workspace_aliases
WHERE organization_id = sqlc.arg('organization_id') AND workspace_id = sqlc.arg('workspace_id')
  AND kind = sqlc.arg('kind') AND upper(value) = upper(sqlc.arg('value'));
