-- name: ListProjects :many
SELECT * FROM projects
WHERE organization_id = $1 AND workspace_id = $2
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
  AND (sqlc.narg('priority')::text IS NULL OR priority = sqlc.narg('priority'))
ORDER BY updated_at DESC, id;

-- name: SearchProjects :many
-- total_count is the window count over the filtered set (not the page length).
SELECT
  id, organization_id, workspace_id, title, description, icon, status, priority,
  lead_type, lead_id, start_date, due_date, revision, created_by, created_by_kind,
  created_at, updated_at,
  count(*) OVER ()::bigint AS total_count
FROM projects
WHERE organization_id = $1 AND workspace_id = $2
  AND (
    title ILIKE '%' || sqlc.arg('q') || '%'
    OR description ILIKE '%' || sqlc.arg('q') || '%'
  )
  AND (
    sqlc.arg('include_closed')::bool
    OR status NOT IN ('completed', 'cancelled')
  )
ORDER BY
  CASE WHEN lower(title) = lower(sqlc.arg('q')) THEN 0
       WHEN lower(title) LIKE lower(sqlc.arg('q')) || '%' THEN 1
       ELSE 2 END,
  updated_at DESC,
  id
LIMIT sqlc.arg('limit_count') OFFSET sqlc.arg('offset_count');

-- name: CountSearchProjects :one
-- Empty pages have no window row to carry total_count; use this fallback.
SELECT count(*)::bigint FROM projects
WHERE organization_id = $1 AND workspace_id = $2
  AND (
    title ILIKE '%' || sqlc.arg('q') || '%'
    OR description ILIKE '%' || sqlc.arg('q') || '%'
  )
  AND (
    sqlc.arg('include_closed')::bool
    OR status NOT IN ('completed', 'cancelled')
  );

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
  lead_type   = CASE WHEN sqlc.arg('set_lead')::bool THEN sqlc.narg('lead_type') ELSE lead_type END,
  lead_id     = CASE WHEN sqlc.arg('set_lead')::bool THEN sqlc.narg('lead_id') ELSE lead_id END,
  start_date  = CASE WHEN sqlc.arg('set_start_date')::bool THEN sqlc.narg('start_date') ELSE start_date END,
  due_date    = CASE WHEN sqlc.arg('set_due_date')::bool THEN sqlc.narg('due_date') ELSE due_date END,
  revision    = revision + 1,
  updated_at  = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND revision = sqlc.arg('expected_revision')
RETURNING *;

-- name: DeleteProject :execrows
DELETE FROM projects
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3;

-- name: GetProjectTaskStats :many
SELECT project_id,
  COUNT(*)::bigint AS total_count,
  COUNT(*) FILTER (WHERE status IN ('done', 'cancelled'))::bigint AS done_count
FROM tasks
WHERE organization_id = $1
  AND workspace_id = $2
  AND project_id = ANY(sqlc.arg('project_ids')::text[])
GROUP BY project_id;

-- name: GetProjectResourceCounts :many
SELECT project_id, COUNT(*)::bigint AS resource_count
FROM project_resources
WHERE organization_id = $1
  AND workspace_id = $2
  AND project_id = ANY(sqlc.arg('project_ids')::text[])
GROUP BY project_id;

-- name: ListProjectResources :many
SELECT * FROM project_resources
WHERE project_id = $1 AND organization_id = $2 AND workspace_id = $3
ORDER BY position, created_at, id;

-- name: GetProjectResource :one
SELECT * FROM project_resources
WHERE id = $1
  AND project_id = $2
  AND organization_id = $3
  AND workspace_id = $4;

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
  AND project_id = sqlc.arg('project_id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
RETURNING *;

-- name: DeleteProjectResource :execrows
DELETE FROM project_resources
WHERE id = $1
  AND project_id = $2
  AND organization_id = $3
  AND workspace_id = $4;

-- name: DeleteProjectResourcesByProject :exec
DELETE FROM project_resources
WHERE project_id = $1 AND organization_id = $2 AND workspace_id = $3;

-- name: ClearTasksProjectID :many
UPDATE tasks SET project_id = NULL, revision = revision + 1, updated_at = now()
WHERE project_id = $1 AND organization_id = $2 AND workspace_id = $3
RETURNING id;

-- name: DeleteTaskViewsByProjectScope :exec
DELETE FROM task_views
WHERE organization_id = $1
  AND workspace_id = $2
  AND scope_type = 'project'
  AND scope_id = $3;

-- name: DeleteTaskPinsByItem :exec
DELETE FROM task_pins
WHERE organization_id = $1
  AND workspace_id = $2
  AND item_type = $3
  AND item_id = $4;
