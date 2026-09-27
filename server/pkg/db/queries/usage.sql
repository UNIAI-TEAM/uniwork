-- Usage meters (F-02). Accumulate meters write an event and bump the period
-- counter in one statement guarded by the limit; snapshot meters count their
-- source table. Only service/entitlement.go and service/billing.go call these.

-- name: InsertUsageEvent :execrows
INSERT INTO usage_events (id, organization_id, workspace_id, meter_key, delta, actor_id, actor_kind, ref_type, ref_id, idempotency_key)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

-- name: GetUsageCounter :one
SELECT * FROM usage_counters
WHERE organization_id = $1 AND meter_key = $2 AND period_start = $3;

-- name: ListUsageCounters :many
SELECT * FROM usage_counters
WHERE organization_id = $1 AND period_start = $2;

-- name: AddUsageWithinLimit :one
INSERT INTO usage_counters (organization_id, meter_key, period_start, total)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, meter_key, period_start) DO UPDATE SET
  total = usage_counters.total + EXCLUDED.total,
  updated_at = now()
WHERE sqlc.narg('limit_total')::bigint IS NULL
   OR usage_counters.total + EXCLUDED.total <= sqlc.narg('limit_total')::bigint
RETURNING *;

-- name: MarkUsageThresholdNotified :exec
UPDATE usage_counters SET
  notified_80_at = CASE WHEN sqlc.arg('level')::int = 80 THEN now() ELSE notified_80_at END,
  notified_100_at = CASE WHEN sqlc.arg('level')::int = 100 THEN now() ELSE notified_100_at END
WHERE organization_id = $1 AND meter_key = $2 AND period_start = $3;

-- name: CountOrganizationMembers :one
-- members.max counts seats in use, and a deactivated member gives their seat
-- back (OPEN_QUESTIONS P1), so the recount matches what Consume tracks.
SELECT count(*) FROM organization_members WHERE organization_id = $1 AND deactivated_at IS NULL;

-- name: CountWorkspacesInOrganization :one
SELECT count(*) FROM workspaces WHERE organization_id = $1;

-- name: CountTasksInOrganization :one
SELECT count(*)::bigint FROM tasks WHERE organization_id = $1;

-- storage.bytes (C-01 §14.2, G1-03): page bytes (working copy + page
-- versions) plus every DISTINCT file_id Documents still holds in the
-- organization - one file counts once however many versions or assets point
-- at it (FileService T1-Q9) - plus the live upload reservations the
-- FileService quota hook recorded. A reservation is a usage_events row with
-- ref_type 'file_reservation' (ref_id = file_id); it stops counting when the
-- file is held (claimed into a document row), when its session is no longer
-- receiving/staged (claimed, canceled, expired) or when the file failed or
-- is being deleted, so a reservation is always finite. Archived documents
-- still count: only the purge (row gone) frees their bytes.
-- name: CountStorageBytesInOrganization :one
WITH held AS (
  SELECT r.file_id, max(r.size_bytes) AS size_bytes
  FROM (
    SELECT v.file_id, v.size_bytes
    FROM document_versions v
    WHERE v.organization_id = sqlc.arg('organization_id')
      AND v.kind = 'file'
      AND v.file_id IS NOT NULL
    UNION ALL
    SELECT a.file_id, a.size_bytes
    FROM document_assets a
    WHERE a.organization_id = sqlc.arg('organization_id')
  ) r
  GROUP BY r.file_id
)
SELECT (
  (SELECT COALESCE(sum(d.content_bytes), 0) FROM documents d
    WHERE d.organization_id = sqlc.arg('organization_id') AND d.kind = 'page')
  + (SELECT COALESCE(sum(v.size_bytes), 0) FROM document_versions v
    WHERE v.organization_id = sqlc.arg('organization_id') AND v.kind = 'page')
  + (SELECT COALESCE(sum(h.size_bytes), 0) FROM held h)
  + (SELECT COALESCE(sum(e.delta), 0)
     FROM usage_events e
     JOIN file_upload_sessions s ON s.file_id = e.ref_id
     JOIN files f ON f.id = e.ref_id
     WHERE e.organization_id = sqlc.arg('organization_id')
       AND e.meter_key = 'storage.bytes'
       AND e.ref_type = 'file_reservation'
       AND s.status IN ('receiving', 'staged')
       AND f.status IN ('pending', 'processing', 'ready')
       AND NOT EXISTS (SELECT 1 FROM held h WHERE h.file_id = e.ref_id))
)::bigint AS total;

-- The upload behind a reservation: FileService calls the quota hook with a
-- file id only, and the purpose decides whether storage.bytes meters it.
-- name: GetStorageReservationUpload :one
SELECT purpose, workspace_id, created_by, created_by_kind
FROM file_upload_sessions
WHERE file_id = sqlc.arg('file_id')
  AND organization_id = sqlc.arg('organization_id');
