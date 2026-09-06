CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_events_idem ON usage_events (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
