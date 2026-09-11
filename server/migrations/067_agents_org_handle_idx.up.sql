CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_agents_org_handle ON agents (organization_id, handle) WHERE archived_at IS NULL;
