CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_billing_payment_intents_txn_ref
  ON billing_payment_intents (provider_txn_ref);
