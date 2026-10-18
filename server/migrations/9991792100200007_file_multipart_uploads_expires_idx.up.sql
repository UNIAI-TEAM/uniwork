CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_multipart_uploads_expires
    ON file_multipart_uploads (expires_at)
    WHERE status IN ('open', 'validating');
