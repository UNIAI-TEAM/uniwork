-- Departments (F-03). Organization data, at most two levels deep; the tree is
-- returned flat with parent_id and the client assembles it.

-- name: CreateDepartment :one
INSERT INTO departments (id, organization_id, parent_id, name, code, head_user_id, sort_order, created_by, created_by_kind)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetDepartment :one
SELECT * FROM departments WHERE id = $1 AND organization_id = $2;

-- name: ListDepartments :many
-- member_count is the live headcount of active members, so the settings screen
-- can warn before archiving a department that still has people in it.
SELECT d.*, (
  SELECT count(*) FROM organization_member_profiles p
  JOIN organization_members m ON m.organization_id = p.organization_id AND m.user_id = p.user_id
  WHERE p.organization_id = d.organization_id AND p.department_id = d.id AND m.deactivated_at IS NULL
)::bigint AS member_count
FROM departments d
WHERE d.organization_id = $1
  AND (sqlc.arg(include_archived)::boolean OR d.archived_at IS NULL)
ORDER BY d.sort_order, d.name;

-- name: UpdateDepartment :one
UPDATE departments SET
  name         = COALESCE(sqlc.narg(name)::text, name),
  code         = CASE WHEN sqlc.arg(set_code)::boolean THEN sqlc.narg(code)::text ELSE code END,
  parent_id    = CASE WHEN sqlc.arg(set_parent)::boolean THEN sqlc.narg(parent_id)::text ELSE parent_id END,
  head_user_id = CASE WHEN sqlc.arg(set_head)::boolean THEN sqlc.narg(head_user_id)::text ELSE head_user_id END,
  updated_at   = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
RETURNING *;

-- name: ArchiveDepartment :one
UPDATE departments SET archived_at = now(), updated_at = now()
WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL
RETURNING *;

-- name: CountChildDepartments :one
SELECT count(*) FROM departments
WHERE organization_id = $1 AND parent_id = $2 AND archived_at IS NULL;

-- name: ClearDepartmentFromProfiles :exec
UPDATE organization_member_profiles SET department_id = NULL, updated_at = now()
WHERE organization_id = $1 AND department_id = $2;

-- name: SetDepartmentOrder :exec
UPDATE departments SET sort_order = $3, updated_at = now()
WHERE id = $1 AND organization_id = $2;
