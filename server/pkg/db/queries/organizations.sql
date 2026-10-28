-- name: CreateOrganization :one
INSERT INTO organizations (id, slug, name, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetOrganizationByID :one
SELECT * FROM organizations WHERE id = $1;

-- name: LockOrganizationForUpdate :one
-- Close holds the organization row while it counts the other members, so an
-- acceptance into the organization either commits first and is counted, or
-- waits and finds it archived (ADR 0032 D5).
SELECT * FROM organizations WHERE id = $1 FOR UPDATE;

-- name: LockOrganizationForShare :one
-- An acceptance holds the organization row shared before it locks the
-- invitation, the order that serializes it against Close without deadlock.
SELECT * FROM organizations WHERE id = $1 FOR SHARE;

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

-- name: FilterActiveOrganizationMemberUserIDs :many
SELECT m.user_id::text AS user_id
FROM organization_members m
JOIN organizations o ON o.id = m.organization_id
WHERE m.organization_id = sqlc.arg(organization_id)
  AND m.user_id = ANY(sqlc.arg(user_ids)::text[])
  AND m.deactivated_at IS NULL
  AND o.status = 'active';

-- name: FilterAdmittedOrganizationMemberUserIDs :many
-- Same admission as GetOrganizationMember / OrganizationService.RequireMemberQ
-- (active organization, member not deactivated, and only the owner while a
-- deletion is scheduled), in one query for many user ids: a chat document
-- grant to a large room or a Documents batch share gates every recipient
-- without a round trip each (UNI-2012 S1c).
SELECT m.user_id::text AS user_id
FROM organization_members m
JOIN organizations o ON o.id = m.organization_id
WHERE m.organization_id = sqlc.arg(organization_id)
  AND m.user_id = ANY(sqlc.arg(user_ids)::text[])
  AND m.deactivated_at IS NULL
  AND o.status = 'active'
  AND (o.deletion_scheduled_at IS NULL OR m.role = 'owner');

-- name: LockOrganizationMemberForUpdate :one
SELECT * FROM organization_members
WHERE organization_id = $1 AND user_id = $2
FOR UPDATE;

-- name: CountActiveOtherMembers :one
-- Close needs the owner to be the organization's only active member
-- (ADR 0032 D5); deactivated rows hold no access and do not count.
SELECT count(*) FROM organization_members
WHERE organization_id = $1 AND user_id <> $2 AND deactivated_at IS NULL;

-- name: CloseOrganization :execrows
-- Closing archives rather than deletes (ADR 0032 D4): every gate that wants an
-- active organization already refuses an archived one. 0 rows means the
-- status moved under the caller.
UPDATE organizations SET
  status = 'archived',
  suspended_at = now(),
  suspended_reason = 'organization_closed',
  updated_at = now()
WHERE id = $1 AND status = 'active';

-- name: GetOrganizationPushPreviewPolicy :one
-- Read by every member (Settings shows why previews are off) and by the push
-- lane for the notification's organization.
SELECT id, push_previews_hidden_at, push_previews_hidden_by FROM organizations WHERE id = $1;

-- name: GetOrganizationPushPreviewPolicyForUpdate :one
-- SetPushPreviewPolicy reads the value it is about to change under the row
-- lock, so the audit row's before/after is true and a repeat writes no row.
SELECT id, push_previews_hidden_at, push_previews_hidden_by FROM organizations WHERE id = $1 FOR UPDATE;

-- name: SetOrganizationPushPreviewPolicy :one
UPDATE organizations SET
  push_previews_hidden_at = CASE WHEN sqlc.arg(hidden)::bool THEN COALESCE(push_previews_hidden_at, now()) ELSE NULL END,
  push_previews_hidden_by = CASE WHEN sqlc.arg(hidden)::bool THEN sqlc.arg(actor_id)::text ELSE NULL END,
  updated_at = now()
WHERE id = sqlc.arg(id)
RETURNING id, push_previews_hidden_at, push_previews_hidden_by;

-- name: GetOrganizationMobileSecurityPolicy :one
-- Read by every member: the phone holds the organization's requirements as a
-- floor under the person's own app lock and screen-capture choices.
SELECT id, mobile_app_lock_required_at, mobile_screen_capture_blocked_at FROM organizations WHERE id = $1;

-- name: GetOrganizationMobileSecurityPolicyForUpdate :one
-- SetMobileSecurityPolicy reads what it is about to change under the row
-- lock, so the audit row's before/after is true and a repeat writes no row.
SELECT id, mobile_app_lock_required_at, mobile_screen_capture_blocked_at FROM organizations WHERE id = $1 FOR UPDATE;

-- name: SetOrganizationMobileSecurityPolicy :one
-- A requirement keeps the time and the person that first set it; lifting it
-- clears both.
UPDATE organizations SET
  mobile_app_lock_required_at = CASE WHEN sqlc.arg(require_app_lock)::bool THEN COALESCE(mobile_app_lock_required_at, now()) ELSE NULL END,
  mobile_app_lock_required_by = CASE
    WHEN NOT sqlc.arg(require_app_lock)::bool THEN NULL
    WHEN mobile_app_lock_required_at IS NULL THEN sqlc.arg(actor_id)::text
    ELSE mobile_app_lock_required_by END,
  mobile_screen_capture_blocked_at = CASE WHEN sqlc.arg(block_screen_capture)::bool THEN COALESCE(mobile_screen_capture_blocked_at, now()) ELSE NULL END,
  mobile_screen_capture_blocked_by = CASE
    WHEN NOT sqlc.arg(block_screen_capture)::bool THEN NULL
    WHEN mobile_screen_capture_blocked_at IS NULL THEN sqlc.arg(actor_id)::text
    ELSE mobile_screen_capture_blocked_by END,
  updated_at = now()
WHERE id = sqlc.arg(id)
RETURNING id, mobile_app_lock_required_at, mobile_screen_capture_blocked_at;

-- name: GetOrganizationAskWriteCeiling :one
SELECT ask_uni_write_ceiling FROM organizations WHERE id = $1;

-- name: GetOrganizationAskWriteCeilingForUpdate :one
SELECT ask_uni_write_ceiling FROM organizations WHERE id = $1 FOR UPDATE;

-- name: SetOrganizationAskWriteCeiling :exec
UPDATE organizations SET
  ask_uni_write_ceiling = sqlc.arg(ceiling)::text,
  ask_uni_write_ceiling_updated_by = sqlc.arg(actor_id)::text,
  ask_uni_write_ceiling_updated_at = now(),
  updated_at = now()
WHERE id = sqlc.arg(id);

-- name: UserEverJoinedAnOrganization :one
-- tenant: token
-- Whether an account ever belonged to an organization: a membership row
-- (deactivated ones included), or the member.joined / member.left audit row
-- every join and leave writes, since leaving deletes the membership row and
-- audit_events is append-only. A sign-in identity moves only out of an
-- account that never did (ADR 0049); the caller reached that account through
-- the provider identity it just proved, and only a yes or no comes back.
SELECT (
  EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = sqlc.arg(user_id)::text)
  OR EXISTS (
    SELECT 1 FROM audit_events a
    WHERE a.resource_type = 'organization_member' AND a.resource_id = sqlc.arg(user_id)::text
  )
)::bool AS joined;
