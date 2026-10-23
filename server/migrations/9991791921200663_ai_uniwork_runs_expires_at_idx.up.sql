-- The TTL sweep's batch: the runs whose window has passed, oldest first
-- (AiUniworkExpiredRunIDs; design §3.4).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_uniwork_runs_expires_at
  ON ai_uniwork_runs (expires_at);
