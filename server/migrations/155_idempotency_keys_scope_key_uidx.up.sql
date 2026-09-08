CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_idempotency_keys_scope_key
  ON idempotency_keys (organization_id, workspace_id, scope, key);
