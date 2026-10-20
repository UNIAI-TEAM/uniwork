-- The UniChat calls tab (UNI-1833) pages an organization's call logs newest
-- first. Without this the planner walks every message of the caller's rooms
-- per page. The id column carries COLLATE "C" because the list orders ties
-- byte-wise (chat_call_logs.sql), as idx_chat_messages_org_files does.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_org_call_logs
  ON chat_messages (organization_id, created_at DESC, id COLLATE "C" DESC)
  WHERE kind = 'voice_call_log' AND deleted_at IS NULL;
