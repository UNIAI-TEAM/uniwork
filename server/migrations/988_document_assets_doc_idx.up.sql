-- Assets of one document (C-01 §3.3; UNI-675).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_assets_doc
  ON document_assets (document_id);
