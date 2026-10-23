-- FileService reference lookups by file_id (C-01 §3.3; UNI-675).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_assets_file_id
  ON document_assets (file_id);
