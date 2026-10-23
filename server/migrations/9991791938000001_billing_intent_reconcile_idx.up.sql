CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_payment_intents_stale_reconcile
  ON billing_payment_intents (created_at)
  WHERE provider = 'vnpay' AND status IN ('pending', 'expired');
