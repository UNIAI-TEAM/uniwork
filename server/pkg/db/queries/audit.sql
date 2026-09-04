-- name: InsertAuditEvent :exec
-- Chỉ package internal/audit được gọi câu này (arch_test.go giữ luật).
INSERT INTO audit_events (
  id, organization_id, workspace_id, actor_kind, actor_id, action,
  resource_type, resource_id, changes, metadata, correlation_id,
  request_id, ip_address, user_agent, occurred_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now());

-- name: GetAuditEvent :one
SELECT * FROM audit_events WHERE id = $1 AND organization_id = $2;

-- name: ListAuditEvents :many
-- Phân trang bằng con trỏ ULID giảm dần: id sinh theo thời gian nên
-- (id < before) là "cũ hơn" mà không cần OFFSET.
SELECT * FROM audit_events
WHERE organization_id = $1
  AND (sqlc.narg('before')::text IS NULL OR id < sqlc.narg('before')::text)
  AND (sqlc.narg('actor_id')::text IS NULL OR actor_id = sqlc.narg('actor_id')::text)
  AND (sqlc.narg('action')::text IS NULL OR action = sqlc.narg('action')::text)
  AND (sqlc.narg('resource_type')::text IS NULL OR resource_type = sqlc.narg('resource_type')::text)
  AND (sqlc.narg('resource_id')::text IS NULL OR resource_id = sqlc.narg('resource_id')::text)
  AND (sqlc.narg('workspace_id')::text IS NULL OR workspace_id = sqlc.narg('workspace_id')::text)
  AND (sqlc.narg('from_at')::timestamptz IS NULL OR occurred_at >= sqlc.narg('from_at')::timestamptz)
  AND (sqlc.narg('to_at')::timestamptz IS NULL OR occurred_at <= sqlc.narg('to_at')::timestamptz)
ORDER BY id DESC
LIMIT sqlc.arg('limit_n');

-- name: ListResourceAuditEvents :many
SELECT * FROM audit_events
WHERE resource_type = $1 AND resource_id = $2 AND workspace_id = $3
ORDER BY occurred_at DESC
LIMIT $4;

-- name: ListAuditEventsForExport :many
SELECT * FROM audit_events
WHERE organization_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
ORDER BY id ASC
LIMIT $4;

-- name: CountAuditEventsOlderThan :one
SELECT count(*)::bigint AS expired
FROM audit_events
WHERE organization_id = $1 AND occurred_at < $2;

-- name: ListAuditOrganizations :many
SELECT DISTINCT organization_id FROM audit_events WHERE organization_id <> '';

-- name: GetAuditRetentionPolicy :one
SELECT * FROM audit_retention_policies WHERE organization_id = $1;

-- name: UpsertAuditRetentionPolicy :one
INSERT INTO audit_retention_policies (organization_id, retain_days, updated_by, updated_by_kind, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (organization_id) DO UPDATE SET
  retain_days = EXCLUDED.retain_days,
  updated_by = EXCLUDED.updated_by,
  updated_by_kind = EXCLUDED.updated_by_kind,
  updated_at = now()
RETURNING *;

-- name: InsertAuditExport :one
INSERT INTO audit_exports (
  id, organization_id, requested_by, requested_by_kind, format, from_at, to_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetAuditExport :one
SELECT * FROM audit_exports WHERE id = $1 AND organization_id = $2;

-- name: CountRunningAuditExports :one
SELECT count(*)::bigint AS running
FROM audit_exports
WHERE organization_id = $1 AND completed_at IS NULL AND failed_at IS NULL;

-- name: StartAuditExport :exec
UPDATE audit_exports SET started_at = now() WHERE id = $1 AND started_at IS NULL;

-- name: CompleteAuditExport :exec
UPDATE audit_exports SET
  completed_at = now(), object_key = $2, row_count = $3, expires_at = now() + interval '24 hours'
WHERE id = $1;

-- name: FailAuditExport :exec
UPDATE audit_exports SET failed_at = now(), error = $2 WHERE id = $1;

-- name: ListAuditExports :many
SELECT * FROM audit_exports
WHERE organization_id = $1
ORDER BY created_at DESC
LIMIT $2;
