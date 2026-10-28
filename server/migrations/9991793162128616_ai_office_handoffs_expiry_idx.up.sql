CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_office_handoffs_expires
  ON ai_office_handoffs (expires_at);
