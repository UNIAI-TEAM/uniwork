-- Backs the organization usage report and the monthly quota sum.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_usage_events_org_time
  ON ai_usage_events (organization_id, created_at);
