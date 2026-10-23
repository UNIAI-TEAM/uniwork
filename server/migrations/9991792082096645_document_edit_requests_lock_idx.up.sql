CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_edit_requests_lock
  ON document_edit_requests (lock_id) WHERE status = 'pending';
