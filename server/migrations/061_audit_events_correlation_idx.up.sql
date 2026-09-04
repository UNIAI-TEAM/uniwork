CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_correlation ON audit_events (correlation_id);
