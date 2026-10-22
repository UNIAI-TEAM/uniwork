-- Name sort of the documents library (UNI-2038 S3). sort=name orders a
-- workspace list by title under the Vietnamese ICU collation, then id byte-wise;
-- without this index that is a scan of every live row and a top-N sort (about
-- 30 ms at 10,000 documents), with it the page reads the first rows in order.
-- Backward scans serve order=desc. The partial predicate is the one every list
-- query carries (never a trashed row, never a work-product document). One
-- statement, its own file: a concurrent build cannot run inside a transaction
-- (CLAUDE.md).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_ws_name ON documents (workspace_id, (title COLLATE "vi-x-icu"), (id COLLATE "C")) WHERE archived_at IS NULL AND owner_id IS NULL;
