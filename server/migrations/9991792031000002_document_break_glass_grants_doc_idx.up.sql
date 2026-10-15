CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_break_glass_grants_doc
    ON document_break_glass_grants (organization_id, document_id);
