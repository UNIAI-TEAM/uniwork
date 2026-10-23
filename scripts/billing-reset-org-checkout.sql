-- Dev/test: bật lại gói trả phí và đưa tổ chức về Starter để mua lại Team/Business.
--   psql "$DATABASE_URL" -v org_slug=sd -f scripts/billing-reset-org-checkout.sql
-- Hoặc theo id (slug rỗng):
--   psql "$DATABASE_URL" -v org_slug= -v org_id=01M1X4ZV9GQTT0G59XEY9YZWAW -f scripts/billing-reset-org-checkout.sql

UPDATE plans
SET is_active = true, updated_at = now()
WHERE code IN ('starter', 'team', 'business');

WITH target AS (
  SELECT id FROM organizations
  WHERE (NULLIF(:'org_slug', '') IS NOT NULL AND slug = :'org_slug')
     OR (NULLIF(:'org_id', '') IS NOT NULL AND id = :'org_id')
  LIMIT 1
)
UPDATE subscriptions s
SET
  plan_id = (SELECT id FROM plans WHERE code = 'starter' LIMIT 1),
  status = 'active',
  cancel_at = NULL,
  canceled_at = NULL,
  overrides = '{}'::jsonb,
  current_period_start = NULL,
  current_period_end = NULL,
  row_version = s.row_version + 1,
  updated_at = now()
FROM target t
WHERE s.organization_id = t.id AND s.status <> 'canceled';

WITH target AS (
  SELECT id FROM organizations
  WHERE (NULLIF(:'org_slug', '') IS NOT NULL AND slug = :'org_slug')
     OR (NULLIF(:'org_id', '') IS NOT NULL AND id = :'org_id')
  LIMIT 1
)
UPDATE billing_payment_intents pi
SET status = 'expired', updated_at = now()
FROM target t
WHERE pi.organization_id = t.id AND pi.status = 'pending';
