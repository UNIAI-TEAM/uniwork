-- The notification consumer looks events up by correlation id, action and resource; the correlation id is client-settable.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_correlation_action_resource ON audit_events (correlation_id, action, resource_id);
