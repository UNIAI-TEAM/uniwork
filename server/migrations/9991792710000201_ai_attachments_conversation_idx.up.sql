CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_attachments_conversation
  ON ai_attachments (organization_id, conversation_id);
