-- Backs AiListConversations: my conversations in a workspace, newest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_conversations_user_time
  ON ai_conversations (workspace_id, user_id, updated_at DESC);
