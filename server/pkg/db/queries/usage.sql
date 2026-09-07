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
