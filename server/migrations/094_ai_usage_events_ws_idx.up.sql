-- Backs the workspace usage report in Settings → AI.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_usage_events_ws_time
  ON ai_usage_events (workspace_id, created_at);
