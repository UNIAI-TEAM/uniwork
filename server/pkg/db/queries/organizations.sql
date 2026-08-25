-- name: CreateOrganization :one
INSERT INTO organizations (id, slug, name, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetOrganizationByID :one
SELECT * FROM organizations WHERE id = $1;

-- name: GetOrganizationBySlug :one
SELECT * FROM organizations WHERE slug = $1;

-- name: ListOrganizationsForUser :many
SELECT o.*, m.role
FROM organizations o
JOIN organization_members m ON m.organization_id = o.id
WHERE m.user_id = $1
ORDER BY o.created_at;

-- name: AddOrganizationMember :exec
INSERT INTO organization_members (organization_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: GetOrganizationMember :one
SELECT * FROM organization_members WHERE organization_id = $1 AND user_id = $2;

-- name: ListWorkspacesInOrg :many
SELECT w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspaces w JOIN organizations o ON o.id = w.organization_id
WHERE w.organization_id = $1
ORDER BY w.created_at;

-- name: ListMemberWorkspacesInOrg :many
SELECT w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspaces w
JOIN organizations o ON o.id = w.organization_id
JOIN workspace_members m ON m.workspace_id = w.id
WHERE w.organization_id = $1 AND m.user_id = $2
ORDER BY w.created_at;
