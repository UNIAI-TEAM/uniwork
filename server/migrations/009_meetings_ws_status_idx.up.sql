CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meetings_ws_status ON meetings (workspace_id, status, starts_at DESC);
