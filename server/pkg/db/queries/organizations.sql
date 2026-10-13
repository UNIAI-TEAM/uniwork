-- name: CreateOrganization :one
INSERT INTO organizations (id, slug, name, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetOrganizationByID :one
SELECT * FROM organizations WHERE id = $1;

-- name: GetOrganizationBySlug :one
SELECT * FROM organizations WHERE slug = $1;

-- name: ListOrganizationIDsForMaintenance :many
-- The maintenance worker enumerates tenant roots before asking for each
-- organization's workspace scopes; no business-table query is unscoped.
SELECT id FROM organizations ORDER BY id;

-- name: ListOrganizationsForUser :many
-- tenant: self
-- Deactivated memberships stay in the switcher so the person can see which
-- organization locked them out instead of watching it vanish (spec F-03 §6.3).
-- An archived organization (closed or deleted) is gone for its members, so it
-- leaves the list (ADR 0032).
SELECT o.*, m.role, m.deactivated_at
FROM organizations o
JOIN organization_members m ON m.organization_id = o.id
WHERE m.user_id = $1 AND o.status <> 'archived'
ORDER BY o.created_at;

-- name: ListOrganizationMembershipsForUser :many
-- tenant: self
-- Every membership row of one account, archived organizations included:
-- account deletion records its erasure in each of them.
SELECT organization_id, deactivated_at FROM organization_members
WHERE user_id = $1
ORDER BY organization_id;

-- name: LockUserMembership :exec
-- Serializes every membership change of one account (ADR 0032): Create,
-- AcceptInvite, Reactivate, Leave and Close take it first, then check
-- ListActiveOrganizationsForUser inside the same transaction.
SELECT pg_advisory_xact_lock(hashtextextended('org-membership:' || sqlc.arg(user_id)::text, 0));

-- name: ListActiveOrganizationsForUser :many
-- tenant: self
-- The organizations an account counts as belonging to (ADR 0032 D1): a
-- membership not deactivated, in an organization that is active or
-- suspended. other_active_members is how many people could take ownership.
SELECT o.id, o.name, o.slug, o.status, m.role,
       (SELECT count(*) FROM organization_members om
        WHERE om.organization_id = o.id AND om.user_id <> m.user_id AND om.deactivated_at IS NULL
       )::bigint AS other_active_members
FROM organization_members m
JOIN organizations o ON o.id = m.organization_id
WHERE m.user_id = $1 AND m.deactivated_at IS NULL AND o.status IN ('active', 'suspended')
ORDER BY m.created_at, o.id;

-- name: AddOrganizationMember :exec
INSERT INTO organization_members (organization_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: GetOrganizationMember :one
-- organization_status rides along so RequireMember can refuse a suspended
-- tenant without a second query (F-11).
SELECT m.*, o.status AS organization_status, o.deletion_scheduled_at
FROM organization_members m JOIN organizations o ON o.id = m.organization_id
WHERE m.organization_id = $1 AND m.user_id = $2;

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

-- name: ListOrganizationMembers :many
-- The directory's admin view: membership plus the identity columns, keyset
-- paged on (display_name, user_id) so a rename cannot skip or repeat a row.
SELECT m.organization_id, m.user_id, m.role, m.created_at, m.deactivated_at, m.deactivated_by, m.invited_by,
       u.email, u.display_name, u.avatar_url, u.avatar_file_id
FROM organization_members m JOIN users u ON u.id = m.user_id
WHERE m.organization_id = $1
  AND (
    sqlc.arg(status)::text = 'all'
    OR (sqlc.arg(status)::text = 'active' AND m.deactivated_at IS NULL)
    OR (sqlc.arg(status)::text = 'deactivated' AND m.deactivated_at IS NOT NULL)
  )
  AND (sqlc.narg(cursor_name)::text IS NULL
       OR (u.display_name, m.user_id) > (sqlc.narg(cursor_name)::text, sqlc.narg(cursor_user_id)::text))
ORDER BY u.display_name, m.user_id
LIMIT sqlc.arg(row_limit);

-- name: UpdateOrganizationMemberRole :one
UPDATE organization_members SET role = $3, updated_at = now()
WHERE organization_id = $1 AND user_id = $2
RETURNING *;

-- name: SetOrganizationMemberDeactivated :one
UPDATE organization_members
SET deactivated_at = now(), deactivated_by = $3, updated_at = now()
WHERE organization_id = $1 AND user_id = $2 AND deactivated_at IS NULL
RETURNING *;

-- name: ClearOrganizationMemberDeactivated :one
UPDATE organization_members
SET deactivated_at = NULL, deactivated_by = NULL, updated_at = now()
WHERE organization_id = $1 AND user_id = $2 AND deactivated_at IS NOT NULL
RETURNING *;

-- name: DeleteOrganizationMember :exec
DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2;

-- name: DeleteWorkspaceMembershipsInOrg :exec
-- Leaving is voluntary and complete: the workspace rows go with the org row,
-- inside the same transaction (spec F-03 §4.2).
DELETE FROM workspace_members wm
USING workspaces w
WHERE w.id = wm.workspace_id AND w.organization_id = $1 AND wm.user_id = $2;

-- name: CountActiveOrganizationsForUser :one
-- tenant: parent user_id
-- Deactivating a member revokes their sessions only when this is the last
-- organization they can still enter; an archived one is not enterable
-- (ADR 0032 D1).
SELECT count(*) FROM organization_members m
JOIN organizations o ON o.id = m.organization_id
WHERE m.user_id = $1 AND m.deactivated_at IS NULL AND m.organization_id <> $2
  AND o.status IN ('active', 'suspended');

-- name: LockOrganizationMemberForUpdate :one
SELECT * FROM organization_members
WHERE organization_id = $1 AND user_id = $2
FOR UPDATE;
