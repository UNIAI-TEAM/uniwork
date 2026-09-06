-- One live subscription per organization (idx_subscriptions_org_live). Only
-- BillingService writes this table; providers return results, never rows.
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trialing', 'active', 'past_due', 'suspended', 'canceled')),
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human', 'agent', 'system')),
  updated_by TEXT NOT NULL,
  updated_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (updated_by_kind IN ('human', 'agent', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill: every existing organization gets the default plan, by hand.
INSERT INTO subscriptions (id, organization_id, plan_id, status, provider, created_by, created_by_kind, updated_by, updated_by_kind)
SELECT
  '01K4F02SUB' || upper(substr(md5(o.id), 1, 16)),
  o.id, p.id, 'active', 'manual', o.created_by, 'system', o.created_by, 'system'
FROM organizations o
CROSS JOIN plans p
WHERE p.is_default
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.organization_id = o.id AND s.status <> 'canceled');
