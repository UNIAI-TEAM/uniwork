CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_events_pending ON outbox_events (status, available_at);
