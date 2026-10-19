-- The document's request list and count, and the cooldown read: pending rows
-- of one document, newest first, plus the latest declined row of one
-- (document, requester) pair.
CREATE INDEX CONCURRENTLY idx_document_access_requests_doc
  ON document_access_requests (organization_id, document_id, status, created_at);
