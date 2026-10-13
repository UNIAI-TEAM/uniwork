CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mcp_grants_user ON mcp_grants (user_id, created_at DESC);
