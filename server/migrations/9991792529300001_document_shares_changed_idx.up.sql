-- UNI-2039 fx1 (r1 F1): the access report's access_changed_at reads every
-- share of a document, revoked ones included (a revoke is a change), so the
-- live-only partial indexes cannot serve it. This one matches the lateral's
-- predicate and carries the two stamps, so the read is index-only.
-- CONCURRENTLY, alone in this file (Database and Migration Rules).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_shares_doc_changed
    ON document_shares (organization_id, workspace_id, document_id) INCLUDE (created_at, revoked_at);
