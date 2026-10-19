CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_edit_locks_expires
  ON document_edit_locks (expires_at) WHERE ended_at IS NULL;
