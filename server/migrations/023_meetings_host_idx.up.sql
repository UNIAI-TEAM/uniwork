CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meetings_host ON meetings (workspace_id, host_user_id);
