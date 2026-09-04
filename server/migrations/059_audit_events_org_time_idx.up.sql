CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_org_time ON audit_events (organization_id, occurred_at DESC);
