-- "Ai đã xem tài liệu này" reads the document's log newest-first
-- (C-01 §3.6; UNI-675).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_access_logs_doc_time
  ON document_access_logs (document_id, occurred_at DESC);
