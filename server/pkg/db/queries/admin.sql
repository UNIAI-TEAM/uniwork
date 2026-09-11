-- Platform admin (F-11). Only service/admin.go calls these (arch test
-- TestAdminQueriesStayInAdminService). Metadata only: no task body, no
-- message, no file ever leaves through here.

-- name: AdminListOrganizations :many
-- total_count is the window count over the filtered set, so the console can
-- paginate without a second round trip. Sorting is decided here, never in the
-- browser: a client-side sort would only order the page it happens to hold.
SELECT t.id, t.slug, t.name, t.status, t.created_at, t.plan_code,
  t.member_count, t.workspace_count, t.last_activity_at, t.total_count
FROM (
  SELECT o.id, o.slug, o.name, o.status, o.created_at,
    COALESCE(p.code, '')::text AS plan_code,
    (SELECT count(*) FROM organization_members m WHERE m.organization_id = o.id)::bigint AS member_count,
    (SELECT count(*) FROM workspaces w WHERE w.organization_id = o.id)::bigint AS workspace_count,
    (SELECT max(a.occurred_at) FROM audit_events a WHERE a.organization_id = o.id)::timestamptz AS last_activity_at,
    count(*) OVER ()::bigint AS total_count
  FROM organizations o
  LEFT JOIN subscriptions s ON s.organization_id = o.id AND s.status <> 'canceled'
  LEFT JOIN plans p ON p.id = s.plan_id
  WHERE (sqlc.narg('status')::text IS NULL OR o.status = sqlc.narg('status')::text)
    AND (sqlc.narg('q')::text IS NULL OR o.name ILIKE '%' || sqlc.narg('q')::text || '%' OR o.slug ILIKE '%' || sqlc.narg('q')::text || '%')
) t
ORDER BY
  CASE WHEN sqlc.arg('sort')::text = 'activity_asc' THEN t.last_activity_at END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort')::text = 'activity_desc' THEN t.last_activity_at END DESC NULLS LAST,
  t.created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: AdminCountOrganizations :one
-- Only for a page that came back empty: the window count above has no row to
-- ride on there, and "page 3 of 0" is worse than one extra query.
SELECT count(*)::bigint FROM organizations o
WHERE (sqlc.narg('status')::text IS NULL OR o.status = sqlc.narg('status')::text)
  AND (sqlc.narg('q')::text IS NULL OR o.name ILIKE '%' || sqlc.narg('q')::text || '%' OR o.slug ILIKE '%' || sqlc.narg('q')::text || '%');

-- name: AdminGetOrganization :one
SELECT o.id, o.slug, o.name, o.status, o.suspended_at, o.suspended_reason, o.created_at,
  COALESCE(p.code, '')::text AS plan_code,
  (SELECT count(*) FROM organization_members m WHERE m.organization_id = o.id)::bigint AS member_count,
  (SELECT count(*) FROM workspaces w WHERE w.organization_id = o.id)::bigint AS workspace_count,
  (SELECT max(a.occurred_at) FROM audit_events a WHERE a.organization_id = o.id)::timestamptz AS last_activity_at
FROM organizations o
LEFT JOIN subscriptions s ON s.organization_id = o.id AND s.status <> 'canceled'
LEFT JOIN plans p ON p.id = s.plan_id
WHERE o.id = $1;

-- name: AdminSetOrganizationStatus :one
UPDATE organizations SET status = $2, suspended_at = $3, suspended_reason = $4, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: InsertAdminAction :exec
INSERT INTO admin_actions (id, actor_id, action, target_type, target_id, before, after, reason, trace_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: ListAdminActionsByTarget :many
SELECT * FROM admin_actions WHERE target_type = $1 AND target_id = $2 ORDER BY created_at DESC LIMIT $3;

-- name: ListAdminActionsByTrace :many
SELECT * FROM admin_actions WHERE trace_id = $1 ORDER BY created_at ASC LIMIT 500;

-- name: AdminListAuditEventsByCorrelation :many
SELECT id, organization_id, workspace_id, actor_kind, actor_id, action, resource_type, resource_id, request_id, occurred_at
FROM audit_events WHERE correlation_id = $1 ORDER BY occurred_at ASC LIMIT 500;

-- name: AdminListOutboxEventsByCorrelation :many
SELECT id, organization_id, workspace_id, topic, status, attempts, last_error, created_at, done_at, dead_at
FROM outbox_events WHERE correlation_id = $1 ORDER BY created_at ASC LIMIT 500;

-- name: AdminOutboxSummary :one
SELECT count(*) FILTER (WHERE status = 'PENDING')::bigint AS pending,
  count(*) FILTER (WHERE dead_at IS NOT NULL)::bigint AS dead,
  COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status = 'PENDING'))), 0)::float8 AS oldest_pending_age_seconds
FROM outbox_events;

-- name: SetUserPlatformRole :one
UPDATE users SET platform_role = $2, platform_role_granted_by = $3, platform_role_granted_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
WHERE id = $1
RETURNING *;

-- name: ListPlatformRoleUsers :many
SELECT id, email, platform_role, platform_role_granted_by, platform_role_granted_at FROM users
WHERE platform_role IS NOT NULL ORDER BY platform_role_granted_at DESC;

-- name: GetOrganizationStatus :one
SELECT status FROM organizations WHERE id = $1;
