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
-- organization_member_deactivated rides along so RequireMember can refuse a
-- member the organization has switched off (F-03): their workspace rows stay,
-- which is the point of deactivation, so the workspace join alone would still
-- let them in.
SELECT COALESCE(m.role, CASE WHEN om.role IN ('owner','admin') THEN 'admin' END, '')::text AS role,
       w.organization_id, o.status AS organization_status,
       (om.deactivated_at IS NOT NULL)::boolean AS organization_member_deactivated
FROM workspaces w
JOIN organizations o ON o.id = w.organization_id
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
-- workspace_id is NULL for an invitation to the organization itself (F-03);
-- organization_id is always set, so every invitation names a tenant.
INSERT INTO invitations (id, organization_id, workspace_id, email, role, org_role, token, expires_at, invited_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetInvitationByToken :one
SELECT * FROM invitations
WHERE token = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now();

-- name: MarkInvitationAccepted :exec
UPDATE invitations SET accepted_at = now() WHERE id = $1;

-- name: ListInvitationsForEmail :many
-- The workspace columns are nullable now: an organization-level invitation has
-- no workspace, so the join has to be outer or those rows disappear from the
-- invitee's own list (F-03).
SELECT i.id, i.role, i.org_role, i.token, i.expires_at,
       w.id AS workspace_id, w.slug AS workspace_slug, w.name AS workspace_name,
       o.id AS organization_id, o.slug AS organization_slug, o.name AS organization_name,
       u.display_name AS invited_by_name
FROM invitations i
JOIN organizations o ON o.id = i.organization_id
LEFT JOIN workspaces w ON w.id = i.workspace_id
LEFT JOIN users u ON u.id = i.invited_by
WHERE i.email = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
ORDER BY i.created_at DESC;

-- name: ListPendingOrganizationInvitations :many
SELECT i.*, u.display_name AS invited_by_name
FROM invitations i
LEFT JOIN users u ON u.id = i.invited_by
WHERE i.organization_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
ORDER BY i.created_at DESC;

-- name: GetPendingInvitationForEmail :one
SELECT * FROM invitations
WHERE organization_id = $1 AND lower(email) = lower($2)
  AND workspace_id IS NULL AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
LIMIT 1;

-- name: RevokeInvitation :one
UPDATE invitations SET revoked_at = now()
WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
RETURNING *;

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

-- name: UpdateWorkspaceTaskPrefix :one
UPDATE workspaces
SET task_prefix = $2, updated_at = now()
WHERE id = $1 AND organization_id = $3
RETURNING *;
