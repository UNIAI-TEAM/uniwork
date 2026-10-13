-- The document purge walks mentions by document_id before it drops the
-- comments they belonged to.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_comment_mentions_document
  ON document_comment_mentions (document_id);
