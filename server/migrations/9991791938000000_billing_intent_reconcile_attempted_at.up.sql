-- Lease column so several API replicas do not QueryDr the same open intent.
ALTER TABLE billing_payment_intents
  ADD COLUMN IF NOT EXISTS reconcile_attempted_at TIMESTAMPTZ;
