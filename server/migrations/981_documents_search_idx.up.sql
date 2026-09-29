-- Trigram search over folded text (C-01 §3.7: search_text is the folded
-- title + content_text[:20k]). Owned documents are deliberately NOT excluded
-- here (§13.3) - an owner surface must still find its documents by content.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_search
  ON documents USING gin (search_text gin_trgm_ops);
