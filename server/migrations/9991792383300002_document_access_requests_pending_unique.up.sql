-- One pending access request per (document, requester): the second of two
-- concurrent sends loses the unique index and answers 409
-- access_request_pending. An expired row stays 'pending' in the column, so
-- a re-send refreshes that row in place instead of inserting (the upsert's
-- DO UPDATE branch only fires when the row has expired).
CREATE UNIQUE INDEX CONCURRENTLY idx_document_access_requests_one_pending
  ON document_access_requests (document_id, created_by)
  WHERE status = 'pending';
