CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_edit_locks_ended
  ON document_edit_locks (ended_at) WHERE ended_at IS NOT NULL;
