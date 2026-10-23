CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_multipart_uploads_open_by_actor
    ON file_multipart_uploads (created_by)
    WHERE status IN ('open', 'validating');
