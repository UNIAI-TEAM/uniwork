-- name: CreateWorkspace :one
INSERT INTO workspaces (id, organization_id, slug, name, created_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetWorkspaceByID :one
SELECT * FROM workspaces WHERE id = $1;

-- name: UpdateWorkspaceName :one
UPDATE workspaces SET name = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: GetWorkspaceBySlugs :one
SELECT w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspaces w JOIN organizations o ON o.id = w.organization_id
WHERE o.slug = $1 AND w.slug = $2;

-- name: GetWorkspaceWithOrg :one
SELECT w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspaces w JOIN organizations o ON o.id = w.organization_id
WHERE w.id = $1;

-- name: ListWorkspacesForUser :many
-- Workspace user là thành viên trực tiếp, HOẶC thuộc org mà user là owner/admin.
SELECT DISTINCT ON (w.created_at, w.id) w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspaces w
JOIN organizations o ON o.id = w.organization_id
LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
LEFT JOIN organization_members om ON om.organization_id = w.organization_id AND om.user_id = $1
WHERE m.user_id IS NOT NULL OR om.role IN ('owner','admin')
ORDER BY w.created_at, w.id;

-- name: GetWorkspaceAccess :one
-- '' = không có quyền. Org owner/admin được coi là admin của mọi workspace trong org.
SELECT COALESCE(m.role, CASE WHEN om.role IN ('owner','admin') THEN 'admin' END, '')::text AS role,
       w.organization_id
FROM workspaces w
LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $2
LEFT JOIN organization_members om ON om.organization_id = w.organization_id AND om.user_id = $2
WHERE w.id = $1;

-- name: AddWorkspaceMember :exec
INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: GetWorkspaceMember :one
SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = $2;

-- name: ListWorkspaceMembers :many
SELECT m.workspace_id, m.user_id, m.role, m.created_at,
       u.email, u.display_name, u.avatar_url
FROM workspace_members m
JOIN users u ON u.id = m.user_id
WHERE m.workspace_id = $1
ORDER BY m.created_at;

-- name: CreateInvitation :one
INSERT INTO invitations (id, workspace_id, email, role, token, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetInvitationByToken :one
SELECT * FROM invitations
WHERE token = $1 AND accepted_at IS NULL AND expires_at > now();

-- name: MarkInvitationAccepted :exec
UPDATE invitations SET accepted_at = now() WHERE id = $1;

-- name: ListInvitationsForEmail :many
SELECT i.id, i.role, i.token, i.expires_at,
       w.id AS workspace_id, w.slug AS workspace_slug, w.name AS workspace_name,
       o.id AS organization_id, o.slug AS organization_slug, o.name AS organization_name,
       u.display_name AS invited_by_name
FROM invitations i
JOIN workspaces w ON w.id = i.workspace_id
JOIN organizations o ON o.id = w.organization_id
JOIN users u ON u.id = w.created_by
WHERE i.email = $1 AND i.accepted_at IS NULL AND i.expires_at > now()
ORDER BY i.created_at DESC;

-- name: UpdateWorkspaceMemberRole :one
UPDATE workspace_members
SET role = $3
WHERE workspace_id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteWorkspaceMember :exec
DELETE FROM workspace_members
WHERE workspace_id = $1 AND user_id = $2;

-- name: SetWorkspaceMatrixRoomID :one
UPDATE workspaces SET matrix_room_id = $2, updated_at = now()
WHERE id = $1
RETURNING *;
