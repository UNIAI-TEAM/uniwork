-- The thread read path: every comment list is one document, oldest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_comments_document
  ON document_comments (document_id, created_at);
