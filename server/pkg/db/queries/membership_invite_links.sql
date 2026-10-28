-- name: CreateMembershipInviteLink :one
INSERT INTO membership_invite_links (
  id, organization_id, workspace_id, secret_hash, org_role, workspace_role,
  expires_at, created_by, created_by_kind
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: GetMembershipInviteLink :one
-- tenant: by-id
SELECT * FROM membership_invite_links WHERE id = $1;

-- name: LockMembershipInviteLink :one
-- tenant: by-id
SELECT * FROM membership_invite_links WHERE id = $1 FOR UPDATE;

-- name: ListWorkspaceMembershipInviteLinks :many
SELECT * FROM membership_invite_links
WHERE organization_id = $1 AND workspace_id = $2
ORDER BY created_at DESC;

-- name: ListOrganizationMembershipInviteLinks :many
SELECT * FROM membership_invite_links
WHERE organization_id = $1 AND workspace_id IS NULL
ORDER BY created_at DESC;

-- name: RevokeMembershipInviteLink :one
UPDATE membership_invite_links SET
  revoked_by = $2,
  revoked_at = now()
WHERE id = $1
  AND organization_id = $3
  AND revoked_at IS NULL
  AND expires_at > now()
RETURNING *;

-- name: AddMembershipInviteLinkWorkspace :exec
INSERT INTO membership_invite_link_workspaces (link_id, workspace_id, organization_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: ListMembershipInviteLinkWorkspaces :many
SELECT w.id, w.name, w.slug, w.organization_id, lw.link_id
FROM membership_invite_link_workspaces lw
JOIN workspaces w ON w.id = lw.workspace_id AND w.organization_id = lw.organization_id
WHERE lw.link_id = ANY (sqlc.arg(link_ids)::text[])
  AND lw.organization_id = ANY (sqlc.arg(organization_ids)::text[])
ORDER BY w.created_at ASC, w.id ASC;

-- name: DeleteMembershipInviteLinkWorkspaces :exec
DELETE FROM membership_invite_link_workspaces
WHERE link_id = $1 AND organization_id = $2;
