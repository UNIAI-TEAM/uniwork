CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_attachments_message
  ON ai_attachments (message_id);
