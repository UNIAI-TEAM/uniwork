CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_resource ON audit_events (resource_type, resource_id, occurred_at DESC);
