-- Auto-version worker (ListDocumentsForAutoVersion) and its lag gauge walk due
-- pages in (content_saved_at, id) order every tick; G1-09 measured a 46-297 ms
-- seq scan at 120k rows. The partial index matches the query's fixed filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_autoversion_due
  ON documents (content_saved_at, id)
  WHERE kind = 'page' AND archived_at IS NULL AND content_saved_at IS NOT NULL;
