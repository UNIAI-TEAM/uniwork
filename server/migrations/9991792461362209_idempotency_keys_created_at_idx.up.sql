-- UNI-1983 (G5-D2 §2.2): the idempotency ledger retention sweep deletes rows
-- older than the retention window by created_at. CONCURRENTLY, alone in this
-- file (Database and Migration Rules: an index never shares a migration).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_idempotency_keys_created_at
    ON idempotency_keys (created_at);
