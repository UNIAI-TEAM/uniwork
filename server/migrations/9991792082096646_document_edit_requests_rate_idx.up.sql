CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_edit_requests_rate
  ON document_edit_requests (organization_id, requester_id, document_id, created_at);
