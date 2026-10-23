CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_document_edit_requests_pending
  ON document_edit_requests (document_id, requester_id) WHERE status = 'pending';
