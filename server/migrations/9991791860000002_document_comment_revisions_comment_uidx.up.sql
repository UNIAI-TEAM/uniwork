-- One revision number names exactly one stored body per comment: the edit
-- history is a sequence, not a bag.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_document_comment_revisions_comment
  ON document_comment_revisions (comment_id, revision);
