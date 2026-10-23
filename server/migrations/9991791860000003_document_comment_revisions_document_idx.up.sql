-- The document purge walks revisions by document_id before it drops the
-- comments they belonged to.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_comment_revisions_document
  ON document_comment_revisions (document_id);
