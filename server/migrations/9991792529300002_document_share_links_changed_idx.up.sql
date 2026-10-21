-- UNI-2039 fx1 (r1 F1): the same for public links, whose revoked and expired
-- rows also move access_changed_at. CONCURRENTLY, alone in this file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_share_links_doc_changed
    ON document_share_links (organization_id, workspace_id, document_id) INCLUDE (created_at, revoked_at);
