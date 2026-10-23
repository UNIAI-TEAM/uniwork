CREATE INDEX CONCURRENTLY IF NOT EXISTS attachments_file_id_idx
  ON attachments (file_id) WHERE file_id IS NOT NULL;
