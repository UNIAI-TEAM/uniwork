-- C-04: checkout intents before redirect to VNPay (UNI-440). BillingService
-- is the only writer; provider_txn_ref is vnp_TxnRef.
CREATE TABLE IF NOT EXISTS billing_payment_intents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_txn_ref TEXT NOT NULL,
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'VND',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
