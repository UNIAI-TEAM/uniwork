-- One row per mentioned person per comment: re-mentioning somebody is a state
-- change on the row, never a second row (and never a second notification).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_document_comment_mentions_comment_user
  ON document_comment_mentions (comment_id, user_id);
