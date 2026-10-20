CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_download_jobs_file_id
  ON document_download_jobs (file_id)
  WHERE file_id IS NOT NULL;
