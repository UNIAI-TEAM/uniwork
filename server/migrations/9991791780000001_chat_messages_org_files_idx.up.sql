-- Documents "other sources" (UNI-1305 item C): the chat file list pages an
-- organization's file messages newest first. Without this the planner visits
-- every file message of the organization per page. The id column carries
-- COLLATE "C" because the list orders ties byte-wise (document_sources.sql).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_org_files
  ON chat_messages (organization_id, created_at DESC, id COLLATE "C" DESC)
  WHERE kind = 'file' AND deleted_at IS NULL AND file_id IS NOT NULL;
