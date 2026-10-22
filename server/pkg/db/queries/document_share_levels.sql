-- Set reads behind the bulk effective-level resolver (UNI-2012 SF1): a chat
-- document grant to a large room and a Documents batch share resolve every
-- recipient's level from these two statements plus the share set already in
-- memory, instead of a workspace-gate read per recipient.

-- name: ListActiveWorkspaceRolesForUsers :many
-- The workspace role GetWorkspaceAccess gives each user (a workspace member's
-- own role, else admin for an organization owner/admin), for the users the
-- workspace gate admits: the same admission as FilterActiveWorkspaceMemberUserIDs
-- (active organization, member not deactivated, only the owner while a deletion
-- is scheduled), one row per admitted user. A user the gate refuses has no row.
SELECT input.user_id::text AS user_id,
       COALESCE(m.role, CASE WHEN om.role IN ('owner', 'admin') THEN 'admin' END, '')::text AS role
FROM unnest(sqlc.arg(user_ids)::text[]) AS input(user_id)
JOIN workspaces w ON w.id = sqlc.arg(workspace_id)::text AND w.organization_id = sqlc.arg(organization_id)::text
JOIN organizations o ON o.id = w.organization_id
LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = input.user_id
LEFT JOIN organization_members om ON om.organization_id = w.organization_id AND om.user_id = input.user_id
WHERE COALESCE(m.role, CASE WHEN om.role IN ('owner', 'admin') THEN 'admin' END, '') <> ''
  AND o.status = 'active'
  AND om.deactivated_at IS NULL
  AND (o.deletion_scheduled_at IS NULL OR om.role = 'owner')
ORDER BY input.user_id;

-- name: ListLiveBreakGlassGrantsForActors :many
-- The newest live emergency view grant of each of many human actors on one
-- document (DOC-05), read once; GetLiveDocumentBreakGlassGrantForActor for a
-- set. The first row of an actor is the one that query would return.
SELECT actor_id, level
FROM document_break_glass_grants
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND actor_id = ANY(sqlc.arg(actor_ids)::text[])
  AND actor_kind = 'human'
  AND revoked_at IS NULL
  AND expires_at > now()
ORDER BY actor_id, granted_at DESC, id DESC;
