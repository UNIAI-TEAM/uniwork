CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_mcp_grants_active ON mcp_grants (organization_id, user_id, client_id) WHERE revoked_at IS NULL;
