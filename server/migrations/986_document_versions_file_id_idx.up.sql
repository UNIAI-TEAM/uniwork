-- FileService reference lookups by file_id (C-01 §14.2; UNI-675) - the
-- collector asks "is this file_id still held by a document version?".
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_versions_file_id
  ON document_versions (file_id)
  WHERE file_id IS NOT NULL;
