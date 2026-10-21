-- "Recent" also counts the caller's own comments (UNI-2045 SV-1): one aggregate
-- over their live comments in a workspace, grouped by document. The thread read
-- path indexes (document_id, created_at); this one starts at the author so the
-- aggregate never scans another person's or tenant's comments. One statement,
-- its own file: a concurrent build cannot run inside a transaction (CLAUDE.md).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_comments_author ON document_comments (organization_id, author_id, workspace_id, document_id, created_at DESC) WHERE deleted_at IS NULL;
