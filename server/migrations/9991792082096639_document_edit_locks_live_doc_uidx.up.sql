CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_document_edit_locks_live_doc
  ON document_edit_locks (document_id) WHERE ended_at IS NULL;
