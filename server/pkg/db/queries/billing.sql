-- Plans, features and subscriptions (F-02). Only service/entitlement.go,
-- service/billing.go and service/billing_catalog.go call these (arch_test.go).

-- name: ListActivePlans :many
SELECT * FROM plans WHERE is_active ORDER BY sort_order, code;

-- name: ListAllPlans :many
SELECT * FROM plans ORDER BY sort_order, code;

-- name: GetPlanByCode :one
SELECT * FROM plans WHERE code = $1;

-- name: GetPlanByID :one
SELECT * FROM plans WHERE id = $1;

-- name: GetDefaultPlan :one
SELECT * FROM plans WHERE is_default LIMIT 1;

-- name: GetFeatureByKey :one
SELECT * FROM features WHERE key = $1;

-- name: ListFeatures :many
SELECT * FROM features ORDER BY sort_order, key;

-- name: ListPlanFeatures :many
SELECT pf.plan_id, pf.feature_key, pf.enabled, pf.quota_limit,
       f.name, f.kind, f.unit, f.category, f.meter_mode, f.sort_order
FROM plan_features pf
JOIN features f ON f.key = pf.feature_key
WHERE pf.plan_id = $1
ORDER BY f.sort_order, f.key;

-- name: ListAllPlanFeatures :many
SELECT pf.plan_id, pf.feature_key, pf.enabled, pf.quota_limit,
       f.name, f.kind, f.unit, f.category, f.meter_mode, f.sort_order
FROM plan_features pf
JOIN features f ON f.key = pf.feature_key
ORDER BY pf.plan_id, f.sort_order, f.key;

-- name: InsertPlanCatalog :one
INSERT INTO plans (id, code, name, description, billing_period, price_amount, price_currency, is_default, is_active, sort_order)
VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9)
RETURNING *;

-- name: UpdatePlanCatalog :one
UPDATE plans SET
  name = $2,
  description = $3,
  billing_period = $4,
  price_amount = $5,
  price_currency = $6,
  is_active = $7,
  sort_order = $8,
  updated_at = now()
WHERE code = $1
RETURNING *;

-- name: UpsertPlanFeatureRow :execrows
INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
VALUES ($1, $2, $3, $4)
ON CONFLICT (plan_id, feature_key) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  quota_limit = EXCLUDED.quota_limit;

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
-- tenant: by-id
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
-- tenant: by-id
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

-- name: InsertBillingPaymentIntent :one
INSERT INTO billing_payment_intents (
  id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
  amount, currency, status, expires_at, created_by, created_by_kind
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11)
RETURNING *;

-- name: ExpirePendingBillingPaymentIntents :exec
UPDATE billing_payment_intents SET status = 'expired', updated_at = now()
WHERE organization_id = $1 AND status = 'pending';

-- name: GetPendingBillingPaymentIntentForPlan :one
SELECT * FROM billing_payment_intents
WHERE organization_id = $1 AND plan_id = $2 AND status = 'pending' AND expires_at > now()
ORDER BY created_at DESC
LIMIT 1;

-- name: GetBillingPaymentIntentByTxnRef :one
-- tenant: token
SELECT * FROM billing_payment_intents WHERE provider_txn_ref = $1;

-- name: GetBillingPaymentIntentByID :one
SELECT * FROM billing_payment_intents WHERE id = $1 AND organization_id = $2;

-- name: GetCompletedPaymentIntentForInvoice :one
SELECT * FROM billing_payment_intents
WHERE organization_id = $1 AND subscription_id = $2 AND provider = $3 AND amount = $4 AND status = 'completed'
ORDER BY COALESCE(completed_at, created_at) DESC
LIMIT 1;

-- name: MarkBillingPaymentIntentCompleted :one
UPDATE billing_payment_intents SET
  status = 'completed',
  completed_at = now(),
  updated_at = now(),
  provider_bank_code = COALESCE(sqlc.narg('provider_bank_code'), provider_bank_code),
  provider_transaction_no = COALESCE(sqlc.narg('provider_transaction_no'), provider_transaction_no)
WHERE id = $1 AND organization_id = $2 AND status IN ('pending', 'failed')
RETURNING *;

-- name: PatchBillingPaymentIntentProviderMeta :exec
UPDATE billing_payment_intents SET
  provider_bank_code = CASE
    WHEN sqlc.narg('provider_bank_code')::text IS NOT NULL AND btrim(sqlc.narg('provider_bank_code')::text) <> ''
    THEN btrim(sqlc.narg('provider_bank_code')::text)
    ELSE provider_bank_code
  END,
  provider_transaction_no = CASE
    WHEN sqlc.narg('provider_transaction_no')::text IS NOT NULL AND btrim(sqlc.narg('provider_transaction_no')::text) <> ''
    THEN btrim(sqlc.narg('provider_transaction_no')::text)
    ELSE provider_transaction_no
  END,
  updated_at = now()
WHERE id = $1 AND organization_id = $2 AND status = 'completed';

-- name: ListCompletedBillingIntentsMissingProviderMeta :many
-- tenant: system
SELECT id, organization_id, provider_txn_ref, created_at, completed_at
FROM billing_payment_intents
WHERE provider = 'vnpay' AND status = 'completed'
  AND (
    provider_bank_code IS NULL OR btrim(provider_bank_code) = ''
    OR provider_transaction_no IS NULL OR btrim(provider_transaction_no) = ''
  )
ORDER BY COALESCE(completed_at, created_at) DESC
LIMIT $1;

-- name: MarkBillingPaymentIntentFailed :exec
UPDATE billing_payment_intents SET status = 'failed', updated_at = now()
WHERE id = $1 AND organization_id = $2 AND status IN ('pending', 'expired');

-- name: ApplyPaidSubscriptionFromProvider :one
UPDATE subscriptions SET
  plan_id = $3,
  status = 'active',
  provider = $4,
  current_period_start = $5,
  current_period_end = $6,
  cancel_at = NULL,
  canceled_at = NULL,
  row_version = row_version + 1,
  updated_by = $7,
  updated_by_kind = $8,
  updated_at = now()
WHERE id = $1 AND organization_id = $2 AND status <> 'canceled'
RETURNING *;

-- name: InsertInvoice :one
INSERT INTO invoices (
  id, organization_id, subscription_id, provider, provider_invoice_id, number,
  status, amount_due, amount_paid, currency, period_start, period_end, paid_at,
  initiated_by, initiated_by_kind, payment_intent_id
) VALUES ($1, $2, $3, $4, $5, $6, 'paid', $7, $8, $9, $10, $11, now(), $12, $13, $14)
RETURNING *;

-- name: GetBillingPaymentIntentForInvoice :one
SELECT * FROM billing_payment_intents WHERE id = $1 AND organization_id = $2;

-- name: ListInvoicesByOrganization :many
SELECT * FROM invoices
WHERE organization_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListSubscriptionsDueForCancelLapse :many
-- tenant: system
SELECT s.* FROM subscriptions s
JOIN plans p ON p.id = s.plan_id
WHERE s.status <> 'canceled'
  AND NOT p.is_default
  AND s.cancel_at IS NOT NULL AND s.cancel_at <= now()
ORDER BY s.cancel_at
LIMIT $1;

-- name: ListSubscriptionsDueForPastDue :many
-- tenant: system
SELECT s.* FROM subscriptions s
JOIN plans p ON p.id = s.plan_id
WHERE s.status = 'active'
  AND s.current_period_end IS NOT NULL AND s.current_period_end < now()
  AND s.cancel_at IS NULL
  AND p.price_amount IS NOT NULL AND p.price_amount > 0
ORDER BY s.current_period_end
LIMIT $1;

-- name: RevertSubscriptionToDefaultAtCancel :one
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
WHERE id = $1 AND organization_id = $2
  AND cancel_at IS NOT NULL AND cancel_at <= now()
RETURNING *;

-- name: RevertSubscriptionToDefaultAfterInvoiceRefund :one
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
WHERE id = $1 AND organization_id = $2
  AND status <> 'canceled'
  AND plan_id <> $3
RETURNING *;

-- name: MarkSubscriptionPastDue :one
UPDATE subscriptions s SET
  status = 'past_due',
  row_version = s.row_version + 1,
  updated_by = $3,
  updated_by_kind = $4,
  updated_at = now()
FROM plans p
WHERE s.id = $1 AND s.organization_id = $2 AND s.plan_id = p.id
  AND p.price_amount IS NOT NULL AND p.price_amount > 0
  AND s.status = 'active'
  AND s.cancel_at IS NULL
  AND s.current_period_end IS NOT NULL AND s.current_period_end < now()
RETURNING s.*;

-- name: ListInvoicesRefundPendingForReconcile :many
-- tenant: system
SELECT id, organization_id, subscription_id, provider, number, status, amount_paid, payment_intent_id
FROM invoices
WHERE status IN ('refund_pending', 'partial_refund_pending')
  AND provider = 'vnpay'
ORDER BY refund_requested_at NULLS LAST, updated_at
LIMIT $1;

-- name: ConfirmInvoiceRefundFromProvider :one
UPDATE invoices SET
  amount_refunded = CASE
    WHEN status = 'partial_refund_pending' AND partial_refund_amount IS NOT NULL
    THEN amount_refunded + partial_refund_amount
    ELSE amount_paid
  END,
  partial_refund_amount = NULL,
  status = CASE
    WHEN status = 'partial_refund_pending' AND partial_refund_amount IS NOT NULL
      AND amount_refunded + partial_refund_amount < amount_paid THEN 'paid'
    ELSE 'refunded'
  END,
  refunded_at = CASE
    WHEN status = 'refund_pending' THEN now()
    WHEN status = 'partial_refund_pending' AND partial_refund_amount IS NOT NULL
      AND amount_refunded + partial_refund_amount >= amount_paid THEN now()
    ELSE refunded_at
  END,
  updated_at = now()
WHERE id = $1 AND organization_id = $2 AND status IN ('refund_pending', 'partial_refund_pending')
RETURNING *;

-- name: ClaimPendingBillingWebhookInbox :many
UPDATE webhook_inbox SET
  status = 'PROCESSING',
  next_attempt_at = now() + make_interval(secs => sqlc.arg('lease_seconds')::double precision)
WHERE id IN (
  SELECT id FROM webhook_inbox
  WHERE status = 'PENDING' AND next_attempt_at <= now()
    AND provider IN ('vnpay', 'stripe', 'payos')
  ORDER BY received_at
  LIMIT sqlc.arg('limit_n')
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
