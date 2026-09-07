-- name: ListProjects :many
SELECT * FROM projects
WHERE organization_id = $1 AND workspace_id = $2
ORDER BY updated_at DESC, id;

-- name: GetProject :one
SELECT * FROM projects
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3;

-- name: CreateProject :one
INSERT INTO projects (
  id, organization_id, workspace_id, title, description, icon, status, priority,
  lead_type, lead_id, start_date, due_date, revision, created_by, created_by_kind
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8,
  $9, $10, $11, $12, $13, $14, $15
)
RETURNING *;

-- name: UpdateProject :one
UPDATE projects SET
  title       = COALESCE(sqlc.narg('title'), title),
  description = COALESCE(sqlc.narg('description'), description),
  icon        = COALESCE(sqlc.narg('icon'), icon),
  status      = COALESCE(sqlc.narg('status'), status),
  priority    = COALESCE(sqlc.narg('priority'), priority),
  lead_type   = COALESCE(sqlc.narg('lead_type'), lead_type),
  lead_id     = COALESCE(sqlc.narg('lead_id'), lead_id),
  start_date  = COALESCE(sqlc.narg('start_date'), start_date),
  due_date    = COALESCE(sqlc.narg('due_date'), due_date),
  revision    = revision + 1,
  updated_at  = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
RETURNING *;

-- name: DeleteProject :exec
DELETE FROM projects
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3;

-- name: ListProjectResources :many
SELECT * FROM project_resources
WHERE project_id = $1 AND organization_id = $2 AND workspace_id = $3
ORDER BY position, created_at, id;

-- name: CreateProjectResource :one
INSERT INTO project_resources (
  id, organization_id, workspace_id, project_id, resource_type, resource_ref,
  label, position, created_by, created_by_kind
) VALUES (
  $1, $2, $3, $4, $5, $6,
  $7, $8, $9, $10
)
RETURNING *;

-- name: UpdateProjectResource :one
UPDATE project_resources SET
  resource_ref = COALESCE(sqlc.narg('resource_ref'), resource_ref),
  label        = COALESCE(sqlc.narg('label'), label),
  position     = COALESCE(sqlc.narg('position'), position),
  updated_at   = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
RETURNING *;

-- name: DeleteProjectResource :exec
DELETE FROM project_resources
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3;
