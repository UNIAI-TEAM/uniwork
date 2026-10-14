-- Trigram search over the folded title (E6/FD-05, UNI-1465). match=title on
-- the workspace document list compares uw_fold_search(title) instead of
-- search_text, so "hop dong" finds "Hợp đồng" without the words appearing in
-- the content. The partial predicate (archived_at IS NULL) matches every list
-- query, which never returns a trashed row. One statement, its own file: a
-- concurrent build cannot run inside a transaction (CLAUDE.md).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_title_fold ON documents USING gin (uw_fold_search(title) gin_trgm_ops) WHERE archived_at IS NULL;
