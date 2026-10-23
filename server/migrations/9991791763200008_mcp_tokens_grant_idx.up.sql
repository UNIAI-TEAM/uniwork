CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mcp_tokens_grant ON mcp_tokens (grant_id) WHERE revoked_at IS NULL;
