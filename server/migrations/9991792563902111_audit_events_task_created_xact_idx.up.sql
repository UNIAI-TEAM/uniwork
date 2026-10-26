-- The notification consumer reads the task.created rows of one transaction and correlation id; the correlation id is client-settable, so xact_id leads.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_task_created_xact ON audit_events (xact_id, correlation_id) WHERE action = 'task.created';
