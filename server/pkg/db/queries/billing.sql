-- Plans, features and subscriptions (F-02). Only service/entitlement.go and
-- service/billing.go call these (arch_test.go).

-- name: ListActivePlans :many
SELECT * FROM plans WHERE is_active ORDER BY sort_order, code;

-- name: GetPlanByCode :one
SELECT * FROM plans WHERE code = $1;

-- name: GetPlanByID :one
SELECT * FROM plans WHERE id = $1;

-- name: GetDefaultPlan :one
SELECT * FROM plans WHERE is_default LIMIT 1;

-- name: ListFeatures :many
SELECT * FROM features ORDER BY sort_order, key;

-- name: ListPlanFeatures :many
SELECT pf.plan_id, pf.feature_key, pf.enabled, pf.quota_limit,
       f.name, f.kind, f.unit, f.category, f.meter_mode, f.sort_order
FROM plan_features pf
JOIN features f ON f.key = pf.feature_key
WHERE pf.plan_id = $1
ORDER BY f.sort_order, f.key;

-- name: ListActivePlanFeatures :many
SELECT pf.plan_id, pf.feature_key, pf.enabled, pf.quota_limit
FROM plan_features pf
JOIN plans p ON p.id = pf.plan_id
WHERE p.is_active
ORDER BY pf.plan_id, pf.feature_key;

-- name: GetLiveSubscription :one
SELECT * FROM subscriptions WHERE organization_id = $1 AND status <> 'canceled';

-- name: LockLiveSubscription :one
SELECT * FROM subscriptions WHERE organization_id = $1 AND status <> 'canceled' FOR UPDATE;

-- name: CreateSubscription :one
INSERT INTO subscriptions (id, organization_id, plan_id, status, provider, created_by, created_by_kind, updated_by, updated_by_kind)
VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $7)
RETURNING *;

-- name: ChangeSubscriptionPlan :one
UPDATE subscriptions SET
  plan_id = $3,
  status = 'active',
  provider = 'manual',
  current_period_start = now(),
  current_period_end = NULL,
  cancel_at = NULL,
  canceled_at = NULL,
  row_version = row_version + 1,
  updated_by = $4,
  updated_by_kind = $5,
  updated_at = now()
WHERE id = $1 AND row_version = $2
RETURNING *;

-- name: SetSubscriptionCancelAt :one
UPDATE subscriptions SET
  cancel_at = $2,
  row_version = row_version + 1,
  updated_by = $3,
  updated_by_kind = $4,
  updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListOrgAdminUserIDs :many
SELECT user_id FROM organization_members
WHERE organization_id = $1 AND role IN ('owner', 'admin')
ORDER BY user_id;
