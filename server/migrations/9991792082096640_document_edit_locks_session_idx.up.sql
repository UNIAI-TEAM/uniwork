CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_edit_locks_session
  ON document_edit_locks (user_id, session_id) WHERE ended_at IS NULL;
