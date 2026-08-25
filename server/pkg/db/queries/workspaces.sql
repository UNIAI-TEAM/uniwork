-- name: CreateWorkspace :one
INSERT INTO workspaces (id, slug, name, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetWorkspaceByID :one
SELECT * FROM workspaces WHERE id = $1;

-- name: GetWorkspaceBySlug :one
SELECT * FROM workspaces WHERE slug = $1;

-- name: ListWorkspacesForUser :many
SELECT w.* FROM workspaces w
JOIN workspace_members m ON m.workspace_id = w.id
WHERE m.user_id = $1
ORDER BY w.created_at;

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
